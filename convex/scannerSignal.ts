import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import {
  SCANNER_JOIN_ATTEMPT_TTL_MS,
  SCANNER_JOIN_TOKEN_GRACE_MS,
  SCANNER_JOIN_TOKEN_TTL_MS,
  SCANNER_PAIRING_TTL_MS,
  SCANNER_RECONNECT_REQUEST_TTL_MS,
  SCANNER_SESSION_TTL_MS,
  isScannerJoinToken,
  isScannerPairingId,
  isScannerSessionId,
  scannerSignalIso,
} from "../packages/scanner-protocol/src/index.ts";

const pushSubscriptionValidator = v.object({
  endpoint: v.string(),
  expirationTime: v.optional(v.union(v.number(), v.null())),
  keys: v.object({
    auth: v.string(),
    p256dh: v.string(),
  }),
});

const optionalString = v.optional(v.string());
const optionalStringArray = v.optional(v.array(v.string()));

function clampNumber(value: number | undefined, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function publicJoinToken(token: Doc<"scannerJoinTokens">) {
  return compact({
    token: token.token,
    sessionId: token.sessionId,
    expiresAt: scannerSignalIso(token.expiresAt),
    graceExpiresAt: scannerSignalIso(token.graceExpiresAt),
    revokedAt: token.revokedAt ? scannerSignalIso(token.revokedAt) : undefined,
    rotatedTo: token.rotatedTo,
  });
}

function publicJoinAttempt(attempt: Doc<"scannerJoinAttempts">) {
  return compact({
    id: attempt.attemptId,
    status: attempt.status,
    contributorId: attempt.contributorId,
    deviceLabel: attempt.deviceLabel,
    protocolVersion: attempt.protocolVersion,
    capabilities: attempt.capabilities,
    createdAt: scannerSignalIso(attempt.createdAt),
    expiresAt: scannerSignalIso(attempt.expiresAt),
    offeredAt: attempt.offeredAt ? scannerSignalIso(attempt.offeredAt) : undefined,
    answeredAt: attempt.answeredAt ? scannerSignalIso(attempt.answeredAt) : undefined,
    hasOffer: Boolean(attempt.offer),
    hasAnswer: Boolean(attempt.answer),
  });
}

function publicReconnectRequest(request: Doc<"scannerReconnectRequests">) {
  return compact({
    id: request.requestId,
    status: request.status,
    createdAt: scannerSignalIso(request.createdAt),
    expiresAt: scannerSignalIso(request.expiresAt),
    joinUrl: request.joinUrl,
    joinToken: request.joinToken,
    sessionId: request.sessionId,
    answeredAt: request.answeredAt ? scannerSignalIso(request.answeredAt) : undefined,
  });
}

function publicPendingReconnectRequest(
  pairing: Doc<"scannerPairings">,
  request: Doc<"scannerReconnectRequests">,
) {
  return compact({
    pairingId: pairing.pairingId,
    requestId: request.requestId,
    browserSessionId: pairing.browserSessionId,
    displayName: pairing.displayName,
    phoneDeviceId: pairing.phoneDeviceId,
    phoneLabel: pairing.phoneLabel,
    createdAt: scannerSignalIso(request.createdAt),
    expiresAt: scannerSignalIso(request.expiresAt),
  });
}

async function getJoinToken(ctx: MutationCtx, token: string) {
  return await ctx.db
    .query("scannerJoinTokens")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
}

async function getJoinAttempt(
  ctx: MutationCtx,
  token: string,
  attemptId: string,
) {
  return await ctx.db
    .query("scannerJoinAttempts")
    .withIndex("by_token_and_attemptId", (q) => q.eq("token", token).eq("attemptId", attemptId))
    .unique();
}

async function getPairing(ctx: MutationCtx, pairingId: string) {
  return await ctx.db
    .query("scannerPairings")
    .withIndex("by_pairingId", (q) => q.eq("pairingId", pairingId))
    .unique();
}

async function getReconnectRequest(
  ctx: MutationCtx,
  pairingId: string,
  requestId: string,
) {
  return await ctx.db
    .query("scannerReconnectRequests")
    .withIndex("by_pairingId_and_requestId", (q) => q.eq("pairingId", pairingId).eq("requestId", requestId))
    .unique();
}

function requireBrowserClaim(token: Doc<"scannerJoinTokens">, browserClaim: string | undefined) {
  return !token.browserClaim || token.browserClaim === browserClaim;
}

function requirePairingSecret(pairing: Doc<"scannerPairings">, pairingSecret: string | undefined) {
  return pairing.secret === pairingSecret;
}

async function expireAttemptIfNeeded(
  ctx: MutationCtx,
  attempt: Doc<"scannerJoinAttempts">,
  now: number,
) {
  if (attempt.expiresAt > now || attempt.status === "answer_posted" || attempt.status === "expired") {
    return attempt;
  }
  await ctx.db.patch(attempt._id, { status: "expired" });
  return { ...attempt, status: "expired" as const };
}

async function expireReconnectIfNeeded(
  ctx: MutationCtx,
  request: Doc<"scannerReconnectRequests">,
  now: number,
) {
  if (request.expiresAt > now || request.status !== "waiting_for_browser") return request;
  await ctx.db.patch(request._id, { status: "expired" });
  return { ...request, status: "expired" as const };
}

export const createJoinToken = internalMutation({
  args: {
    token: v.string(),
    sessionId: v.string(),
    browserClaim: optionalString,
    ttlMs: v.optional(v.number()),
    graceMs: v.optional(v.number()),
    origin: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const tokenTtlMs = clampNumber(args.ttlMs, SCANNER_JOIN_TOKEN_TTL_MS, 1, SCANNER_SESSION_TTL_MS);
    const graceMs = clampNumber(args.graceMs, SCANNER_JOIN_TOKEN_GRACE_MS, 0, 60 * 1000);
    const sessionId = isScannerSessionId(args.sessionId) ? args.sessionId : args.token;
    await ctx.db.insert("scannerJoinTokens", {
      token: args.token,
      sessionId,
      ...(args.browserClaim ? { browserClaim: args.browserClaim } : {}),
      createdAt: now,
      expiresAt: now + tokenTtlMs,
      graceExpiresAt: now + tokenTtlMs + graceMs,
    });
    const record = await getJoinToken(ctx, args.token);
    if (!record) throw new Error("Join token insert failed");
    return {
      ...publicJoinToken(record),
      ...(args.browserClaim ? { browserClaim: args.browserClaim } : {}),
      joinUrl: `${args.origin}/api/signal/join-token/${encodeURIComponent(args.token)}`,
    };
  },
});

export const getJoinTokenStatus = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const token = await getJoinToken(ctx, args.token);
    if (!token) return { statusCode: 404, body: { error: "Join token not found" } };
    const now = Date.now();
    const attempts = await ctx.db
      .query("scannerJoinAttempts")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(100);
    const normalizedAttempts = [];
    for (const attempt of attempts) normalizedAttempts.push(await expireAttemptIfNeeded(ctx, attempt, now));
    return {
      statusCode: 200,
      body: {
        ...publicJoinToken(token),
        active: !token.revokedAt && token.expiresAt > now,
        attempts: normalizedAttempts.map(publicJoinAttempt),
      },
    };
  },
});

