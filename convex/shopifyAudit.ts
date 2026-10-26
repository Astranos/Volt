import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action, mutation, query, type ActionCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { connectionFor, MAX_HIDDEN_PRODUCTS, MAX_SHOPIFY_STORES, removeConnection } from "./shopifyStore";
import { auditRange, decryptToken, encryptToken, exchangeToken, fetchProductDetails, fetchSearchProducts, fetchYesterday, MAX_COMPARE_PRODUCTS, nonce, nonceHash, productSearchQuery, requiredEnv, shopDomain, storeAad, type Product, type ProductDetails, type SearchProduct } from "./shopifyHelpers";

const begin = makeFunctionReference<"mutation", { ownerTokenIdentifier: string; shop: string; state: string; browserNonceHash: string }, null>("shopifyStore:begin");
const read = makeFunctionReference<"query", { ownerTokenIdentifier: string; shop?: string }, Doc<"shopifyStores"> | null>("shopifyStore:read");
const lease = makeFunctionReference<"mutation", { storeId: Doc<"shopifyStores">["_id"]; nonce: string }, boolean>("shopifyStore:leaseRefresh");
type Tokens = Pick<Doc<"shopifyStores">, "encryptedAccessToken" | "encryptedRefreshToken" | "expiresAt" | "refreshExpiresAt">;
const hiddenProductIds = makeFunctionReference<"query", { ownerTokenIdentifier: string; shop: string }, string[]>("shopifyStore:hiddenProductIds");
const finishRefresh = makeFunctionReference<"mutation", { storeId: Doc<"shopifyStores">["_id"]; nonce: string; tokens: Tokens | null }, null>("shopifyStore:finishRefresh");

