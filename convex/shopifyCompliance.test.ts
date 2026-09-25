import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const shop = "example-store.myshopify.com";
const otherShop = "other-store.myshopify.com";

function signedRequest(path: string, payload: unknown, options: { topic?: string; signature?: string; raw?: string } = {}) {
  const raw = options.raw ?? JSON.stringify(payload);
  const signature = options.signature ?? createHmac("sha256", "test-secret").update(raw).digest("base64");
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": signature,
      ...(options.topic ? { "X-Shopify-Topic": options.topic } : {}),
    },
    body: raw,
  } as const;
}

beforeEach(() => vi.stubEnv("SHOPIFY_CLIENT_SECRET", "test-secret"));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

test("customer compliance events accept verified requests and reject tampering or wrong topics", async () => {
  const t = convexTest(schema, modules);
  const payload = { shop_domain: shop, customer: { id: 1 } };
  const dataPath = "/api/shopify/webhooks/customers/data_request";
  const redactPath = "/api/shopify/webhooks/customers/redact";
  expect((await t.fetch(dataPath, signedRequest(dataPath, payload, { topic: "customers/data_request" }))).status).toBe(200);
  expect((await t.fetch(redactPath, signedRequest(redactPath, payload, { topic: "customers/redact" }))).status).toBe(200);
  const original = JSON.stringify(payload);
  const signature = createHmac("sha256", "test-secret").update(original).digest("base64");
  expect((await t.fetch(dataPath, signedRequest(dataPath, payload, { signature, raw: `${original} ` }))).status).toBe(401);
  expect((await t.fetch(dataPath, signedRequest(dataPath, payload, { topic: "shop/redact" }))).status).toBe(400);
  expect((await t.fetch(dataPath, signedRequest(dataPath, payload))).status).toBe(400);
  expect((await t.fetch(dataPath, { method: "POST", body: original })).status).toBe(401);
});

test("shop redaction deletes every matching connection and pending OAuth state in bounded batches", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (let i = 0; i < 215; i++) {
      await ctx.db.insert("shopifyConnections", {
        ownerTokenIdentifier: `owner-${i}`, shop, encryptedAccessToken: "encrypted",
        encryptedRefreshToken: "encrypted", expiresAt: 1, refreshExpiresAt: 1,
      });
      await ctx.db.insert("shopifyOAuthStates", {
        ownerTokenIdentifier: `owner-${i}`, shop, state: `state-${i}`, expiresAt: 1,
      });
    }
    await ctx.db.insert("shopifyConnections", {
      ownerTokenIdentifier: "unrelated", shop: otherShop, encryptedAccessToken: "encrypted",
      encryptedRefreshToken: "encrypted", expiresAt: 1, refreshExpiresAt: 1,
    });
    await ctx.db.insert("shopifyOAuthStates", {
      ownerTokenIdentifier: "unrelated", shop: otherShop, state: "unrelated", expiresAt: 1,
    });
  });
  const path = "/api/shopify/webhooks/shop/redact";
  expect((await t.fetch(path, signedRequest(path, { shop_domain: shop }, { signature: "A".repeat(43) + "=" }))).status).toBe(401);
  expect((await t.fetch(path, signedRequest(path, { shop_domain: shop }))).status).toBe(400);
  expect((await t.fetch(path, signedRequest(path, { shop_domain: shop }, { topic: "customers/redact" }))).status).toBe(400);
  expect(await t.run((ctx) => ctx.db.query("shopifyConnections").withIndex("by_shop", (q) => q.eq("shop", shop)).take(1))).toHaveLength(1);
  expect((await t.fetch(path, signedRequest(path, { shop_domain: shop }, { topic: "shop/redact" }))).status).toBe(200);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const remaining = await t.run(async (ctx) => ({
    connections: await ctx.db.query("shopifyConnections").collect(),
    states: await ctx.db.query("shopifyOAuthStates").collect(),
  }));
  expect(remaining.connections.map((row) => row.shop)).toEqual([otherShop]);
  expect(remaining.states.map((row) => row.shop)).toEqual([otherShop]);
});
