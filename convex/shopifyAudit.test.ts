import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { auditRange, decryptToken, encryptToken, fetchSearchProducts, fetchYesterday, nonceHash, productSearchQuery, shopDomain, verifyCallback } from "./shopifyHelpers";

const modules = import.meta.glob("./**/*.ts");
const get = makeFunctionReference<"query", Record<string, never>, { shop: string } | null>("shopifyAudit:getConnection");
const disconnect = makeFunctionReference<"mutation", Record<string, never>, null>("shopifyAudit:disconnect");
const start = makeFunctionReference<"action", { shop: string }, { url: string; browserCookie: { url: string; name: string; value: string } }>("shopifyAudit:startConnect");
const begin = makeFunctionReference<"mutation", { ownerTokenIdentifier: string; shop: string; state: string; browserNonceHash: string }, null>("shopifyStore:begin");
const consume = makeFunctionReference<"mutation", { shop: string; state: string; browserNonceHash: string }, { id: Id<"shopifyOAuthStates">; ownerTokenIdentifier: string }>("shopifyStore:consume");
type Tokens = Pick<Doc<"shopifyConnections">, "encryptedAccessToken" | "encryptedRefreshToken" | "expiresAt" | "refreshExpiresAt">;
const finish = makeFunctionReference<"mutation", { stateId: Id<"shopifyOAuthStates"> } & Tokens, null>("shopifyStore:finish");
const list = makeFunctionReference<"action", { startUtc: string; endUtc: string; date: string }, { shop: string; date: string; products: { id: string; title: string; status: string; url: string }[] }>("shopifyAudit:listYesterday");
const search = makeFunctionReference<"action", { query: string }, { shop: string; products: { id: string; title: string; status: string; totalInventory: number; url: string; imageUrl: string | null; price: string | null; currencyCode: string | null; sku: string | null; condition: string | null }[] }>("shopifyAudit:searchProducts");
const shop = "example-store.myshopify.com";
const state = "a".repeat(64);
const browserNonce = "b".repeat(64);
const browserNonceHash = await nonceHash(browserNonce);
const owner = "clerk|alice";
const tokens: Tokens = { encryptedAccessToken: "ciphertext", encryptedRefreshToken: "ciphertext", expiresAt: Date.now() + 3600000, refreshExpiresAt: Date.now() + 86400000 };
function yesterday() {
  const end = new Date(); end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - 86400000);
  return { startUtc: start.toISOString(), endUtc: end.toISOString(), date: start.toISOString().slice(0, 10) };
}
function productPage(hasNextPage: boolean, id: string, status = "DRAFT") {
  return new Response(JSON.stringify({ data: { products: { nodes: [{ id: `gid://shopify/Product/${id}`, legacyResourceId: id, title: `Product ${id}`, status }], pageInfo: { hasNextPage, endCursor: `cursor-${id}` } } } }), { headers: { "Content-Type": "application/json" } });
}
beforeEach(() => {
  vi.stubEnv("SHOPIFY_CLIENT_ID", "client-id");
  vi.stubEnv("SHOPIFY_CLIENT_SECRET", "secret");
  vi.stubEnv("SHOPIFY_TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
  vi.stubEnv("CONVEX_SITE_URL", "https://example.convex.site");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("Shopify authorization and account isolation", () => {
  test("rejects untrusted shop URLs and requires Clerk auth", async () => {
    for (const value of ["https://example.myshopify.com", "example.myshopify.com.evil.test", "evil.test", "a.myshopify.com/path", "a.myshopify.com:443", "a@b.myshopify.com"]) expect(() => shopDomain(value)).toThrow();
    expect(shopDomain(" EXAMPLE.myshopify.com ")).toBe("example.myshopify.com");
    const t = convexTest(schema, modules);
    await expect(t.action(start, { shop })).rejects.toThrow("Sign in");
    await expect(t.query(get, {})).rejects.toThrow("Sign in");
    await expect(t.mutation(disconnect, {})).rejects.toThrow("Sign in");
    await expect(t.action(list, yesterday())).rejects.toThrow("Sign in");
    const alice = t.withIdentity({ subject: "alice", tokenIdentifier: owner });
    const started = await alice.action(start, { shop });
    const result = new URL(started.url);
    expect(result.hostname).toBe(shop);
    expect(result.searchParams.get("redirect_uri")).toBe("https://example.convex.site/api/shopify/callback");
    expect(result.searchParams.get("scope")).toBe("read_products");
    expect(result.searchParams.get("state")).toMatch(/^[a-f0-9]{64}$/);
    expect(started.browserCookie).toEqual({ url: "https://example.convex.site/api/shopify/callback", name: "volt_shopify_oauth", value: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });
  test("validates HMAC and rejects tampering and duplicate parameters", async () => {
    const params = new URLSearchParams({ shop, state, code: "valid-code", timestamp: "123" });
    const message = [...params.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join("&");
    params.set("hmac", createHmac("sha256", "secret").update(message).digest("hex"));
    expect(await verifyCallback(params)).toEqual({ shop, state, code: "valid-code" });
    params.set("shop", "other.myshopify.com");
    await expect(verifyCallback(params)).rejects.toThrow("signature");
    params.append("state", state);
    await expect(verifyCallback(params)).rejects.toThrow("Duplicate");
  });
  test("callback exchanges an offline code once and stores only encrypted secrets", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(begin, { ownerTokenIdentifier: owner, shop, state, browserNonceHash });
    const params = new URLSearchParams({ shop, state, code: "code", timestamp: "123" });
    const message = [...params.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join("&");
    params.set("hmac", createHmac("sha256", "secret").update(message).digest("hex"));
    const mock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "private-access", refresh_token: "private-refresh", scope: "read_products", expires_in: 3600, refresh_token_expires_in: 86400 })));
    vi.stubGlobal("fetch", mock);
    expect((await t.fetch(`/api/shopify/callback?${params}`)).status).toBe(400);
    const response = await t.fetch(`/api/shopify/callback?${params}`, { headers: { Cookie: `volt_shopify_oauth=${browserNonce}` } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Shopify connected");
    expect(String(mock.mock.calls[0][1]?.body)).toContain("expiring=1");
    const row = await t.run(ctx => ctx.db.query("shopifyConnections").first());
    expect(JSON.stringify(row)).not.toContain("private-");
    expect(await decryptToken(row?.encryptedAccessToken ?? "", `${owner}|${shop}`)).toBe("private-access");
    expect((await t.fetch(`/api/shopify/callback?${params}`, { headers: { Cookie: `volt_shopify_oauth=${browserNonce}` } })).status).toBe(400);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  test("state is bound to exact shop, single-use, and expiry", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(begin, { ownerTokenIdentifier: owner, shop, state, browserNonceHash });
    await expect(t.mutation(consume, { shop: "other.myshopify.com", state, browserNonceHash })).rejects.toThrow("expired");
    await expect(t.mutation(consume, { shop, state, browserNonceHash: await nonceHash("c".repeat(64)) })).rejects.toThrow("expired");
    await t.mutation(consume, { shop, state, browserNonceHash });
    await expect(t.mutation(consume, { shop, state, browserNonceHash })).rejects.toThrow("expired");
    await t.mutation(begin, { ownerTokenIdentifier: owner, shop, state, browserNonceHash });
    await t.run(async ctx => {
      const row = await ctx.db.query("shopifyOAuthStates").first();
      if (row) await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });
    await expect(t.mutation(consume, { shop, state, browserNonceHash })).rejects.toThrow("expired");
  });
  test("isolates accounts and disconnect cancels an in-flight OAuth callback", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice", tokenIdentifier: owner });
    const bob = t.withIdentity({ subject: "bob", tokenIdentifier: "clerk|bob" });
    await t.mutation(begin, { ownerTokenIdentifier: owner, shop, state, browserNonceHash });
    const consumed = await t.mutation(consume, { shop, state, browserNonceHash });
    await t.mutation(finish, { stateId: consumed.id, ...tokens });
    expect(await alice.query(get, {})).toEqual({ shop });
    expect(await bob.query(get, {})).toBeNull();
    await bob.mutation(disconnect, {});
    expect(await alice.query(get, {})).toEqual({ shop });
    await t.mutation(begin, { ownerTokenIdentifier: owner, shop, state, browserNonceHash });
    const pending = await t.mutation(consume, { shop, state, browserNonceHash });
    await alice.mutation(disconnect, {});
    await expect(t.mutation(finish, { stateId: pending.id, ...tokens })).rejects.toThrow("canceled");
    expect(await alice.query(get, {})).toBeNull();
  });
  test("encrypts secrets with randomized authenticated encryption bound to account and shop", async () => {
    const aad = `${owner}|${shop}`;
    const encrypted = await encryptToken("private-token", aad);
    expect(encrypted).not.toContain("private-token");
    expect(encrypted).not.toBe(await encryptToken("private-token", aad));
    expect(await decryptToken(encrypted, aad)).toBe("private-token");
    await expect(decryptToken(encrypted, `clerk|bob|${shop}`)).rejects.toThrow();
  });
});

test("customer compliance payload cannot be replayed as shop redaction", async () => {
  const t = convexTest(schema, modules);
  const customerBody = JSON.stringify({ shop_id: 954889, shop_domain: shop, customer: { id: 191167 }, orders_requested: [] });
  const customerSignature = createHmac("sha256", "secret").update(customerBody).digest("base64");
  const replay = await t.fetch("/api/shopify/webhooks/shop/redact", {
    method: "POST",
    headers: { "X-Shopify-Hmac-Sha256": customerSignature, "X-Shopify-Topic": "shop/redact" },
    body: customerBody,
  });
  expect(replay.status).toBe(400);
  const shopBody = JSON.stringify({ shop_id: 954889, shop_domain: shop });
  const shopSignature = createHmac("sha256", "secret").update(shopBody).digest("base64");
  const valid = await t.fetch("/api/shopify/webhooks/shop/redact", {
    method: "POST",
    headers: { "X-Shopify-Hmac-Sha256": shopSignature, "X-Shopify-Topic": "shop/redact" },
    body: shopBody,
  });
  expect(valid.status).toBe(200);
});

describe("Shopify previous calendar day", () => {
  test("accepts DST-length intervals and rejects invalid or broad ranges", () => {
    const args = yesterday();
    for (const hours of [23, 24, 25]) {
      const start = new Date(Date.parse(args.endUtc) - hours * 3600000).toISOString();
      expect(auditRange(start, args.endUtc, args.date).start).toBe(start);
    }
    expect(() => auditRange(args.endUtc, args.startUtc, args.date)).toThrow();
    expect(() => auditRange("not-a-date", args.endUtc, args.date)).toThrow();
    expect(() => auditRange("2020-01-01T00:00:00.000Z", "2020-01-02T00:00:00.000Z", "2020-01-01")).toThrow();
  });
  test("paginates every status and uses inclusive start / exclusive end creation dates", async () => {
    const mock = vi.fn<typeof fetch>().mockResolvedValueOnce(productPage(true, "1", "ARCHIVED")).mockResolvedValueOnce(productPage(false, "2", "UNLISTED"));
    vi.stubGlobal("fetch", mock);
    const args = yesterday();
    const result = await fetchYesterday(shop, "secret-access", auditRange(args.startUtc, args.endUtc, args.date));
    expect(result.products.map(p => p.status)).toEqual(["ARCHIVED", "UNLISTED"]);
    expect(result.products[1].url).toBe("https://admin.shopify.com/store/example-store/products/2");
    expect(mock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(mock.mock.calls[0][1]?.body));
    const second = JSON.parse(String(mock.mock.calls[1][1]?.body));
    expect(first.query).toContain("first: 250");
    expect(first.variables.search).toBe(`created_at:>='${args.startUtc}' created_at:<'${args.endUtc}' status:active,archived,draft,unlisted`);
    expect(second.variables.cursor).toBe("cursor-1");
  });
  test("retries throttling and rejects a failed later page without returning partial results", async () => {
    vi.useFakeTimers();
    const mock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(productPage(false, "1"));
    vi.stubGlobal("fetch", mock);
    const args = yesterday();
    const pending = fetchYesterday(shop, "access", auditRange(args.startUtc, args.endUtc, args.date));
    await vi.runAllTimersAsync();
    expect((await pending).products).toHaveLength(1);
    expect(mock).toHaveBeenCalledTimes(2);
    mock.mockResolvedValueOnce(productPage(true, "2"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }] })));
    await expect(fetchYesterday(shop, "access", auditRange(args.startUtc, args.endUtc, args.date))).rejects.toThrow("permissions");
  });
  test("refreshes expired access server-side and never returns either token", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice", tokenIdentifier: owner });
    const aad = `${owner}|${shop}`;
    const encryptedRefresh = await encryptToken("old-refresh", aad);
    await t.run(ctx => ctx.db.insert("shopifyConnections", { ownerTokenIdentifier: owner, shop, encryptedAccessToken: "expired", encryptedRefreshToken: encryptedRefresh, expiresAt: Date.now() - 1, refreshExpiresAt: Date.now() + 86400000 }));
    const mock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", scope: "read_products", expires_in: 3600, refresh_token_expires_in: 86400 }))).mockResolvedValueOnce(productPage(false, "123"));
    vi.stubGlobal("fetch", mock);
    const result = await alice.action(list, yesterday());
    expect(result.products).toHaveLength(1);
    expect(String(mock.mock.calls[0][1]?.body)).toContain("grant_type=refresh_token");
    expect(String(mock.mock.calls[0][1]?.body)).toContain("refresh_token=old-refresh");
    expect(JSON.stringify(result)).not.toContain("new-access");
    const stored = await t.run(ctx => ctx.db.query("shopifyConnections").first());
    expect(stored?.encryptedAccessToken).not.toBe("new-access");
    expect(await decryptToken(stored?.encryptedRefreshToken ?? "", aad)).toBe("new-refresh");
  });
});

