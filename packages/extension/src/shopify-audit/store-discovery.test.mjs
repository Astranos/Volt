import assert from "node:assert/strict";
import test from "node:test";
import { findOpenShopifyAdminShops, shopDomainFromAdminUrl } from "./store-discovery.ts";

test("discovers a store from Shopify admin pages", () => {
  assert.equal(shopDomainFromAdminUrl("https://admin.shopify.com/store/sample/products"), "sample.myshopify.com");
  assert.equal(shopDomainFromAdminUrl("https://sample.myshopify.com/admin/products"), "sample.myshopify.com");
});

test("does not trust lookalike hosts or non-admin Shopify pages", () => {
  assert.equal(shopDomainFromAdminUrl("https://admin.shopify.com.evil.example/store/sample/products"), null);
  assert.equal(shopDomainFromAdminUrl("https://sample.myshopify.com.evil.example/admin/products"), null);
  assert.equal(shopDomainFromAdminUrl("https://sample.myshopify.com/products"), null);
  assert.equal(shopDomainFromAdminUrl("http://admin.shopify.com/store/sample/products"), null);
});

test("finds distinct stores in open Shopify admin tabs", async () => {
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { tabs: { query: async () => [
    { url: "https://admin.shopify.com/store/first/products" },
    { url: "https://first.myshopify.com/admin/products" },
    { url: "https://admin.shopify.com/store/second/products" },
    { url: "https://example.com/store/ignored" },
  ] } };
  try {
    assert.deepEqual(await findOpenShopifyAdminShops(), ["first.myshopify.com", "second.myshopify.com"]);
  } finally {
    globalThis.chrome = originalChrome;
  }
});
