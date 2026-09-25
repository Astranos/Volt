import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { auditRange, decryptToken, encryptToken, fetchYesterday, shopDomain, verifyCallback } from "./shopifyHelpers";

const modules = import.meta.glob("./**/*.ts");
const get = makeFunctionReference<"query", Record<string, never>, { shop: string } | null>("shopifyAudit:getConnection");
const disconnect = makeFunctionReference<"mutation", Record<string, never>, null>("shopifyAudit:disconnect");
const start = makeFunctionReference<"action", { shop: string }, { url: string }>("shopifyAudit:startConnect");
const begin = makeFunctionReference<"mutation", { ownerTokenIdentifier: string; shop: string; state: string }, null>("shopifyStore:begin");
const consume = makeFunctionReference<"mutation", { shop: string; state: string }, { id: Id<"shopifyOAuthStates">; ownerTokenIdentifier: string }>("shopifyStore:consume");
type Tokens = Pick<Doc<"shopifyConnections">, "encryptedAccessToken" | "encryptedRefreshToken" | "expiresAt" | "refreshExpiresAt">;
const finish = makeFunctionReference<"mutation", { stateId: Id<"shopifyOAuthStates"> } & Tokens, null>("shopifyStore:finish");
const list = makeFunctionReference<"action", { startUtc: string; endUtc: string; date: string }, { shop: string; date: string; products: { id: string; title: string; status: string; url: string }[] }>("shopifyAudit:listYesterday");
const shop = "example-store.myshopify.com";
const state = "a".repeat(64);
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
    const result = new URL((await alice.action(start, { shop })).url);
    expect(result.hostname).toBe(shop);
    expect(result.searchParams.get("redirect_uri")).toBe("https://example.convex.site/api/shopify/callback");
    expect(result.searchParams.get("scope")).toBe("read_products");
    expect(result.searchParams.get("state")).toMatch(/^[a-f0-9]{64}$/);
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
    await t.mutation(begin, { ownerTokenIdentifier: owner, shop, state });
    const params = new URLSearchParams({ shop, state, code: "code", timestamp: "123" });
    const message = [...params.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([k, v]) => `${k}=${v}`).join("&");
    params.set("hmac", createHmac("sha256", "secret").update(message).digest("hex"));
    const mock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "private-access", refresh_token: "private-refresh", scope: "read_products", expires_in: 3600, refresh_token_expires_in: 86400 })));
    vi.stubGlobal("fetch", mock);
    const response = await t.fetch(`/api/shopify/callback?${params}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Shopify connected");
    expect(String(mock.mock.calls[0][1]?.body)).toContain("expiring=1");
    const row = await t.run(ctx => ctx.db.query("shopifyConnections").first());
    expect(JSON.stringify(row)).not.toContain("private-");
    expect(await decryptToken(row?.encryptedAccessToken ?? "", `${owner}|${shop}`)).toBe("private-access");
    expect((await t.fetch(`/api/shopify/callback?${params}`)).status).toBe(400);
    expect(mock).toHaveBeenCalledTimes(1);
  });
  test("state is bound to exact shop, single-use, and expiry", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(begin, { ownerTokenIdentifier: owner, shop, state });
    await expect(t.mutation(consume, { shop: "other.myshopify.com", state })).rejects.toThrow("expired");
    await t.mutation(consume, { shop, state });
    await expect(t.mutation(consume, { shop, state })).rejects.toThrow("expired");
    await t.mutation(begin, { ownerTokenIdentifier: owner, shop, state });
    await t.run(async ctx => {
      const row = await ctx.db.query("shopifyOAuthStates").first();
      if (row) await ctx.db.patch(row._id, { expiresAt: Date.now() - 1 });
    });
    await expect(t.mutation(consume, { shop, state })).rejects.toThrow("expired");
  });
  test("isolates accounts and disconnect cancels an in-flight OAuth callback", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice", tokenIdentifier: owner });
    const bob = t.withIdentity({ subject: "bob", tokenIdentifier: "clerk|bob" });
    await t.mutation(begin, { ownerTokenIdentifier: owner, shop, state });
    const consumed = await t.mutation(consume, { shop, state });
    await t.mutation(finish, { stateId: consumed.id, ...tokens });
    expect(await alice.query(get, {})).toEqual({ shop });
    expect(await bob.query(get, {})).toBeNull();
    await bob.mutation(disconnect, {});
    expect(await alice.query(get, {})).toEqual({ shop });
    await t.mutation(begin, { ownerTokenIdentifier: owner, shop, state });
    const pending = await t.mutation(consume, { shop, state });
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