export const startConnect = action({
  args: { shop: v.string() }, returns: v.object({ url: v.string(), browserCookie: v.object({ url: v.string(), name: v.string(), value: v.string() }) }),
  handler: async (ctx, args): Promise<{ url: string; browserCookie: { url: string; name: string; value: string } }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to connect Shopify.");
    const shop = shopDomain(args.shop);
    const clientId = requiredEnv("SHOPIFY_CLIENT_ID");
    requiredEnv("SHOPIFY_CLIENT_SECRET");
    // Validate server encryption before sending the merchant through authorization.
    await encryptToken("configuration-check", "configuration-check");
    const callback = new URL("/api/shopify/callback", requiredEnv("CONVEX_SITE_URL")).href;
    const state = nonce();
    const browserNonce = nonce();
    await ctx.runMutation(begin, { ownerTokenIdentifier: identity.tokenIdentifier, shop, state, browserNonceHash: await nonceHash(browserNonce) });
    const url = new URL(`https://${shop}/admin/oauth/authorize`);
    url.search = new URLSearchParams({ client_id: clientId, scope: "read_products", redirect_uri: callback, state }).toString();
    return { url: url.href, browserCookie: { url: callback, name: "volt_shopify_oauth", value: browserNonce } };
  },
});
/** The first-connected store; kept for extensions from before multiple stores. */
export const getConnection = query({
  args: {}, returns: v.union(v.object({ shop: v.string() }), v.null()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to view Shopify.");
    const row = await connectionFor(ctx, identity.tokenIdentifier);
    return row ? { shop: row.shop } : null;
  },
});
/** Every store connected to this account, oldest first. */
export const listConnections = query({
  args: {}, returns: v.array(v.object({ shop: v.string() })),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to view Shopify.");
    const rows = await ctx.db.query("shopifyConnections").withIndex("by_ownerTokenIdentifier", q => q.eq("ownerTokenIdentifier", identity.tokenIdentifier)).take(MAX_SHOPIFY_STORES);
    return rows.map(row => ({ shop: row.shop }));
  },
});
/** Disconnects one store, or every store when none is named. */
export const disconnect = mutation({
  args: { shop: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to disconnect Shopify.");
    const shop = args.shop === undefined ? undefined : shopDomain(args.shop);
    const rows = shop === undefined
      ? await ctx.db.query("shopifyConnections").withIndex("by_ownerTokenIdentifier", q => q.eq("ownerTokenIdentifier", identity.tokenIdentifier)).take(MAX_SHOPIFY_STORES + 1)
      : [await connectionFor(ctx, identity.tokenIdentifier, shop)];
    const state = await ctx.db.query("shopifyOAuthStates").withIndex("by_ownerTokenIdentifier", q => q.eq("ownerTokenIdentifier", identity.tokenIdentifier)).unique();
    for (const row of rows) if (row) await removeConnection(ctx, row);
    if (state && (shop === undefined || state.shop === shop)) await ctx.db.delete(state._id);
    return null;
  },
});
export const listYesterday = action({
  args: { startUtc: v.string(), endUtc: v.string(), date: v.string(), shop: v.optional(v.string()) },
  returns: v.object({ shop: v.string(), date: v.string(), products: v.array(v.object({ id: v.string(), title: v.string(), status: v.string(), url: v.string() })) }),
  handler: async (ctx, args): Promise<{ shop: string; date: string; products: Product[] }> => {
    const range = auditRange(args.startUtc, args.endUtc, args.date);
    return withShopifyAccess(ctx, args.shop, (shop, access) => fetchYesterday(shop, access, range));
  },
});
export const searchProducts = action({
  args: { query: v.string(), shop: v.optional(v.string()) },
  returns: v.object({
    shop: v.string(),
    products: v.array(v.object({
      id: v.string(), title: v.string(), status: v.string(), totalInventory: v.number(), url: v.string(), imageUrl: v.union(v.string(), v.null()),
      price: v.union(v.string(), v.null()), currencyCode: v.union(v.string(), v.null()),
      sku: v.union(v.string(), v.null()), condition: v.union(v.string(), v.null()),
    })),
  }),
  handler: async (ctx, args): Promise<{ shop: string; products: SearchProduct[] }> => {
    productSearchQuery(args.query);
    return withShopifyAccess(ctx, args.shop, async (shop, access, owner) => {
      const hidden = new Set(await ctx.runQuery(hiddenProductIds, { ownerTokenIdentifier: owner, shop }));
      return fetchSearchProducts(shop, access, args.query, hidden);
    });
  },
});
export const productDetails = action({
  args: { productIds: v.array(v.string()), shop: v.optional(v.string()) },
  returns: v.object({
    shop: v.string(),
    products: v.array(v.object({
      id: v.string(), title: v.string(), status: v.string(), totalInventory: v.number(), url: v.string(), images: v.array(v.string()),
      currencyCode: v.union(v.string(), v.null()), minPrice: v.union(v.string(), v.null()), maxPrice: v.union(v.string(), v.null()),
      condition: v.union(v.string(), v.null()), vendor: v.union(v.string(), v.null()), productType: v.union(v.string(), v.null()), descriptionHtml: v.string(),
      variants: v.array(v.object({ id: v.string(), title: v.string(), sku: v.union(v.string(), v.null()), price: v.union(v.string(), v.null()) })),
    })),
  }),
  handler: async (ctx, args): Promise<{ shop: string; products: ProductDetails[] }> => {
    if (!args.productIds.length || args.productIds.length > MAX_COMPARE_PRODUCTS) throw new ConvexError(`Compare 1 to ${MAX_COMPARE_PRODUCTS} products.`);
    return withShopifyAccess(ctx, args.shop, async (shop, access) => ({ shop, products: await fetchProductDetails(shop, access, args.productIds) }));
  },
});
export const listHiddenProducts = query({
  args: { shop: v.optional(v.string()) }, returns: v.array(v.object({ id: v.string(), title: v.string() })),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to view Shopify.");
    const connection = await connectionFor(ctx, identity.tokenIdentifier, args.shop === undefined ? undefined : shopDomain(args.shop));
    if (!connection) return [];
    const rows = await ctx.db.query("shopifyHiddenProducts")
      .withIndex("by_ownerTokenIdentifier_and_shop_and_productId", q => q.eq("ownerTokenIdentifier", identity.tokenIdentifier).eq("shop", connection.shop))
      .take(MAX_HIDDEN_PRODUCTS);
    return rows.map(row => ({ id: row.productId, title: row.title }));
  },
});
export const setProductHidden = mutation({
  args: { productId: v.string(), title: v.string(), hidden: v.boolean(), shop: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in to update Shopify.");
    if (!/^gid:\/\/shopify\/Product\/\d+$/.test(args.productId)) throw new ConvexError("Invalid Shopify product.");
    const title = args.title.trim().slice(0, 255);
    if (!title) throw new ConvexError("Invalid Shopify product.");
    const connection = await connectionFor(ctx, identity.tokenIdentifier, args.shop === undefined ? undefined : shopDomain(args.shop));
    if (!connection) throw new ConvexError(notConnected(args.shop));
    const existing = await ctx.db.query("shopifyHiddenProducts")
      .withIndex("by_ownerTokenIdentifier_and_shop_and_productId", q => q.eq("ownerTokenIdentifier", identity.tokenIdentifier).eq("shop", connection.shop).eq("productId", args.productId))
      .unique();
    if (!args.hidden) {
      if (existing) await ctx.db.delete(existing._id);
      return null;
    }
    if (existing) return null;
    const hiddenCount = (await ctx.db.query("shopifyHiddenProducts")
      .withIndex("by_ownerTokenIdentifier_and_shop_and_productId", q => q.eq("ownerTokenIdentifier", identity.tokenIdentifier).eq("shop", connection.shop))
      .take(MAX_HIDDEN_PRODUCTS)).length;
    if (hiddenCount >= MAX_HIDDEN_PRODUCTS) {
      throw new ConvexError(`You can hide up to ${MAX_HIDDEN_PRODUCTS} products.`);
    }
    await ctx.db.insert("shopifyHiddenProducts", { ownerTokenIdentifier: identity.tokenIdentifier, shop: connection.shop, productId: args.productId, title });
    return null;
  },
});

