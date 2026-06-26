import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import {
  SCANNER_PAIRING_TTL_MS,
  SCANNER_RECONNECT_REQUEST_TTL_MS,
  isScannerJoinToken,
  isScannerSessionId,
} from "@volt/scanner-protocol";
import {
  getPairingByPairingId,
  getReconnectRequestByPairingAndRequestId,
} from "./lookups";
import { publicPendingReconnectRequest, publicReconnectRequest } from "./responses";
import {
  expireReconnectIfNeeded,
  requireActivePairing,
  requirePairingSecret,
} from "./transitions";
import { optionalString } from "./validators";

export const createReconnectRequest = internalMutation({
  args: { pairingId: v.string(), pairingSecret: optionalString, requestId: v.string() },
  handler: async (ctx, args) => {
    const pairing = await getPairingByPairingId(ctx, args.pairingId);
    const now = Date.now();
    if (!pairing || !requireActivePairing(pairing, now)) {
      return { statusCode: 404, body: { error: "Pairing not found" } };
    }
    if (!requirePairingSecret(pairing, args.pairingSecret)) return { statusCode: 403, body: { error: "Pairing secret required" } };
    await ctx.db.patch(pairing._id, { lastSeenAt: now, expiresAt: now + SCANNER_PAIRING_TTL_MS });
    await ctx.db.insert("scannerReconnectRequests", {
      pairingId: pairing.pairingId,
      requestId: args.requestId,
      browserSessionId: pairing.browserSessionId,
      createdAt: now,
      expiresAt: now + SCANNER_RECONNECT_REQUEST_TTL_MS,
      status: "waiting_for_browser",
    });
    const request = await getReconnectRequestByPairingAndRequestId(ctx, pairing.pairingId, args.requestId);
    if (!request) throw new Error("Reconnect request insert failed");
    return {
      statusCode: 200,
      body: {
        pairingId: pairing.pairingId,
        browserSessionId: pairing.browserSessionId,
        request: publicReconnectRequest(request),
        pushSubscription: pairing.pushSubscription ?? null,
      },
    };
  },
});

export const getPendingReconnectRequests = internalMutation({
  args: { browserSessionId: v.string() },
  handler: async (ctx, args) => {
    if (!isScannerSessionId(args.browserSessionId)) {
      return { statusCode: 400, body: { error: "Invalid browser session id" } };
    }
    const now = Date.now();
    const requests = await ctx.db
      .query("scannerReconnectRequests")
      .withIndex("by_browserSessionId_and_status", (q) =>
        q.eq("browserSessionId", args.browserSessionId).eq("status", "waiting_for_browser"),
      )
      .take(50);
    const pending = [];
    for (const request of requests) {
      const normalized = await expireReconnectIfNeeded(ctx, request, now);
      if (normalized.status !== "waiting_for_browser") continue;
      const pairing = await getPairingByPairingId(ctx, normalized.pairingId);
      if (!pairing || !requireActivePairing(pairing, now)) continue;
      pending.push(publicPendingReconnectRequest(pairing, normalized));
    }
    return { statusCode: 200, body: { requests: pending } };
  },
});

export const getReconnectRequestStatus = internalMutation({
  args: { pairingId: v.string(), requestId: v.string(), pairingSecret: optionalString },
  handler: async (ctx, args) => {
    const pairing = await getPairingByPairingId(ctx, args.pairingId);
    if (!pairing) return { statusCode: 404, body: { error: "Pairing not found" } };
    if (!requirePairingSecret(pairing, args.pairingSecret)) return { statusCode: 403, body: { error: "Pairing secret required" } };
    const request = await getReconnectRequestByPairingAndRequestId(ctx, args.pairingId, args.requestId);
    if (!request) return { statusCode: 404, body: { error: "Reconnect request not found" } };
    const normalized = await expireReconnectIfNeeded(ctx, request, Date.now());
    return { statusCode: 200, body: { request: publicReconnectRequest(normalized) } };
  },
});

export const postReconnectJoinWindow = internalMutation({
  args: {
    pairingId: v.string(),
    requestId: v.string(),
    answeringPairingId: optionalString,
    pairingSecret: optionalString,
    joinUrl: v.string(),
    joinToken: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const pairing = await getPairingByPairingId(ctx, args.pairingId);
    if (!pairing) return { statusCode: 404, body: { error: "Pairing not found" } };
    const now = Date.now();
    let answeringPairing = pairing;
    if (!requirePairingSecret(pairing, args.pairingSecret)) {
      const fallbackPairing = args.answeringPairingId
        ? await getPairingByPairingId(ctx, args.answeringPairingId)
        : null;
      if (
        !fallbackPairing ||
        !requireActivePairing(fallbackPairing, now) ||
        fallbackPairing.browserSessionId !== pairing.browserSessionId ||
        !requirePairingSecret(fallbackPairing, args.pairingSecret)
      ) {
        return { statusCode: 403, body: { error: "Pairing secret required" } };
      }
      answeringPairing = fallbackPairing;
    }
    if (!isScannerJoinToken(args.joinToken) || !isScannerSessionId(args.sessionId)) {
      return { statusCode: 400, body: { error: "Invalid join window" } };
    }
    const request = await getReconnectRequestByPairingAndRequestId(ctx, args.pairingId, args.requestId);
    if (!request) return { statusCode: 404, body: { error: "Reconnect request not found" } };
    const normalized = await expireReconnectIfNeeded(ctx, request, now);
    if (normalized.status === "expired") return { statusCode: 410, body: { error: "Reconnect request expired" } };
    await ctx.db.patch(request._id, {
      status: "join_window_ready",
      joinUrl: args.joinUrl,
      joinToken: args.joinToken,
      sessionId: args.sessionId,
      answeredAt: now,
    });
    await ctx.db.patch(pairing._id, { lastSeenAt: now, expiresAt: now + SCANNER_PAIRING_TTL_MS });
    if (answeringPairing._id !== pairing._id) {
      await ctx.db.patch(answeringPairing._id, { lastSeenAt: now, expiresAt: now + SCANNER_PAIRING_TTL_MS });
    }
    const next = await ctx.db.get(request._id);
    if (!next) throw new Error("Reconnect join window post failed");
    return { statusCode: 200, body: { success: true, request: publicReconnectRequest(next) } };
  },
});