export const revokeJoinToken = internalMutation({
  args: { token: v.string(), browserClaim: optionalString },
  handler: async (ctx, args) => {
    const token = await getJoinToken(ctx, args.token);
    if (!token) return { statusCode: 404, body: { error: "Join token not found" } };
    if (!requireBrowserClaim(token, args.browserClaim)) return { statusCode: 403, body: { error: "Browser claim required" } };
    const revokedAt = token.revokedAt ?? Date.now();
    await ctx.db.patch(token._id, { revokedAt, graceExpiresAt: Math.max(token.graceExpiresAt, revokedAt) });
    const next = await ctx.db.get(token._id);
    if (!next) throw new Error("Join token revoke failed");
    return { statusCode: 200, body: { success: true, ...publicJoinToken(next) } };
  },
});

export const rotateJoinToken = internalMutation({
  args: {
    token: v.string(),
    nextToken: v.string(),
    browserClaim: optionalString,
    ttlMs: v.optional(v.number()),
    graceMs: v.optional(v.number()),
    origin: v.string(),
  },
  handler: async (ctx, args) => {
    const token = await getJoinToken(ctx, args.token);
    if (!token) return { statusCode: 404, body: { error: "Join token not found" } };
    if (!requireBrowserClaim(token, args.browserClaim)) return { statusCode: 403, body: { error: "Browser claim required" } };
    const now = Date.now();
    const tokenTtlMs = clampNumber(args.ttlMs, SCANNER_JOIN_TOKEN_TTL_MS, 1, SCANNER_SESSION_TTL_MS);
    const graceMs = clampNumber(args.graceMs, SCANNER_JOIN_TOKEN_GRACE_MS, 0, 60 * 1000);
    await ctx.db.patch(token._id, {
      rotatedTo: args.nextToken,
      expiresAt: Math.min(token.expiresAt, now + graceMs),
      graceExpiresAt: Math.max(token.graceExpiresAt, now + graceMs),
    });
    await ctx.db.insert("scannerJoinTokens", {
      token: args.nextToken,
      sessionId: token.sessionId,
      ...(token.browserClaim ? { browserClaim: token.browserClaim } : {}),
      createdAt: now,
      expiresAt: now + tokenTtlMs,
      graceExpiresAt: now + tokenTtlMs + graceMs,
    });
    const previous = await ctx.db.get(token._id);
    const next = await getJoinToken(ctx, args.nextToken);
    if (!previous || !next) throw new Error("Join token rotation failed");
    return {
      statusCode: 200,
      body: {
        previous: publicJoinToken(previous),
        token: publicJoinToken(next),
        joinUrl: `${args.origin}/api/signal/join-token/${encodeURIComponent(args.nextToken)}`,
      },
    };
  },
});