describe("Shopify live product search", () => {
  test("normalizes literal terms for prefix search and rejects broad input", () => {
    expect(productSearchQuery("  iPhone 13  ")).toBe("iphone 13*");
    expect(productSearchQuery("AC:DC OR")).toBe("ac dc or*");
    expect(() => productSearchQuery("a")).toThrow("2 to 120");
    expect(() => productSearchQuery("a".repeat(121))).toThrow("2 to 120");
    expect(() => productSearchQuery("--")).toThrow("product name");
  });
  test("puts in-stock results first while preserving Shopify relevance within each group", async () => {
    const node = (id: string, inventory: number, imageUrl: string | null = null) => ({
      id: `gid://shopify/Product/${id}`, legacyResourceId: id, title: `Product ${id}`, status: "ACTIVE", totalInventory: inventory,
      featuredMedia: imageUrl ? { preview: { image: { url: imageUrl } } } : null,
      priceRangeV2: { minVariantPrice: { amount: "19.99", currencyCode: "USD" } },
      conditionMetafield: id === "1" ? { value: "New" } : null,
      tags: id === "3" ? ["condition: Used - Good"] : [],
      variants: { nodes: id === "1" ? [{ sku: "OTHER" }, { sku: "IPHONE 13 BLUE" }] : [{ sku: `SKU-${id}` }] },
    });
    const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: {
      inStock: { nodes: [node("3", 2), node("1", 10, "https://cdn.shopify.com/image.jpg")] },
      outOfStock: { nodes: [node("2", 0), node("4", -1)] },
    } })));
    vi.stubGlobal("fetch", mock);
    const result = await fetchSearchProducts(shop, "secret-access", "  iPhone 13 ");
    expect(result.shop).toBe(shop);
    expect(result.products.map(product => product.id)).toEqual(["gid://shopify/Product/3", "gid://shopify/Product/1", "gid://shopify/Product/2", "gid://shopify/Product/4"]);
    expect(result.products[1]).toMatchObject({ totalInventory: 10, imageUrl: "https://cdn.shopify.com/image.jpg", url: "https://admin.shopify.com/store/example-store/products/1", price: "19.99", currencyCode: "USD", sku: "IPHONE 13 BLUE", condition: "New" });
    expect(result.products[0].imageUrl).toBeNull();
    expect(result.products[0].condition).toBe("Used - Good");
    expect(result.products[2].condition).toBeNull();
    const request = JSON.parse(String(mock.mock.calls[0][1]?.body));
    expect(request.query).toContain("sortKey: RELEVANCE");
    expect(request.variables).toEqual({ inStock: "iphone 13* status:active,archived,draft,unlisted inventory_total:>0", outOfStock: "iphone 13* status:active,archived,draft,unlisted inventory_total:<=0" });
    expect(mock.mock.calls[0][1]?.headers).toMatchObject({ "X-Shopify-Access-Token": "secret-access" });
  });
  test("caps results at 30 and rejects an invalid product link ID", async () => {
    const node = (id: string, totalInventory: number) => ({
      id: `gid://shopify/Product/${id}`, legacyResourceId: id, title: `Product ${id}`, status: "ACTIVE", totalInventory,
      featuredMedia: null, priceRangeV2: { minVariantPrice: { amount: "5.00", currencyCode: "USD" } },
      conditionMetafield: null, tags: [], variants: { nodes: [] },
    });
    const inStock = Array.from({ length: 30 }, (_, index) => node(String(index + 1), 1));
    const mock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ data: {
      inStock: { nodes: inStock }, outOfStock: { nodes: [node("31", 0)] },
    } })));
    vi.stubGlobal("fetch", mock);
    const result = await fetchSearchProducts(shop, "access", "phone");
    expect(result.products).toHaveLength(30);
    expect(result.products.every(product => product.totalInventory > 0)).toBe(true);
    mock.mockResolvedValueOnce(new Response(JSON.stringify({ data: {
      inStock: { nodes: [{ ...node("1", 1), id: "gid://shopify/Collection/1" }] }, outOfStock: { nodes: [] },
    } })));
    await expect(fetchSearchProducts(shop, "access", "phone")).rejects.toThrow("invalid product ID");
  });
  test("requires the connected account and does not expose its token", async () => {
    const t = convexTest(schema, modules);
    await expect(t.action(search, { query: "phone" })).rejects.toThrow("Sign in");
    const alice = t.withIdentity({ subject: "alice", tokenIdentifier: owner });
    await expect(alice.action(search, { query: "phone" })).rejects.toThrow("Connect your Shopify store");
    const aad = `${owner}|${shop}`;
    const encryptedAccessToken = await encryptToken("private-access", aad);
    const encryptedRefreshToken = await encryptToken("private-refresh", aad);
    await t.run(ctx => ctx.db.insert("shopifyConnections", {
      ownerTokenIdentifier: owner, shop, encryptedAccessToken,
      encryptedRefreshToken, expiresAt: Date.now() + 3600000, refreshExpiresAt: Date.now() + 86400000,
    }));
    const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: {
      inStock: { nodes: [{ id: "gid://shopify/Product/123", legacyResourceId: "123", title: "Phone", status: "ACTIVE", totalInventory: 1, featuredMedia: null, priceRangeV2: { minVariantPrice: { amount: "2.00", currencyCode: "USD" } }, conditionMetafield: null, tags: [], variants: { nodes: [{ sku: "PHONE-123" }] } }] },
      outOfStock: { nodes: [] },
    } })));
    vi.stubGlobal("fetch", mock);
    const result = await alice.action(search, { query: "phone" });
    expect(result.products).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("private-");
    const bob = t.withIdentity({ subject: "bob", tokenIdentifier: "clerk|bob" });
    await expect(bob.action(search, { query: "phone" })).rejects.toThrow("Connect your Shopify store");
  });
});