const notConnected = (shop: string | undefined) => shop === undefined ? "Connect your Shopify store first." : `${shopDomain(shop)} isn't connected to Volt. Connect it in Volt settings.`;

async function withShopifyAccess<T>(ctx: ActionCtx, requestedShop: string | undefined, load: (shop: string, access: string, owner: string) => Promise<T>): Promise<T> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in to view Shopify.");
  const lookup = { ownerTokenIdentifier: identity.tokenIdentifier, ...(requestedShop === undefined ? {} : { shop: shopDomain(requestedShop) }) };
  let row = await ctx.runQuery(read, lookup);
  if (!row) throw new ConvexError(notConnected(requestedShop));
  if (row.expiresAt <= Date.now() + 60000) {
    const refreshNonce = nonce();
    if (!await ctx.runMutation(lease, { storeId: row._id, nonce: refreshNonce })) throw new ConvexError("Shopify is refreshing access. Try again shortly.");
    try {
      if (row.refreshExpiresAt <= Date.now()) throw new ConvexError("Shopify authorization expired. Reconnect your store.");
      const aad = storeAad(row.shop);
      const tokens = await exchangeToken(row.shop, { grant_type: "refresh_token", refresh_token: await decryptToken(row.encryptedRefreshToken, aad) });
      await ctx.runMutation(finishRefresh, { storeId: row._id, nonce: refreshNonce, tokens: {
        encryptedAccessToken: await encryptToken(tokens.access, aad), encryptedRefreshToken: await encryptToken(tokens.refresh, aad), expiresAt: tokens.expiresAt, refreshExpiresAt: tokens.refreshExpiresAt,
      } });
    } catch (error) {
      await ctx.runMutation(finishRefresh, { storeId: row._id, nonce: refreshNonce, tokens: null }).catch(() => null);
      throw error;
    }
    row = await ctx.runQuery(read, { ...lookup, shop: row.shop });
    if (!row) throw new ConvexError("Store disconnected.");
  }
  const result = await load(row.shop, await decryptToken(row.encryptedAccessToken, storeAad(row.shop)), identity.tokenIdentifier);
  const current = await ctx.runQuery(read, { ...lookup, shop: row.shop });
  if (current?._id !== row._id) throw new ConvexError("Shopify connection changed. Try again.");
  return result;
}