export const createJoinAttempt = internalMutation({
  args: {
    token: v.string(),
    attemptId: v.string(),
    contributorId: optionalString,
    deviceLabel: optionalString,
    protocolVersion: optionalString,
    capabilities: optionalStringArray,
    attemptTtlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const token = await getJoinToken(ctx, args.token);
    if (!token) return { statusCode: 404, body: { error: "Join token not found" } };
    const now = Date.now();
    if (token.revokedAt || token.expiresAt <= now) {
      return { statusCode: 410, body: { error: token.revokedAt ? "Join token revoked" : "Join token expired" } };
    }
    const attemptTtlMs = clampNumber(args.attemptTtlMs, SCANNER_JOIN_ATTEMPT_TTL_MS, 1, SCANNER_JOIN_ATTEMPT_TTL_MS);
    await ctx.db.insert("scannerJoinAttempts", {
      token: args.token,
      attemptId: args.attemptId,
      createdAt: now,
      expiresAt: now + attemptTtlMs,
      status: "waiting_for_offer",
      ...(args.contributorId ? { contributorId: args.contributorId } : {}),
      ...(args.deviceLabel ? { deviceLabel: args.deviceLabel } : {}),
      ...(args.protocolVersion ? { protocolVersion: args.protocolVersion } : {}),
      ...(args.capabilities?.length ? { capabilities: args.capabilities } : {}),
    });
    const attempt = await getJoinAttempt(ctx, args.token, args.attemptId);
    if (!attempt) throw new Error("Join attempt insert failed");
    return { statusCode: 200, body: { attempt: publicJoinAttempt(attempt), token: publicJoinToken(token) } };
  },
});

export const listJoinAttempts = internalMutation({
  args: { token: v.string(), browserClaim: optionalString },
  handler: async (ctx, args) => {
    const token = await getJoinToken(ctx, args.token);
    if (!token) return { statusCode: 404, body: { error: "Join token not found" } };
    if (!requireBrowserClaim(token, args.browserClaim)) return { statusCode: 403, body: { error: "Browser claim required" } };
    const attempts = await ctx.db
      .query("scannerJoinAttempts")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(100);
    const normalized = [];
    const now = Date.now();
    for (const attempt of attempts) normalized.push(await expireAttemptIfNeeded(ctx, attempt, now));
    return { statusCode: 200, body: { attempts: normalized.map(publicJoinAttempt) } };
  },
});

export const postJoinOffer = internalMutation({
  args: { token: v.string(), attemptId: v.string(), browserClaim: optionalString, offer: v.string() },
  handler: async (ctx, args) => {
    const token = await getJoinToken(ctx, args.token);
    if (!token) return { statusCode: 404, body: { error: "Join token not found" } };
    if (!requireBrowserClaim(token, args.browserClaim)) return { statusCode: 403, body: { error: "Browser claim required" } };
    const attempt = await getJoinAttempt(ctx, args.token, args.attemptId);
    if (!attempt) return { statusCode: 404, body: { error: "Join attempt not found" } };
    const normalized = await expireAttemptIfNeeded(ctx, attempt, Date.now());
    if (normalized.status === "expired") return { statusCode: 410, body: { error: "Join attempt expired" } };
    await ctx.db.patch(attempt._id, { offer: args.offer, offeredAt: Date.now(), status: "offer_posted" });
    const next = await ctx.db.get(attempt._id);
    if (!next) throw new Error("Join offer post failed");
    return { statusCode: 200, body: { success: true, attempt: publicJoinAttempt(next) } };
  },
});

