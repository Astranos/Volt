import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { auditRange, decryptToken, encryptToken, exchangeToken, fetchYesterday, nonce, requiredEnv, shopDomain, type Product } from "./shopifyHelpers";

const begin = makeFunctionReference<"mutation", { ownerTokenIdentifier: string; shop: string; state: string }, null>("shopifyStore:begin");
const read = makeFunctionReference<"query", { ownerTokenIdentifier: string }, Doc<"shopifyConnections"> | null>("shopifyStore:read");
const lease = makeFunctionReference<"mutation", { connectionId: Doc<"shopifyConnections">["_id"]; nonce: string }, boolean>("shopifyStore:leaseRefresh");
type Tokens = Pick<Doc<"shopifyConnections">, "encryptedAccessToken" | "encryptedRefreshToken" | "expiresAt" | "refreshExpiresAt">;
const finishRefresh = makeFunctionReference<"mutation", { connectionId: Doc<"shopifyConnections">["_id"]; nonce: string; tokens: Tokens | null }, null>("shopifyStore:finishRefresh");

export const startConnect = action({
  args: { shop: v.string() }, returns: v.object({ url: v.string() }),
  handler: async (ctx, args): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to connect Shopify.");
    const shop = shopDomain(args.shop);
    const clientId = requiredEnv("SHOPIFY_CLIENT_ID");
    requiredEnv("SHOPIFY_CLIENT_SECRET");
    // Validate server encryption before sending the merchant through authorization.
    await encryptToken("configuration-check", "configuration-check");
    const callback = new URL("/api/shopify/callback", requiredEnv("CONVEX_SITE_URL")).href;
    const state = nonce();
    await ctx.runMutation(begin, { ownerTokenIdentifier: identity.tokenIdentifier, shop, state });
    const url = new URL(`https://${shop}/admin/oauth/authorize`);
    url.search = new URLSearchParams({ client_id: clientId, scope: "read_products", redirect_uri: callback, state }).toString();
    return { url: url.href };
  },
});
export const getConnection = query({
  args: {}, returns: v.union(v.object({ shop: v.string() }), v.null()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to view Shopify.");
    const row = await ctx.db.query("shopifyConnections").withIndex("by_ownerTokenIdentifier", q => q.eq("ownerTokenIdentifier", identity.tokenIdentifier)).unique();
    return row ? { shop: row.shop } : null;
  },
});
export const disconnect = mutation({
  args: {}, returns: v.null(),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to disconnect Shopify.");
    const connection = await ctx.db.query("shopifyConnections").withIndex("by_ownerTokenIdentifier", q => q.eq("ownerTokenIdentifier", identity.tokenIdentifier)).unique();
    const state = await ctx.db.query("shopifyOAuthStates").withIndex("by_ownerTokenIdentifier", q => q.eq("ownerTokenIdentifier", identity.tokenIdentifier)).unique();
    if (connection) await ctx.db.delete(connection._id);
    if (state) await ctx.db.delete(state._id);
    return null;
  },
});
export const listYesterday = action({
  args: { startUtc: v.string(), endUtc: v.string(), date: v.string() },
  returns: v.object({ shop: v.string(), date: v.string(), products: v.array(v.object({ id: v.string(), title: v.string(), status: v.string(), url: v.string() })) }),
  handler: async (ctx, args): Promise<{ shop: string; date: string; products: Product[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to view Shopify.");
    const range = auditRange(args.startUtc, args.endUtc, args.date);
    let row = await ctx.runQuery(read, { ownerTokenIdentifier: identity.tokenIdentifier });
    if (!row) throw new ConvexError("Connect your Shopify store first.");
    if (row.expiresAt <= Date.now() + 60000) {
      const refreshNonce = nonce();
      if (!await ctx.runMutation(lease, { connectionId: row._id, nonce: refreshNonce })) throw new ConvexError("Shopify is refreshing access. Try again shortly.");
      try {
        if (row.refreshExpiresAt <= Date.now()) throw new ConvexError("Shopify authorization expired. Reconnect your store.");
        const aad = `${identity.tokenIdentifier}|${row.shop}`;
        const tokens = await exchangeToken(row.shop, { grant_type: "refresh_token", refresh_token: await decryptToken(row.encryptedRefreshToken, aad) });
        await ctx.runMutation(finishRefresh, { connectionId: row._id, nonce: refreshNonce, tokens: {
          encryptedAccessToken: await encryptToken(tokens.access, aad), encryptedRefreshToken: await encryptToken(tokens.refresh, aad), expiresAt: tokens.expiresAt, refreshExpiresAt: tokens.refreshExpiresAt,
        } });
      } catch (error) {
        await ctx.runMutation(finishRefresh, { connectionId: row._id, nonce: refreshNonce, tokens: null }).catch(() => null);
        throw error;
      }
      row = await ctx.runQuery(read, { ownerTokenIdentifier: identity.tokenIdentifier });
      if (!row) throw new ConvexError("Store disconnected.");
    }
    const result = await fetchYesterday(row.shop, await decryptToken(row.encryptedAccessToken, `${identity.tokenIdentifier}|${row.shop}`), range);
    const current = await ctx.runQuery(read, { ownerTokenIdentifier: identity.tokenIdentifier });
    if (current?._id !== row._id) throw new ConvexError("Shopify connection changed. Try again.");
    return result;
  },
});
