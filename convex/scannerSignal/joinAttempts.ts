import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import { SCANNER_JOIN_ATTEMPT_TTL_MS } from "@volt/scanner-protocol";
import { getJoinAttemptByTokenAndAttemptId, getJoinTokenByToken } from "./lookups";
import { publicJoinAttempt, publicJoinToken } from "./responses";
import {
  expireAttemptIfNeeded,
  requireActiveJoinToken,
  requireBrowserClaim,
} from "./transitions";
import { clampNumber, optionalString, optionalStringArray } from "./validators";

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
    const token = await getJoinTokenByToken(ctx, args.token);
    if (!token) return { statusCode: 404, body: { error: "Join token not found" } };
    const now = Date.now();
    const inactive = requireActiveJoinToken(token, now);
    if (inactive) return inactive;
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
    const attempt = await getJoinAttemptByTokenAndAttemptId(ctx, args.token, args.attemptId);
    if (!attempt) throw new Error("Join attempt insert failed");
    return { statusCode: 200, body: { attempt: publicJoinAttempt(attempt), token: publicJoinToken(token) } };
  },
});

export const listJoinAttempts = internalMutation({
  args: { token: v.string(), browserClaim: optionalString },
  handler: async (ctx, args) => {
    const token = await getJoinTokenByToken(ctx, args.token);
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
    const token = await getJoinTokenByToken(ctx, args.token);
    if (!token) return { statusCode: 404, body: { error: "Join token not found" } };
    if (!requireBrowserClaim(token, args.browserClaim)) return { statusCode: 403, body: { error: "Browser claim required" } };
    const attempt = await getJoinAttemptByTokenAndAttemptId(ctx, args.token, args.attemptId);
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
    const attempt = await getJoinAttemptByTokenAndAttemptId(ctx, args.token, args.attemptId);
    if (!attempt) return { statusCode: 404, body: { error: "Join attempt not found" } };
    const normalized = await expireAttemptIfNeeded(ctx, attempt, Date.now());
    if (normalized.status === "expired") return { statusCode: 410, body: { error: "Join attempt expired" } };
    return { statusCode: 200, body: { offer: normalized.offer ?? null, attempt: publicJoinAttempt(normalized) } };
  },
});

export const postJoinAnswer = internalMutation({
  args: { token: v.string(), attemptId: v.string(), answer: v.string() },
  handler: async (ctx, args) => {
    const attempt = await getJoinAttemptByTokenAndAttemptId(ctx, args.token, args.attemptId);
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
    const token = await getJoinTokenByToken(ctx, args.token);
    if (!token) return { statusCode: 404, body: { error: "Join token not found" } };
    if (!requireBrowserClaim(token, args.browserClaim)) return { statusCode: 403, body: { error: "Browser claim required" } };
    const attempt = await getJoinAttemptByTokenAndAttemptId(ctx, args.token, args.attemptId);
    if (!attempt) return { statusCode: 404, body: { error: "Join attempt not found" } };
    return { statusCode: 200, body: { answer: attempt.answer ?? null, attempt: publicJoinAttempt(attempt) } };
  },
});
