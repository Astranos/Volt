import test from "node:test";
import assert from "node:assert/strict";
import { collectCatalog, decimalCents, descriptionText, parseCatalogPage, storeOrigin } from "./catalog.ts";

const product = (id = 1) => ({ id, title: "Canon EOS camera", handle: "canon-camera", body_html: "<p>Used, good condition</p>", variants: [
  { id: id * 10, title: "Black", available: true, price: "199.99", sku: "CAM" },
  { id: id * 10 + 1, title: "Silver", available: false, price: "180.00", sku: null },
] });

test("public storefront URL excludes credentials, admin and local networks", () => {
  assert.equal(storeOrigin("https://taylormi.paymore.com/products/test?variant=123"), "https://taylormi.paymore.com");
  for (const url of ["http://store.com", "https://admin.shopify.com/store/a", "https://a.myshopify.com/admin/products", "https://user:pass@shop.com", "https://127.0.0.1", "https://[::1]", "https://localhost", "https://store.internal", "https://store.local", "https://a.com:4433"]) {
    assert.throws(() => storeOrigin(url), undefined, url);
  }
});

test("bare storefront domains normalize to HTTPS without bypassing URL restrictions", () => {
  assert.equal(storeOrigin("taylormi.paymore.com"), "https://taylormi.paymore.com");
  assert.equal(storeOrigin("  taylormi.paymore.com/products/camera?variant=123  "), "https://taylormi.paymore.com");
  for (const url of ["http://taylormi.paymore.com", "admin.shopify.com/store/a", "taylormi.paymore.com/admin/products", "user:pass@shop.com", "localhost", "127.0.0.1", "shop.local", "shop.com:8000", "ftp://shop.com", "//shop.com"]) {
    assert.throws(() => storeOrigin(url), undefined, url);
  }
});

test("catalog keeps each available variant and its exact price", () => {
  const page = parseCatalogPage(JSON.stringify({ products: [product()] }), "https://store.com");
  assert.deepEqual(page.productIds, ["1"]);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].priceCents, 19999);
  assert.equal(page.items[0].id, "1:10");
  assert.equal(page.items[0].url, "https://store.com/products/canon-camera?variant=10");
  assert.equal(page.items[0].description, "Used, good condition");
  assert.equal(decimalCents("0.29"), 29);
  assert.equal(decimalCents("1.2"), 120);
  for (const invalid of ["-1", "1e3", "1,000", "NaN", "0.001", "", " 1"]) assert.equal(decimalCents(invalid), null);
});

test("catalog keeps semantic condition evidence that appears after presentation-heavy HTML", () => {
  const body_html = `<style>${".shopify-auto { color: black; }".repeat(400)}</style><div><h2>Specifications</h2><p>Model: Ideapad S145 81MU</p><p>Condition: Fair</p><p>Fully tested and functional.</p></div>`;
  assert.ok(body_html.indexOf("Condition") > 8000);
  const page = parseCatalogPage(JSON.stringify({ products: [{ ...product(), body_html }] }), "https://store.com");
  assert.match(page.items[0].description, /Model: Ideapad S145 81MU/);
  assert.match(page.items[0].description, /Condition: Fair/);
  assert.match(page.items[0].description, /Fully tested and functional/);
  assert.ok(page.items[0].description.length <= 8000);
  assert.equal(descriptionText("<script>ignore()</script><p>A &amp; B</p>"), "A & B");
});

test("catalog cannot silently drop malformed or duplicate variants", () => {
  for (const value of ["<html>Denied</html>", "{}", JSON.stringify({ products: [{ ...product(), variants: [{ ...product().variants[0], available: "true" }] }] }), JSON.stringify({ products: [{ ...product(), variants: [product().variants[0], product().variants[0]] }] })]) {
    assert.throws(() => parseCatalogPage(value, "https://store.com"));
  }
});

test("catalog traverses full pages, checks duplicate pages and refuses an incomplete cap", async () => {
  const seen = [];
  const full = Array.from({ length: 250 }, (_, index) => product(index + 1));
  const items = await collectCatalog("https://store.com", async (url) => {
    seen.push(url);
    return JSON.stringify({ products: seen.length === 1 ? full : [product(251)] });
  }, () => {});
  assert.equal(items.length, 251);
  assert.match(seen[1], /limit=250&page=2$/);
  await assert.rejects(collectCatalog("https://store.com", async () => JSON.stringify({ products: full }), () => {}), /repeated/);
  let page = 0;
  await assert.rejects(collectCatalog("https://store.com", async () => {
    const offset = page++ * 250;
    return JSON.stringify({ products: full.map((_, index) => product(offset + index + 1)) });
  }, () => {}), /5,000/);
});
