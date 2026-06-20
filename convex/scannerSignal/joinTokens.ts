import { v } from "convex/values";

import { internalMutation } from "../_generated/server";
import {
  SCANNER_JOIN_TOKEN_GRACE_MS,
  SCANNER_JOIN_TOKEN_TTL_MS,
  SCANNER_SESSION_TTL_MS,
  isScannerSessionId,
} from "@volt/scanner-protocol";
import { getJoinTokenByToken } from "./lookups";
import { publicJoinAttempt, publicJoinToken } from "./responses";
import { expireAttemptIfNeeded, requireBrowserClaim } from "./transitions";
import { clampNumber, optionalString } from "./validators";

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
    const record = await getJoinTokenByToken(ctx, args.token);
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
    const token = await getJoinTokenByToken(ctx, args.token);
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
    const token = await getJoinTokenByToken(ctx, args.token);
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
    const token = await getJoinTokenByToken(ctx, args.token);
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
    const next = await getJoinTokenByToken(ctx, args.nextToken);
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
