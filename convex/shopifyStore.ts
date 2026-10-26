import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalAction, internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { decryptToken, encryptToken, storeAad } from "./shopifyHelpers";

const tokenFields = {
  encryptedAccessToken: v.string(), encryptedRefreshToken: v.string(),
  expiresAt: v.number(), refreshExpiresAt: v.number(),
};
export const MAX_HIDDEN_PRODUCTS = 500;
/** A franchise can connect each of its stores to one Volt account. */
export const MAX_SHOPIFY_STORES = 5;
const storeLimitMessage = `You can connect up to ${MAX_SHOPIFY_STORES} Shopify stores. Disconnect one first.`;
const storeFor = (ctx: QueryCtx, shop: string) =>
  ctx.db.query("shopifyStores").withIndex("by_shop", q => q.eq("shop", shop)).unique();
const connections = (ctx: QueryCtx, owner: string) =>
  ctx.db.query("shopifyConnections").withIndex("by_ownerTokenIdentifier", q => q.eq("ownerTokenIdentifier", owner));
/** The owner's connection to `shop`, or their first-connected store when no shop is named (older extensions). */
export function connectionFor(ctx: QueryCtx, owner: string, shop?: string) {
  return shop === undefined ? connections(ctx, owner).first()
    : ctx.db.query("shopifyConnections").withIndex("by_ownerTokenIdentifier_and_shop", q => q.eq("ownerTokenIdentifier", owner).eq("shop", shop)).unique();
}
async function atStoreLimit(ctx: QueryCtx, owner: string, shop: string) {
  const rows = await connections(ctx, owner).take(MAX_SHOPIFY_STORES + 1);
  return rows.filter(row => row.shop !== shop).length >= MAX_SHOPIFY_STORES;
}
/** Removes an account from a store, and the store's shared token once no account uses it. */
export async function removeConnection(ctx: MutationCtx, row: Doc<"shopifyConnections">) {
  await ctx.db.delete(row._id);
  const remaining = await ctx.db.query("shopifyConnections").withIndex("by_shop", q => q.eq("shop", row.shop)).first();
  const store = remaining ? null : await storeFor(ctx, row.shop);
  if (store) await ctx.db.delete(store._id);
}
const storeValidator = v.object({
  _id: v.id("shopifyStores"), _creationTime: v.number(), shop: v.string(),
  ...tokenFields, refreshLease: v.optional(v.object({ nonce: v.string(), expiresAt: v.number() })),
});
export const begin = internalMutation({
  args: { ownerTokenIdentifier: v.string(), shop: v.string(), state: v.string(), browserNonceHash: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    if (await atStoreLimit(ctx, args.ownerTokenIdentifier, args.shop)) throw new ConvexError(storeLimitMessage);
    const old = await ctx.db.query("shopifyOAuthStates").withIndex("by_ownerTokenIdentifier", q => q.eq("ownerTokenIdentifier", args.ownerTokenIdentifier)).unique();
    if (old) await ctx.db.delete(old._id);
    await ctx.db.insert("shopifyOAuthStates", { ...args, expiresAt: Date.now() + 10 * 60000 });
    return null;
  },
});
export const consume = internalMutation({
  args: { state: v.string(), shop: v.string(), browserNonceHash: v.string() },
  returns: v.object({ id: v.id("shopifyOAuthStates"), ownerTokenIdentifier: v.string() }),
  handler: async (ctx, args) => {
    const row = await ctx.db.query("shopifyOAuthStates").withIndex("by_state", q => q.eq("state", args.state)).unique();
    if (!row || row.shop !== args.shop || row.browserNonceHash !== args.browserNonceHash
      || row.expiresAt <= Date.now() || row.consumedAt !== undefined) throw new ConvexError("Shopify connection request expired. Start again.");
    await ctx.db.patch(row._id, { consumedAt: Date.now() });
    return { id: row._id, ownerTokenIdentifier: row.ownerTokenIdentifier };
  },
});
export const finish = internalMutation({
  args: { stateId: v.id("shopifyOAuthStates"), ...tokenFields }, returns: v.null(),
  handler: async (ctx, { stateId, ...tokens }) => {
    const state = await ctx.db.get(stateId);
    if (!state || state.consumedAt === undefined || state.expiresAt <= Date.now()) throw new ConvexError("Shopify connection was canceled. Start again.");
    // Reconnecting keeps the account's existing row, so the first-connected store
    // (the default for clients that don't pass a shop) stays first. Other stores are kept.
    if (!await connectionFor(ctx, state.ownerTokenIdentifier, state.shop)) {
      if (await atStoreLimit(ctx, state.ownerTokenIdentifier, state.shop)) throw new ConvexError(storeLimitMessage);
      await ctx.db.insert("shopifyConnections", { ownerTokenIdentifier: state.ownerTokenIdentifier, shop: state.shop });
    }
    // The new token replaces the store's shared one for every connected account.
    const store = await storeFor(ctx, state.shop);
    if (store) await ctx.db.patch(store._id, { ...tokens, refreshLease: undefined });
    else await ctx.db.insert("shopifyStores", { ...tokens, shop: state.shop });
    await ctx.db.delete(stateId);
    return null;
  },
});
/** The shared token of a store the account is connected to. */
export const read = internalQuery({
  args: { ownerTokenIdentifier: v.string(), shop: v.optional(v.string()) }, returns: v.union(storeValidator, v.null()),
  handler: async (ctx, args) => {
    const connection = await connectionFor(ctx, args.ownerTokenIdentifier, args.shop);
    return connection ? storeFor(ctx, connection.shop) : null;
  },
});
export const leaseRefresh = internalMutation({
  args: { storeId: v.id("shopifyStores"), nonce: v.string() }, returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.storeId);
    if (!row) throw new ConvexError("Store disconnected.");
    if (row.expiresAt > Date.now() + 60000 || (row.refreshLease && row.refreshLease.expiresAt > Date.now())) return false;
    await ctx.db.patch(row._id, { refreshLease: { nonce: args.nonce, expiresAt: Date.now() + 60000 } });
    return true;
  },
});
export const finishRefresh = internalMutation({
  args: { storeId: v.id("shopifyStores"), nonce: v.string(), tokens: v.union(v.object(tokenFields), v.null()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.storeId);
    if (!row || row.refreshLease?.nonce !== args.nonce) throw new ConvexError("Shopify connection changed. Try again.");
    await ctx.db.patch(row._id, { ...(args.tokens ?? {}), refreshLease: undefined });
    return null;
  },
});
export const hiddenProductIds = internalQuery({
  args: { ownerTokenIdentifier: v.string(), shop: v.string() }, returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const rows = await ctx.db.query("shopifyHiddenProducts")
      .withIndex("by_ownerTokenIdentifier_and_shop_and_productId", q => q.eq("ownerTokenIdentifier", args.ownerTokenIdentifier).eq("shop", args.shop))
      .take(MAX_HIDDEN_PRODUCTS);
    return rows.map(row => row.productId);
  },
});

