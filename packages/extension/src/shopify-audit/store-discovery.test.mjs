import assert from "node:assert/strict";
import test from "node:test";
import { findOpenShopifyAdminShops, shopDomainFromAdminUrl, shopDomainFromTypedStore } from "./store-discovery.ts";

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

test("reads a typed store name, domain, or admin URL", () => {
  for (const typed of ["paymore-taylor", " Paymore-Taylor ", "paymore-taylor.myshopify.com", "https://paymore-taylor.myshopify.com",
    "admin.shopify.com/store/paymore-taylor", "https://admin.shopify.com/store/paymore-taylor/products/123"]) {
    assert.equal(shopDomainFromTypedStore(typed), "paymore-taylor.myshopify.com", typed);
  }
  for (const typed of ["", "paymore taylor", "paymore.com", "https://evil.example/store/x", "-bad-"]) {
    assert.equal(shopDomainFromTypedStore(typed), null, typed);
  }
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