export const getJoinOffer = internalMutation({
  args: { token: v.string(), attemptId: v.string() },
  handler: async (ctx, args) => {
    const attempt = await getJoinAttempt(ctx, args.token, args.attemptId);
    if (!attempt) return { statusCode: 404, body: { error: "Join attempt not found" } };
    const normalized = await expireAttemptIfNeeded(ctx, attempt, Date.now());
    if (normalized.status === "expired") return { statusCode: 410, body: { error: "Join attempt expired" } };
    return { statusCode: 200, body: { offer: normalized.offer ?? null, attempt: publicJoinAttempt(normalized) } };
  },
});

export const postJoinAnswer = internalMutation({
  args: { token: v.string(), attemptId: v.string(), answer: v.string() },
  handler: async (ctx, args) => {
    const attempt = await getJoinAttempt(ctx, args.token, args.attemptId);
    if (!attempt) return { statusCode: 404, body: { error: "Join attempt not found" } };
    const normalized = await expireAttemptIfNeeded(ctx, attempt, Date.now());
    if (normalized.status === "expired") return { statusCode: 410, body: { error: "Join attempt expired" } };
    if (!normalized.offer) return { statusCode: 409, body: { error: "Offer required before answer" } };
    await ctx.db.patch(attempt._id, { answer: args.answer, answeredAt: Date.now(), status: "answer_posted" });
    const next = await ctx.db.get(attempt._id);
    if (!next) throw new Error("Join answer post failed");
    return { statusCode: 200, body: { success: true, attempt: publicJoinAttempt(next) } };
  },
});

export const getJoinAnswer = internalMutation({
  args: { token: v.string(), attemptId: v.string(), browserClaim: optionalString },
  handler: async (ctx, args) => {
    const token = await getJoinToken(ctx, args.token);
    if (!token) return { statusCode: 404, body: { error: "Join token not found" } };
    if (!requireBrowserClaim(token, args.browserClaim)) return { statusCode: 403, body: { error: "Browser claim required" } };
    const attempt = await getJoinAttempt(ctx, args.token, args.attemptId);
    if (!attempt) return { statusCode: 404, body: { error: "Join attempt not found" } };
    return { statusCode: 200, body: { answer: attempt.answer ?? null, attempt: publicJoinAttempt(attempt) } };
  },
});

export const registerPairing = internalMutation({
  args: {
    pairingId: v.string(),
    pairingSecret: v.string(),
    browserSessionId: v.string(),
    displayName: optionalString,
    phoneDeviceId: optionalString,
    phoneLabel: optionalString,
    pushSubscription: v.optional(pushSubscriptionValidator),
  },
  handler: async (ctx, args) => {
    if (!isScannerPairingId(args.pairingId)) return { statusCode: 400, body: { error: "Invalid pairing id" } };
    if (!isScannerJoinToken(args.pairingSecret)) return { statusCode: 400, body: { error: "Invalid pairing secret" } };
    if (!isScannerSessionId(args.browserSessionId)) return { statusCode: 400, body: { error: "Invalid browser session id" } };
    const existing = await getPairing(ctx, args.pairingId);
    if (existing && existing.secret !== args.pairingSecret) {
      return { statusCode: 409, body: { error: "Pairing already exists" } };
    }
    const now = Date.now();
    const nextPairing = {
      pairingId: args.pairingId,
      secret: args.pairingSecret,
      browserSessionId: args.browserSessionId,
      status: "active" as const,
      ...(args.displayName ? { displayName: args.displayName } : {}),
      ...(args.phoneDeviceId ? { phoneDeviceId: args.phoneDeviceId } : {}),
      ...(args.phoneLabel ? { phoneLabel: args.phoneLabel } : {}),
      ...(args.pushSubscription ?? existing?.pushSubscription ? { pushSubscription: args.pushSubscription ?? existing?.pushSubscription } : {}),
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
      expiresAt: now + SCANNER_PAIRING_TTL_MS,
    };
    if (existing) await ctx.db.replace(existing._id, nextPairing);
    else await ctx.db.insert("scannerPairings", nextPairing);
    const pairing = await getPairing(ctx, args.pairingId);
    if (!pairing) throw new Error("Pairing upsert failed");
    return {
      statusCode: 200,
      body: {
        pairingId: pairing.pairingId,
        browserSessionId: pairing.browserSessionId,
        ...(pairing.displayName ? { displayName: pairing.displayName } : {}),
        expiresAt: scannerSignalIso(pairing.expiresAt),
      },
    };
  },
});