const legacyFields = { ownerTokenIdentifier: v.string(), shop: v.string(), ...tokenFields };
const legacyConnectionsReference = makeFunctionReference<"query", Record<string, never>, Array<{ ownerTokenIdentifier: string; shop: string } & Tokens>>("shopifyStore:legacyConnections");
const adoptStoreReference = makeFunctionReference<"mutation", { shop: string; tokens: Tokens | null }, null>("shopifyStore:adoptStore");
type Tokens = Pick<Doc<"shopifyStores">, "encryptedAccessToken" | "encryptedRefreshToken" | "expiresAt" | "refreshExpiresAt">;
export const legacyConnections = internalQuery({
  args: {}, returns: v.array(v.object(legacyFields)),
  handler: async (ctx) => (await ctx.db.query("shopifyConnections").take(1000)).flatMap(row =>
    row.encryptedAccessToken === undefined || row.encryptedRefreshToken === undefined || row.expiresAt === undefined || row.refreshExpiresAt === undefined ? []
      : [{ ownerTokenIdentifier: row.ownerTokenIdentifier, shop: row.shop, encryptedAccessToken: row.encryptedAccessToken, encryptedRefreshToken: row.encryptedRefreshToken, expiresAt: row.expiresAt, refreshExpiresAt: row.refreshExpiresAt }]),
});
export const adoptStore = internalMutation({
  args: { shop: v.string(), tokens: v.union(v.object(tokenFields), v.null()) }, returns: v.null(),
  handler: async (ctx, { shop, tokens }) => {
    // A store connected since the deploy already has a newer token.
    if (tokens && !await storeFor(ctx, shop)) await ctx.db.insert("shopifyStores", { shop, ...tokens });
    for (const row of await ctx.db.query("shopifyConnections").withIndex("by_shop", q => q.eq("shop", shop)).take(1000)) {
      await ctx.db.patch(row._id, { encryptedAccessToken: undefined, encryptedRefreshToken: undefined, expiresAt: undefined, refreshExpiresAt: undefined, refreshLease: undefined });
    }
    return null;
  },
});
/** One-time move of per-account tokens into shopifyStores; run right after deploying shared stores. */
export const migrateSharedStores = internalAction({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    const newest = new Map<string, { ownerTokenIdentifier: string; shop: string } & Tokens>();
    for (const row of await ctx.runQuery(legacyConnectionsReference, {})) {
      // Only a store's most recently minted token still refreshes.
      if (row.expiresAt > (newest.get(row.shop)?.expiresAt ?? -Infinity)) newest.set(row.shop, row);
    }
    for (const row of newest.values()) {
      const from = `${row.ownerTokenIdentifier}|${row.shop}`;
      const tokens = await Promise.all([decryptToken(row.encryptedAccessToken, from), decryptToken(row.encryptedRefreshToken, from)])
        .then(async ([access, refresh]) => ({
          encryptedAccessToken: await encryptToken(access, storeAad(row.shop)), encryptedRefreshToken: await encryptToken(refresh, storeAad(row.shop)),
          expiresAt: row.expiresAt, refreshExpiresAt: row.refreshExpiresAt,
        }))
        .catch(() => null);
      await ctx.runMutation(adoptStoreReference, { shop: row.shop, tokens });
    }
    return null;
  },
});
