import { v, type Infer } from "convex/values";

import { createProductApiKeyToken, sha256Hex } from "./productApiKeyCrypto";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
} from "./_generated/server";

const MAX_ACTIVE_KEYS = 10;
const MAX_LISTED_KEYS = 100;
const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_CLEANUP_BATCH_SIZE = 500;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

const keyMetadataValidator = v.object({
  id: v.id("productApiKeys"),
  name: v.string(),
  prefix: v.string(),
  createdAt: v.number(),
  lastUsedAt: v.union(v.number(), v.null()),
  revokedAt: v.union(v.number(), v.null()),
});

const apiAuthorizationResultValidator = v.union(
  v.object({
    kind: v.literal("authorized"),
    limit: v.number(),
    remaining: v.number(),
    resetAt: v.number(),
  }),
  v.object({
    kind: v.literal("invalid_key"),
  }),
  v.object({
    kind: v.literal("rate_limited"),
    limit: v.number(),
    remaining: v.number(),
    resetAt: v.number(),
    retryAfterSeconds: v.number(),
  }),
);
type ApiAuthorizationResult = Infer<typeof apiAuthorizationResultValidator>;

function metadataFor(key: Doc<"productApiKeys">) {
  return {
    id: key._id,
    name: key.name,
    prefix: key.prefix,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt ?? null,
    revokedAt: key.status === "revoked" ? key.revokedAt : null,
  };
}

function validateKeyName(input: string): string {
  const name = input.trim();
  if (name.length < 1 || name.length > 64 || CONTROL_CHARACTER_PATTERN.test(name)) {
    throw new Error("API key name must be 1 to 64 characters and cannot contain control characters");
  }
  return name;
}

export const list = query({
  args: {},
  returns: v.array(keyMetadataValidator),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const keys = await ctx.db
      .query("productApiKeys")
      .withIndex("by_ownerTokenIdentifier", (q) => q.eq("ownerTokenIdentifier", identity.tokenIdentifier))
      .order("desc")
      .take(MAX_LISTED_KEYS);
    return keys.map(metadataFor);
  },
});

export const create = mutation({
  args: { name: v.string() },
  returns: v.object({
    ...keyMetadataValidator.fields,
    token: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const name = validateKeyName(args.name);

    const activeKeys = await ctx.db
      .query("productApiKeys")
      .withIndex("by_ownerTokenIdentifier_and_status", (q) =>
        q.eq("ownerTokenIdentifier", identity.tokenIdentifier).eq("status", "active"))
      .take(MAX_ACTIVE_KEYS + 1);
    if (activeKeys.length >= MAX_ACTIVE_KEYS) {
      throw new Error(`A user can have at most ${MAX_ACTIVE_KEYS} active product API keys`);
    }

    const { token, prefix } = createProductApiKeyToken();
    const keyHash = await sha256Hex(token);
    const createdAt = Date.now();
    const id = await ctx.db.insert("productApiKeys", {
      ownerTokenIdentifier: identity.tokenIdentifier,
      name,
      keyHash,
      prefix,
      status: "active",
      createdAt,
    });
    return {
      id,
      name,
      prefix,
      createdAt,
      lastUsedAt: null,
      revokedAt: null,
      token,
    };
  },
});

export const revoke = mutation({
  args: { id: v.id("productApiKeys") },
  returns: keyMetadataValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const key = await ctx.db.get(args.id);
    if (!key || key.ownerTokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("API key not found");
    }
    if (key.status === "revoked") return metadataFor(key);

    const revokedAt = Date.now();
    await ctx.db.patch(key._id, { status: "revoked", revokedAt });
    return metadataFor({ ...key, status: "revoked", revokedAt });
  },
});

export const authenticateAndConsume = internalMutation({
  args: {
    keyHash: v.string(),
    now: v.number(),
  },
  returns: apiAuthorizationResultValidator,
  handler: async (ctx, args): Promise<ApiAuthorizationResult> => {
    const key = await ctx.db
      .query("productApiKeys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", args.keyHash))
      .unique();
    if (!key || key.status !== "active") return { kind: "invalid_key" };

    const windowStartedAt = Math.floor(args.now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
    const resetAt = windowStartedAt + RATE_WINDOW_MS;
    const window = await ctx.db
      .query("productApiRateLimits")
      .withIndex("by_apiKeyId_and_windowStartedAt", (q) =>
        q.eq("apiKeyId", key._id).eq("windowStartedAt", windowStartedAt))
      .unique();

    if (window && window.requestCount >= RATE_LIMIT) {
      return {
        kind: "rate_limited",
        limit: RATE_LIMIT,
        remaining: 0,
        resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - args.now) / 1000)),
      };
    }

    const requestCount = (window?.requestCount ?? 0) + 1;
    if (window) {
      await ctx.db.patch(window._id, { requestCount });
    } else {
      await ctx.db.insert("productApiRateLimits", {
        apiKeyId: key._id,
        windowStartedAt,
        requestCount,
        expiresAt: resetAt,
      });
    }
    await ctx.db.patch(key._id, { lastUsedAt: args.now });
    return {
      kind: "authorized",
      limit: RATE_LIMIT,
      remaining: RATE_LIMIT - requestCount,
      resetAt,
    };
  },
});

export const cleanupRateLimitWindows = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const expired = await ctx.db
      .query("productApiRateLimits")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", now))
      .take(RATE_LIMIT_CLEANUP_BATCH_SIZE);
    for (const window of expired) await ctx.db.delete(window._id);
    return { deleted: expired.length };
  },
});
