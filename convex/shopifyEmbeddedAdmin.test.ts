import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { verifyShopifyIdToken } from "./shopifyEmbeddedAuth";

const modules = import.meta.glob("./**/*.ts");
const shop = "first-store.myshopify.com";
const otherShop = "other-store.myshopify.com";
const secret = "test-secret";

function idToken(domain = shop, overrides: Record<string, unknown> = {}, algorithm = "HS256") {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: algorithm, typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: `https://${domain}/admin`, dest: `https://${domain}`, aud: "test-client",
    nbf: now - 1, iat: now - 1, exp: now + 60, jti: "test-jti", ...overrides,
  })).toString("base64url");
  const signed = `${header}.${payload}`;
  return `${signed}.${createHmac("sha256", secret).update(signed).digest("base64url")}`;
}

function adminRequest(token: string, value: unknown = {}, origin = "https://voltresale.app") {
  return {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(value),
  } as const;
}

function mockShopify(expiresIn = 3600) {
  const fetched = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/admin/oauth/access_token")) {
      const params = new URLSearchParams(init?.body?.toString());
      expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
      expect(params.get("subject_token_type")).toBe("urn:ietf:params:oauth:token-type:id_token");
      expect(params.get("requested_token_type")).toBe("urn:shopify:params:oauth:token-type:offline-access-token");
      expect(params.get("expiring")).toBe("1");
      return Response.json({ access_token: `access-${new URL(url).hostname}`, refresh_token: "refresh", scope: "read_products", expires_in: expiresIn, refresh_token_expires_in: 86400 });
    }
    if (url.endsWith("/graphql.json")) {
      return Response.json({ data: { inStock: { nodes: [] }, outOfStock: { nodes: [] } } });
    }
    throw new Error(`Unexpected Shopify request: ${url}`);
  });
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

beforeEach(() => {
  vi.stubEnv("SHOPIFY_CLIENT_ID", "test-client");
  vi.stubEnv("SHOPIFY_CLIENT_SECRET", secret);
  vi.stubEnv("SHOPIFY_TOKEN_ENCRYPTION_KEY", "11".repeat(32));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

test("ID token validation rejects forged, stale, future, wrong-audience, and cross-shop claims", async () => {
  const valid = idToken();
  expect(await verifyShopifyIdToken(valid)).toBe(shop);
  expect(await verifyShopifyIdToken(valid)).toBe(shop);
  const now = Math.floor(Date.now() / 1000);
  for (const token of [
    idToken(shop, {}, "none"), idToken(shop, { exp: now }), idToken(shop, { nbf: now + 60 }),
    idToken(shop, { aud: "another-app" }), idToken(shop, { iss: `https://${otherShop}/admin` }),
    idToken(shop, { dest: `https://${otherShop}` }), idToken(shop, { dest: "https://first-store.myshopify.com.evil.test" }),
    `${valid.slice(0, -1)}x`,
  ]) await expect(verifyShopifyIdToken(token)).rejects.toThrow("Invalid Shopify ID token");
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 61_000);
  await expect(verifyShopifyIdToken(valid)).rejects.toThrow("Invalid Shopify ID token");
});

test("status stores a per-shop encrypted installation and search uses only its signed shop", async () => {
  const fetched = mockShopify();
  const t = convexTest(schema, modules);
  const first = idToken(shop);
  const second = idToken(otherShop);
  const statusPath = "/api/shopify/admin/status";
  expect(await (await t.fetch(statusPath, adminRequest(first))).json()).toEqual({ shop });
  expect(await (await t.fetch(statusPath, adminRequest(second))).json()).toEqual({ shop: otherShop });
  const stored = await t.run((ctx) => ctx.db.query("shopifyEmbeddedInstallations").collect());
  expect(stored.map((row) => row.shop).sort()).toEqual([shop, otherShop].sort());
  expect(stored[0].encryptedAccessToken).not.toContain("access-");
  const searchPath = "/api/shopify/admin/search";
  expect(await (await t.fetch(searchPath, adminRequest(first, { shop: otherShop, query: "phone" }))).json())
    .toEqual({ shop, products: [] });
  expect(fetched.mock.calls.filter(([input]) => String(input).endsWith("/admin/oauth/access_token"))).toHaveLength(2);
  expect((await t.fetch(statusPath, adminRequest(idToken(shop, { aud: "wrong" })))).status).toBe(401);
  expect((await t.fetch(statusPath, adminRequest(first, {}, "https://evil.test"))).status).toBe(403);
});

test("verified uninstall removes only that shop's embedded credential", async () => {
  mockShopify();
  const t = convexTest(schema, modules);
  const statusPath = "/api/shopify/admin/status";
  await t.fetch(statusPath, adminRequest(idToken(shop)));
  await t.fetch(statusPath, adminRequest(idToken(otherShop)));
  await t.run(async (ctx) => {
    await ctx.db.insert("shopifyConnections", { ownerTokenIdentifier: "legacy-owner", shop,
      encryptedAccessToken: "encrypted", encryptedRefreshToken: "encrypted", expiresAt: 1, refreshExpiresAt: 1 });
    await ctx.db.insert("shopifyOAuthStates", { ownerTokenIdentifier: "legacy-owner", shop, state: "legacy-state", expiresAt: 1 });
  });
  const path = "/api/shopify/webhooks/app/uninstalled";
  // app/uninstalled delivers the Shop resource, not a shop_domain envelope.
  const payload = JSON.stringify({ id: 1, domain: "www.example.com", myshopify_domain: shop });
  const signature = createHmac("sha256", secret).update(payload).digest("base64");
  const request = { method: "POST", headers: { "X-Shopify-Topic": "app/uninstalled", "X-Shopify-Shop-Domain": shop,
    "X-Shopify-Hmac-Sha256": signature }, body: payload } as const;
  expect((await t.fetch(path, { ...request, headers: { ...request.headers, "X-Shopify-Hmac-Sha256": "A".repeat(43) + "=" } })).status).toBe(401);
  expect((await t.fetch(path, request)).status).toBe(200);
  const rows = await t.run(async (ctx) => ({
    embedded: await ctx.db.query("shopifyEmbeddedInstallations").collect(),
    legacy: await ctx.db.query("shopifyConnections").collect(),
    states: await ctx.db.query("shopifyOAuthStates").collect(),
  }));
  expect(rows.embedded.map((row) => row.shop)).toEqual([otherShop]);
  expect(rows.legacy).toEqual([]);
  expect(rows.states).toEqual([]);
});

test("near-expiry access is exchanged once and renewed credentials remain encrypted", async () => {
  const fetched = mockShopify(90);
  const t = convexTest(schema, modules);
  const path = "/api/shopify/admin/status";
  const token = idToken();
  expect((await t.fetch(path, adminRequest(token))).status).toBe(200);
  expect((await t.fetch(path, adminRequest(token))).status).toBe(200);
  expect(fetched.mock.calls.filter(([input]) => String(input).endsWith("/admin/oauth/access_token"))).toHaveLength(1);
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 31_000);
  expect((await t.fetch(path, adminRequest(idToken()))).status).toBe(200);
  expect(fetched.mock.calls.filter(([input]) => String(input).endsWith("/admin/oauth/access_token"))).toHaveLength(2);
  const row = await t.run((ctx) => ctx.db.query("shopifyEmbeddedInstallations").first());
  expect(row?.exchangeLease).toBeUndefined();
  expect(row?.encryptedRefreshToken).not.toContain("refresh");
});