export const createReconnectRequest = internalMutation({
  args: { pairingId: v.string(), pairingSecret: optionalString, requestId: v.string() },
  handler: async (ctx, args) => {
    const pairing = await getPairing(ctx, args.pairingId);
    if (!pairing || pairing.status !== "active" || pairing.expiresAt <= Date.now()) {
      return { statusCode: 404, body: { error: "Pairing not found" } };
    }
    if (!requirePairingSecret(pairing, args.pairingSecret)) return { statusCode: 403, body: { error: "Pairing secret required" } };
    const now = Date.now();
    await ctx.db.patch(pairing._id, { lastSeenAt: now, expiresAt: now + SCANNER_PAIRING_TTL_MS });
    await ctx.db.insert("scannerReconnectRequests", {
      pairingId: pairing.pairingId,
      requestId: args.requestId,
      browserSessionId: pairing.browserSessionId,
      createdAt: now,
      expiresAt: now + SCANNER_RECONNECT_REQUEST_TTL_MS,
      status: "waiting_for_browser",
    });
    const request = await getReconnectRequest(ctx, pairing.pairingId, args.requestId);
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
      const pairing = await getPairing(ctx, normalized.pairingId);
      if (!pairing || pairing.status !== "active" || pairing.expiresAt <= now) continue;
      pending.push(publicPendingReconnectRequest(pairing, normalized));
    }
    return { statusCode: 200, body: { requests: pending } };
  },
});

export const getReconnectRequestStatus = internalMutation({
  args: { pairingId: v.string(), requestId: v.string(), pairingSecret: optionalString },
  handler: async (ctx, args) => {
    const pairing = await getPairing(ctx, args.pairingId);
    if (!pairing) return { statusCode: 404, body: { error: "Pairing not found" } };
    if (!requirePairingSecret(pairing, args.pairingSecret)) return { statusCode: 403, body: { error: "Pairing secret required" } };
    const request = await getReconnectRequest(ctx, args.pairingId, args.requestId);
    if (!request) return { statusCode: 404, body: { error: "Reconnect request not found" } };
    const normalized = await expireReconnectIfNeeded(ctx, request, Date.now());
    return { statusCode: 200, body: { request: publicReconnectRequest(normalized) } };
  },
});

export const postReconnectJoinWindow = internalMutation({
  args: {
    pairingId: v.string(),
    requestId: v.string(),
    pairingSecret: optionalString,
    joinUrl: v.string(),
    joinToken: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const pairing = await getPairing(ctx, args.pairingId);
    if (!pairing) return { statusCode: 404, body: { error: "Pairing not found" } };
    if (!requirePairingSecret(pairing, args.pairingSecret)) return { statusCode: 403, body: { error: "Pairing secret required" } };
    if (!isScannerJoinToken(args.joinToken) || !isScannerSessionId(args.sessionId)) {
      return { statusCode: 400, body: { error: "Invalid join window" } };
    }
    const request = await getReconnectRequest(ctx, args.pairingId, args.requestId);
    if (!request) return { statusCode: 404, body: { error: "Reconnect request not found" } };
    const normalized = await expireReconnectIfNeeded(ctx, request, Date.now());
    if (normalized.status === "expired") return { statusCode: 410, body: { error: "Reconnect request expired" } };
    const now = Date.now();
    await ctx.db.patch(request._id, {
      status: "join_window_ready",
      joinUrl: args.joinUrl,
      joinToken: args.joinToken,
      sessionId: args.sessionId,
      answeredAt: now,
    });
    await ctx.db.patch(pairing._id, { lastSeenAt: now, expiresAt: now + SCANNER_PAIRING_TTL_MS });
    const next = await ctx.db.get(request._id);
    if (!next) throw new Error("Reconnect join window post failed");
    return { statusCode: 200, body: { success: true, request: publicReconnectRequest(next) } };
  },
});

export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let deleted = 0;
    const expiredAttempts = await ctx.db
      .query("scannerJoinAttempts")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(100);
    for (const attempt of expiredAttempts) {
      await ctx.db.delete(attempt._id);
      deleted += 1;
    }
    const expiredTokens = await ctx.db
      .query("scannerJoinTokens")
      .withIndex("by_graceExpiresAt", (q) => q.lt("graceExpiresAt", now))
      .take(100);
    for (const token of expiredTokens) {
      await ctx.db.delete(token._id);
      deleted += 1;
    }
    const expiredReconnects = await ctx.db
      .query("scannerReconnectRequests")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(100);
    for (const request of expiredReconnects) {
      await ctx.db.delete(request._id);
      deleted += 1;
    }
    const expiredPairings = await ctx.db
      .query("scannerPairings")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(100);
    for (const pairing of expiredPairings) {
      await ctx.db.delete(pairing._id);
      deleted += 1;
    }
    return { deleted };
  },
});
