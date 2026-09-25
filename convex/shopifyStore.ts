import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const tokenFields = {
  encryptedAccessToken: v.string(), encryptedRefreshToken: v.string(),
  expiresAt: v.number(), refreshExpiresAt: v.number(),
};
export const connectionValidator = v.object({
  _id: v.id("shopifyConnections"), _creationTime: v.number(), ownerTokenIdentifier: v.string(), shop: v.string(),
  ...tokenFields, refreshLease: v.optional(v.object({ nonce: v.string(), expiresAt: v.number() })),
});
export const begin = internalMutation({
  args: { ownerTokenIdentifier: v.string(), shop: v.string(), state: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const old = await ctx.db.query("shopifyOAuthStates").withIndex("by_ownerTokenIdentifier", q => q.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)).unique();
    if (old) await ctx.db.delete(old._id);
    await ctx.db.insert("shopifyOAuthStates", { ...args, expiresAt: Date.now() + 10 * 60000 });
    return null;
  },
});
export const consume = internalMutation({
  args: { state: v.string(), shop: v.string() },
  returns: v.object({ id: v.id("shopifyOAuthStates"), ownerTokenIdentifier: v.string() }),
  handler: async (ctx, args) => {
    const row = await ctx.db.query("shopifyOAuthStates").withIndex("by_state", q => q.eq("state", args.state)).unique();
    if (!row || row.shop !== args.shop || row.expiresAt <= Date.now() || row.consumedAt !== undefined) throw new ConvexError("Shopify connection request expired. Start again.");
    await ctx.db.patch(row._id, { consumedAt: Date.now() });
    return { id: row._id, ownerTokenIdentifier: row.ownerTokenIdentifier };
  },
});
export const finish = internalMutation({
  args: { stateId: v.id("shopifyOAuthStates"), ...tokenFields }, returns: v.null(),
  handler: async (ctx, { stateId, ...tokens }) => {
    const state = await ctx.db.get(stateId);
    if (!state || state.consumedAt === undefined || state.expiresAt <= Date.now()) throw new ConvexError("Shopify connection was canceled. Start again.");
    const old = await ctx.db.query("shopifyConnections").withIndex("by_ownerTokenIdentifier", q => q.eq("ownerTokenIdentifier", state.ownerTokenIdentifier)).unique();
    if (old) await ctx.db.delete(old._id);
    await ctx.db.insert("shopifyConnections", { ...tokens, ownerTokenIdentifier: state.ownerTokenIdentifier, shop: state.shop });
    await ctx.db.delete(stateId);
    return null;
  },
});
export const read = internalQuery({
  args: { ownerTokenIdentifier: v.string() }, returns: v.union(connectionValidator, v.null()),
  handler: (ctx, args) => ctx.db.query("shopifyConnections").withIndex("by_ownerTokenIdentifier", q => q.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)).unique(),
});
export const leaseRefresh = internalMutation({
  args: { connectionId: v.id("shopifyConnections"), nonce: v.string() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.connectionId);
    if (!row) throw new ConvexError("Store disconnected.");
    if (row.expiresAt > Date.now() + 60000 || (row.refreshLease && row.refreshLease.expiresAt > Date.now())) return false;
    await ctx.db.patch(row._id, { refreshLease: { nonce: args.nonce, expiresAt: Date.now() + 60000 } });
    return true;
  },
});
export const finishRefresh = internalMutation({
  args: { connectionId: v.id("shopifyConnections"), nonce: v.string(), tokens: v.union(v.object(tokenFields), v.null()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.connectionId);
    if (!row || row.refreshLease?.nonce !== args.nonce) throw new ConvexError("Shopify connection changed. Try again.");
    await ctx.db.patch(row._id, { ...(args.tokens ?? {}), refreshLease: undefined });
    return null;
  },
});
