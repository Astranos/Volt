import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const leaseDurationMs = 45_000;
const installation = v.object({
  _id: v.id("shopifyEmbeddedInstallations"),
  _creationTime: v.number(),
  shop: v.string(),
  encryptedAccessToken: v.optional(v.string()),
  encryptedRefreshToken: v.optional(v.string()),
  expiresAt: v.optional(v.number()),
  refreshExpiresAt: v.optional(v.number()),
  exchangeLease: v.optional(v.object({ nonce: v.string(), expiresAt: v.number() })),
});

export const read = internalQuery({
  args: { shop: v.string() },
  returns: v.union(installation, v.null()),
  handler: (ctx, { shop }) => ctx.db.query("shopifyEmbeddedInstallations")
    .withIndex("by_shop", (q) => q.eq("shop", shop)).unique(),
});

export const beginExchange = internalMutation({
  args: { shop: v.string(), nonce: v.string() },
  returns: v.union(v.literal("ready"), v.literal("leased"), v.literal("acquired")),
  handler: async (ctx, { shop, nonce }) => {
    const now = Date.now();
    const row = await ctx.db.query("shopifyEmbeddedInstallations")
      .withIndex("by_shop", (q) => q.eq("shop", shop)).unique();
    if (row?.encryptedAccessToken && row.expiresAt && row.expiresAt > now + 60_000) return "ready";
    if (row?.exchangeLease && row.exchangeLease.expiresAt > now) return "leased";
    const exchangeLease = { nonce, expiresAt: now + leaseDurationMs };
    if (row) await ctx.db.patch(row._id, { exchangeLease });
    else await ctx.db.insert("shopifyEmbeddedInstallations", { shop, exchangeLease });
    return "acquired";
  },
});

export const finishExchange = internalMutation({
  args: {
    shop: v.string(), nonce: v.string(),
    encryptedAccessToken: v.string(), encryptedRefreshToken: v.string(),
    expiresAt: v.number(), refreshExpiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { shop, nonce, ...tokens }) => {
    const row = await ctx.db.query("shopifyEmbeddedInstallations")
      .withIndex("by_shop", (q) => q.eq("shop", shop)).unique();
    if (!row || row.exchangeLease?.nonce !== nonce || row.exchangeLease.expiresAt <= Date.now()) {
      throw new ConvexError("Shopify installation changed. Reload the app.");
    }
    await ctx.db.patch(row._id, { ...tokens, exchangeLease: undefined });
    return null;
  },
});

export const cancelExchange = internalMutation({
  args: { shop: v.string(), nonce: v.string() },
  returns: v.null(),
  handler: async (ctx, { shop, nonce }) => {
    const row = await ctx.db.query("shopifyEmbeddedInstallations")
      .withIndex("by_shop", (q) => q.eq("shop", shop)).unique();
    if (row?.exchangeLease?.nonce === nonce) await ctx.db.patch(row._id, { exchangeLease: undefined });
    return null;
  },
});
