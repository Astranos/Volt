import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { auditRange, decryptToken, encryptToken, fetchProductDetails, fetchSearchProducts, fetchYesterday, nonceHash, productSearchQuery, shopDomain, storeAad, verifyCallback } from "./shopifyHelpers";

const modules = import.meta.glob("./**/*.ts");
const get = makeFunctionReference<"query", Record<string, never>, { shop: string } | null>("shopifyAudit:getConnection");
const disconnect = makeFunctionReference<"mutation", Record<string, never>, null>("shopifyAudit:disconnect");
const start = makeFunctionReference<"action", { shop: string }, { url: string; browserCookie: { url: string; name: string; value: string } }>("shopifyAudit:startConnect");
const begin = makeFunctionReference<"mutation", { ownerTokenIdentifier: string; shop: string; state: string; browserNonceHash: string }, null>("shopifyStore:begin");
const consume = makeFunctionReference<"mutation", { shop: string; state: string; browserNonceHash: string }, { id: Id<"shopifyOAuthStates">; ownerTokenIdentifier: string }>("shopifyStore:consume");
type Tokens = Pick<Doc<"shopifyStores">, "encryptedAccessToken" | "encryptedRefreshToken" | "expiresAt" | "refreshExpiresAt">;
const finish = makeFunctionReference<"mutation", { stateId: Id<"shopifyOAuthStates">; shop: string } & Tokens, boolean>("shopifyStore:finish");
const list = makeFunctionReference<"action", { startUtc: string; endUtc: string; date: string }, { shop: string; date: string; products: { id: string; title: string; status: string; url: string }[] }>("shopifyAudit:listYesterday");
const search = makeFunctionReference<"action", { query: string; shop?: string }, { shop: string; products: { id: string; title: string; status: string; totalInventory: number; url: string; imageUrl: string | null; price: string | null; currencyCode: string | null; sku: string | null; condition: string | null }[] }>("shopifyAudit:searchProducts");
const shop = "example-store.myshopify.com";
const state = "a".repeat(64);
const browserNonce = "b".repeat(64);
const browserNonceHash = await nonceHash(browserNonce);
const owner = "clerk|alice";
const tokens: Tokens = { encryptedAccessToken: "ciphertext", encryptedRefreshToken: "ciphertext", expiresAt: Date.now() + 3600000, refreshExpiresAt: Date.now() + 86400000 };
type TestConvex = ReturnType<typeof testConvex>;
const testConvex = () => convexTest(schema, modules);
/** Connects `account` to `store`, creating the store's shared token unless it already has one. */
async function connectStore(t: TestConvex, account: string, store: string, access = "access", expiresAt = Date.now() + 3600000, refresh = "refresh") {
  await t.run(async ctx => {
    await ctx.db.insert("shopifyConnections", { ownerTokenIdentifier: account, shop: store });
    if (await ctx.db.query("shopifyStores").withIndex("by_shop", q => q.eq("shop", store)).unique()) return;
    await ctx.db.insert("shopifyStores", {
      shop: store, encryptedAccessToken: await encryptToken(access, storeAad(store)), encryptedRefreshToken: await encryptToken(refresh, storeAad(store)),
      expiresAt, refreshExpiresAt: Date.now() + 86400000,
    });
  });
}
function yesterday() {
  const end = new Date(); end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - 86400000);
  return { startUtc: start.toISOString(), endUtc: end.toISOString(), date: start.toISOString().slice(0, 10) };
}
function productNode(id: string, status = "DRAFT", tags: string[] = []) {
  return { id: `gid://shopify/Product/${id}`, legacyResourceId: id, title: `Product ${id}`, status, tags };
}
function productPage(hasNextPage: boolean, id: string, status = "DRAFT", extraNodes: ReturnType<typeof productNode>[] = []) {
  return new Response(JSON.stringify({ data: { products: { nodes: [productNode(id, status), ...extraNodes], pageInfo: { hasNextPage, endCursor: `cursor-${id}` } } } }), { headers: { "Content-Type": "application/json" } });
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
    const row = await t.run(ctx => ctx.db.query("shopifyStores").first());
    expect(JSON.stringify(row)).not.toContain("private-");
    expect(await decryptToken(row?.encryptedAccessToken ?? "", storeAad(shop))).toBe("private-access");
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
    await t.mutation(finish, { stateId: consumed.id, shop, ...tokens });
    expect(await alice.query(get, {})).toEqual({ shop });
    expect(await bob.query(get, {})).toBeNull();
    await bob.mutation(disconnect, {});
    expect(await alice.query(get, {})).toEqual({ shop });
    await t.mutation(begin, { ownerTokenIdentifier: owner, shop, state, browserNonceHash });
    const pending = await t.mutation(consume, { shop, state, browserNonceHash });
    await alice.mutation(disconnect, {});
    expect(await t.mutation(finish, { stateId: pending.id, shop, ...tokens })).toBe(false);
    expect(await alice.query(get, {})).toBeNull();
  });
  test("connects several stores to one account and disconnects them one at a time", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice", tokenIdentifier: owner });
    const listConnections = makeFunctionReference<"query", Record<string, never>, { shop: string }[]>("shopifyAudit:listConnections");
    const disconnectShop = makeFunctionReference<"mutation", { shop?: string }, null>("shopifyAudit:disconnect");
    const connect = async (store: string, storeState: string) => {
      await t.mutation(begin, { ownerTokenIdentifier: owner, shop: store, state: storeState, browserNonceHash });
      const consumed = await t.mutation(consume, { shop: store, state: storeState, browserNonceHash });
      await t.mutation(finish, { stateId: consumed.id, shop: store, ...tokens });
    };
    const stores = ["one", "two", "three", "four", "five"].map(name => `${name}.myshopify.com`);
    for (const [index, store] of stores.entries()) await connect(store, String(index).repeat(64));
    // Reconnecting a store replaces it in place instead of adding a duplicate, so
    // the first-connected store stays the default for clients that omit a shop.
    await connect(stores[1], "c".repeat(64));
    await connect(stores[0], "e".repeat(64));
    expect(await alice.query(listConnections, {})).toEqual(stores.map(store => ({ shop: store })));
    expect(await alice.query(get, {})).toEqual({ shop: stores[0] });
    await expect(t.mutation(begin, { ownerTokenIdentifier: owner, shop: "six.myshopify.com", state: "d".repeat(64), browserNonceHash })).rejects.toThrow("up to 5");

    await alice.mutation(disconnectShop, { shop: stores[0] });
    expect((await alice.query(listConnections, {})).map(row => row.shop)).not.toContain(stores[0]);
    expect(await alice.query(get, {})).toEqual({ shop: stores[1] });
    await expect(alice.action(search, { query: "phone", shop: stores[0] })).rejects.toThrow("isn't connected");
    await alice.mutation(disconnectShop, {});
    expect(await alice.query(listConnections, {})).toEqual([]);
  });
  test("searches the store that was asked for", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice", tokenIdentifier: owner });
    const second = "second-store.myshopify.com";
    for (const store of [shop, second]) await connectStore(t, owner, store, `access-${store}`);
    const mock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ data: { inStock: { nodes: [] }, outOfStock: { nodes: [] } } })));
    vi.stubGlobal("fetch", mock);
    expect((await alice.action(search, { query: "phone" })).shop).toBe(shop);
    expect((await alice.action(search, { query: "phone", shop: second })).shop).toBe(second);
    expect(String(mock.mock.calls[1][0])).toContain(second);
    expect(new Headers(mock.mock.calls[1][1]?.headers).get("X-Shopify-Access-Token")).toBe(`access-${second}`);
  });
  test("accounts connected to the same store share its token, so reconnecting doesn't lock others out", async () => {
    const t = convexTest(schema, modules);
    const bobOwner = "clerk|bob";
    const alice = t.withIdentity({ subject: "alice", tokenIdentifier: owner });
    const bob = t.withIdentity({ subject: "bob", tokenIdentifier: bobOwner });
    const disconnectShop = makeFunctionReference<"mutation", { shop?: string }, null>("shopifyAudit:disconnect");
    const connect = async (account: string, access: string, accountState: string) => {
      await t.mutation(begin, { ownerTokenIdentifier: account, shop, state: accountState, browserNonceHash });
      const consumed = await t.mutation(consume, { shop, state: accountState, browserNonceHash });
      const aad = storeAad(shop);
      await t.mutation(finish, { stateId: consumed.id, shop, ...tokens, encryptedAccessToken: await encryptToken(access, aad), encryptedRefreshToken: await encryptToken("refresh", aad) });
    };
    await connect(owner, "alice-access", "1".repeat(64));
    await connect(bobOwner, "bob-access", "2".repeat(64));
    expect(await t.run(ctx => ctx.db.query("shopifyStores").collect())).toHaveLength(1);
    const mock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ data: { inStock: { nodes: [] }, outOfStock: { nodes: [] } } })));
    vi.stubGlobal("fetch", mock);
    await alice.action(search, { query: "phone" });
    // Bob's newer token is the only one Shopify still honors, and Alice uses it too.
    expect(new Headers(mock.mock.calls[0][1]?.headers).get("X-Shopify-Access-Token")).toBe("bob-access");

    // A connect that fails after Shopify issued a token still replaces the retired shared one.
    await t.mutation(begin, { ownerTokenIdentifier: "clerk|carol", shop, state: "3".repeat(64), browserNonceHash });
    const canceled = await t.mutation(consume, { shop, state: "3".repeat(64), browserNonceHash });
    await t.run(ctx => ctx.db.delete(canceled.id));
    expect(await t.mutation(finish, { stateId: canceled.id, shop, ...tokens, encryptedAccessToken: await encryptToken("carol-access", storeAad(shop)) })).toBe(false);
    await alice.action(search, { query: "phone" });
    expect(new Headers(mock.mock.calls[1][1]?.headers).get("X-Shopify-Access-Token")).toBe("carol-access");

    await bob.mutation(disconnectShop, { shop });
    expect((await alice.action(search, { query: "phone" })).shop).toBe(shop);
    await expect(bob.action(search, { query: "phone" })).rejects.toThrow("Connect your Shopify store");
    await alice.mutation(disconnectShop, { shop });
    expect(await t.run(ctx => ctx.db.query("shopifyStores").collect())).toEqual([]);
  });
  test("migrates per-account tokens to one shared token per store, keeping the newest", async () => {
    const t = convexTest(schema, modules);
    const migrate = makeFunctionReference<"action", Record<string, never>, null>("shopifyStore:migrateSharedStores");
    const legacy = async (account: string, store: string, access: string, expiresAt: number) => {
      const aad = `${account}|${store}`;
      await t.run(async ctx => ctx.db.insert("shopifyConnections", {
        ownerTokenIdentifier: account, shop: store, encryptedAccessToken: await encryptToken(access, aad),
        encryptedRefreshToken: await encryptToken(`${access}-refresh`, aad), expiresAt, refreshExpiresAt: Date.now() + 86400000,
      }));
    };
    await legacy(owner, shop, "older", Date.now() - 3600000);
    await legacy("clerk|bob", shop, "newer", Date.now() + 1800000);
    await t.action(migrate, {});
    const rows = await t.run(async ctx => ({ stores: await ctx.db.query("shopifyStores").collect(), connections: await ctx.db.query("shopifyConnections").collect() }));
    expect(rows.stores.map(row => row.shop)).toEqual([shop]);
    expect(await decryptToken(rows.stores[0].encryptedAccessToken, storeAad(shop))).toBe("newer");
    expect(await decryptToken(rows.stores[0].encryptedRefreshToken, storeAad(shop))).toBe("newer-refresh");
    expect(rows.connections.map(({ ownerTokenIdentifier, shop: store, encryptedAccessToken, expiresAt }) => ({ ownerTokenIdentifier, store, encryptedAccessToken, expiresAt })))
      .toEqual([{ ownerTokenIdentifier: owner, store: shop }, { ownerTokenIdentifier: "clerk|bob", store: shop }]);
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
  test("accepts the last 2 or 3 days ending yesterday, but nothing longer", () => {
    const { endUtc } = yesterday();
    const range = (days: number) => {
      const start = new Date(Date.parse(endUtc) - days * 86400000).toISOString();
      return () => auditRange(start, endUtc, start.slice(0, 10));
    };
    expect(range(2)().start).toBe(new Date(Date.parse(endUtc) - 2 * 86400000).toISOString());
    expect(range(3)().date).toBe(new Date(Date.parse(endUtc) - 3 * 86400000).toISOString().slice(0, 10));
    expect(range(4)).toThrow("Invalid audit date range.");
    // Partial days don't count, even when they end yesterday or span about two days.
    const partial = (hours: number) => () => {
      const start = new Date(Date.parse(endUtc) - hours * 3600000).toISOString();
      return auditRange(start, endUtc, start.slice(0, 10));
    };
    expect(partial(36)).toThrow("Invalid audit date range.");
    expect(partial(60)).toThrow("Invalid audit date range.");
    expect(partial(47)().start).toBeTruthy(); // a 2-day range across a daylight saving change
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
  test("skips products tagged checkout", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(productPage(false, "1", "ACTIVE", [
      productNode("2", "ACTIVE", ["checkout"]), productNode("3", "ACTIVE", [" Checkout "]), productNode("4", "ACTIVE", ["checkout-ready"]),
    ])));
    const args = yesterday();
    const result = await fetchYesterday(shop, "access", auditRange(args.startUtc, args.endUtc, args.date));
    expect(result.products.map(p => p.id)).toEqual(["gid://shopify/Product/1", "gid://shopify/Product/4"]);
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
    await connectStore(t, owner, shop, "expired", Date.now() - 1, "old-refresh");
    const mock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", scope: "read_products", expires_in: 3600, refresh_token_expires_in: 86400 }))).mockResolvedValueOnce(productPage(false, "123"));
    vi.stubGlobal("fetch", mock);
    const result = await alice.action(list, yesterday());
    expect(result.products).toHaveLength(1);
    expect(String(mock.mock.calls[0][1]?.body)).toContain("grant_type=refresh_token");
    expect(String(mock.mock.calls[0][1]?.body)).toContain("refresh_token=old-refresh");
    expect(JSON.stringify(result)).not.toContain("new-access");
    const stored = await t.run(ctx => ctx.db.query("shopifyStores").first());
    expect(stored?.encryptedAccessToken).not.toBe("new-access");
    expect(await decryptToken(stored?.encryptedRefreshToken ?? "", storeAad(shop))).toBe("new-refresh");
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
  test("loads compare details in the picked order and skips deleted products", async () => {
    const node = (id: string) => ({
      id: `gid://shopify/Product/${id}`, legacyResourceId: id, title: `Product ${id}`, status: "ACTIVE", totalInventory: 2,
      tags: [], vendor: "Apple", productType: "Phones", descriptionHtml: "<p>Unlocked</p>",
      media: { nodes: [{ preview: { image: { url: "https://cdn.shopify.com/a.jpg" } } }, { preview: null }] },
      priceRangeV2: { minVariantPrice: { amount: "199.00", currencyCode: "USD" }, maxVariantPrice: { amount: "249.00", currencyCode: "USD" } },
      conditionMetafield: { value: "Used - Good" },
      variants: { nodes: [{ id: "gid://shopify/ProductVariant/9", title: "128GB", sku: " IP-128 ", price: "199.00" }] },
    });
    const mock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { nodes: [node("1"), null, node("2")] } })));
    vi.stubGlobal("fetch", mock);
    const ids = ["gid://shopify/Product/2", "gid://shopify/Product/3", "gid://shopify/Product/1"];
    const products = await fetchProductDetails(shop, "access", ids);
    expect(products.map(product => product.id)).toEqual(["gid://shopify/Product/2", "gid://shopify/Product/1"]);
    expect(products[0]).toMatchObject({ images: ["https://cdn.shopify.com/a.jpg"], minPrice: "199.00", maxPrice: "249.00", currencyCode: "USD", condition: "Used - Good", vendor: "Apple", descriptionHtml: "<p>Unlocked</p>", variants: [{ title: "128GB", sku: "IP-128", price: "199.00" }] });
    expect(JSON.parse(String(mock.mock.calls[0][1]?.body)).variables).toEqual({ ids });
    await expect(fetchProductDetails(shop, "access", ["gid://shopify/Collection/1"])).rejects.toThrow("Compare 1 to 8");
    await expect(fetchProductDetails(shop, "access", [])).rejects.toThrow("Compare 1 to 8");
  });
  test("requires the connected account and does not expose its token", async () => {
    const t = convexTest(schema, modules);
    await expect(t.action(search, { query: "phone" })).rejects.toThrow("Sign in");
    const alice = t.withIdentity({ subject: "alice", tokenIdentifier: owner });
    await expect(alice.action(search, { query: "phone" })).rejects.toThrow("Connect your Shopify store");
    await connectStore(t, owner, shop, "private-access", Date.now() + 3600000, "private-refresh");
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

describe("Shopify hidden products", () => {
  const listHidden = makeFunctionReference<"query", Record<string, never>, { id: string; title: string }[]>("shopifyAudit:listHiddenProducts");
  const setHidden = makeFunctionReference<"mutation", { productId: string; title: string; hidden: boolean }, null>("shopifyAudit:setProductHidden");
  const searchNode = (id: string) => ({ id: `gid://shopify/Product/${id}`, legacyResourceId: id, title: `Product ${id}`, status: "ACTIVE", totalInventory: 1, featuredMedia: null, priceRangeV2: null, conditionMetafield: null, tags: [], variants: { nodes: [] } });

  test("skips hidden IDs before capping results", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ data: {
      inStock: { nodes: Array.from({ length: 30 }, (_, index) => searchNode(String(index + 1))) }, outOfStock: { nodes: [{ ...searchNode("31"), totalInventory: 0 }] },
    } }))));
    const result = await fetchSearchProducts(shop, "access", "phone", new Set(["gid://shopify/Product/2"]));
    expect(result.products).toHaveLength(30);
    expect(result.products.map(p => p.id)).not.toContain("gid://shopify/Product/2");
    expect(result.products.at(-1)?.id).toBe("gid://shopify/Product/31");
  });

  test("stores hidden products per account and store, and filters live search", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice", tokenIdentifier: owner });
    await expect(t.query(listHidden, {})).rejects.toThrow("Sign in");
    expect(await alice.query(listHidden, {})).toEqual([]);
    await expect(alice.mutation(setHidden, { productId: "gid://shopify/Product/1", title: "Phone", hidden: true })).rejects.toThrow("Connect your Shopify store");
    await connectStore(t, owner, shop);
    await expect(alice.mutation(setHidden, { productId: "gid://shopify/Collection/1", title: "Phone", hidden: true })).rejects.toThrow("Invalid Shopify product");
    await alice.mutation(setHidden, { productId: "gid://shopify/Product/1", title: " Phone ", hidden: true });
    await alice.mutation(setHidden, { productId: "gid://shopify/Product/1", title: "Phone", hidden: true });
    expect(await alice.query(listHidden, {})).toEqual([{ id: "gid://shopify/Product/1", title: "Phone" }]);

    // Bob on the same shop has his own list.
    const bobOwner = "clerk|bob";
    const bob = t.withIdentity({ subject: "bob", tokenIdentifier: bobOwner });
    await connectStore(t, bobOwner, shop);
    expect(await bob.query(listHidden, {})).toEqual([]);
    await bob.mutation(setHidden, { productId: "gid://shopify/Product/2", title: "Case", hidden: true });

    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ data: {
      inStock: { nodes: [searchNode("1"), searchNode("2")] }, outOfStock: { nodes: [] },
    } }))));
    expect((await alice.action(search, { query: "phone" })).products.map(p => p.id)).toEqual(["gid://shopify/Product/2"]);
    expect((await bob.action(search, { query: "phone" })).products.map(p => p.id)).toEqual(["gid://shopify/Product/1"]);

    // Bob unhiding doesn't touch Alice's list.
    await bob.mutation(setHidden, { productId: "gid://shopify/Product/1", title: "Phone", hidden: false });
    expect(await alice.query(listHidden, {})).toEqual([{ id: "gid://shopify/Product/1", title: "Phone" }]);

    await alice.mutation(setHidden, { productId: "gid://shopify/Product/1", title: "Phone", hidden: false });
    expect(await alice.query(listHidden, {})).toEqual([]);
  });

  test("scopes hidden products to the connected shop", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice", tokenIdentifier: owner });
    const connectionId = await t.run(async ctx => ctx.db.insert("shopifyConnections", { ownerTokenIdentifier: owner, shop }));
    await alice.mutation(setHidden, { productId: "gid://shopify/Product/1", title: "Phone", hidden: true });
    await t.run(ctx => ctx.db.patch(connectionId, { shop: "second-store.myshopify.com" }));
    expect(await alice.query(listHidden, {})).toEqual([]);
    await alice.mutation(setHidden, { productId: "gid://shopify/Product/1", title: "Phone", hidden: false });
    await t.run(ctx => ctx.db.patch(connectionId, { shop }));
    expect(await alice.query(listHidden, {})).toEqual([{ id: "gid://shopify/Product/1", title: "Phone" }]);
  });
});
