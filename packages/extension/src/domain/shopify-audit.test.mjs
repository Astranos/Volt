import assert from "node:assert/strict";
import test from "node:test";
import {
  isShopifyAdminProductUrl,
  nextShopifyAuditProduct,
  normalizeShopifyShopInput,
  parseShopifyAuditMode,
  parseShopifyAuditReview,
  startShopifyAuditReview,
  validShopifyAdminProductUrl,
  yesterdayInComputerTimezone,
} from "./shopify-audit.ts";

test("yesterday spans the previous local calendar date across daylight saving changes", () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = "America/Detroit";
  try {
    assert.deepEqual(yesterdayInComputerTimezone(new Date("2026-03-09T12:00:00Z")), {
      date: "2026-03-08",
      startUtc: "2026-03-08T05:00:00.000Z",
      endUtc: "2026-03-09T04:00:00.000Z",
    });
    assert.deepEqual(yesterdayInComputerTimezone(new Date("2026-11-02T12:00:00Z")), {
      date: "2026-11-01",
      startUtc: "2026-11-01T04:00:00.000Z",
      endUtc: "2026-11-02T05:00:00.000Z",
    });
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test("accepts a Shopify shop domain and only its product admin links", () => {
  assert.equal(normalizeShopifyShopInput("https://my-store.myshopify.com/"), "my-store.myshopify.com");
  assert.equal(normalizeShopifyShopInput("https://my-store.myshopify.com.evil.test"), null);
  assert.equal(normalizeShopifyShopInput("https://my-store.myshopify.com/admin"), null);
  assert.equal(validShopifyAdminProductUrl("https://admin.shopify.com/store/my-store/products/123", "my-store.myshopify.com"), true);
  assert.equal(validShopifyAdminProductUrl("https://admin.shopify.com/store/other/products/123", "my-store.myshopify.com"), false);
  assert.equal(validShopifyAdminProductUrl("https://admin.shopify.com/store/my-store/products/abc", "my-store.myshopify.com"), false);
});

const product = (id) => ({ id: `gid://shopify/Product/${id}`, title: `Product ${id}`, status: "DRAFT", url: `https://admin.shopify.com/store/sample/products/${id}` });
const result = (date, ids) => ({ shop: "sample.myshopify.com", date, products: ids.map(product) });

test("audit mode defaults to the side panel", () => {
  assert.equal(parseShopifyAuditMode(undefined), "sidepanel");
  assert.equal(parseShopifyAuditMode("bogus"), "sidepanel");
  assert.equal(parseShopifyAuditMode("tabs"), "tabs");
});

test("a new review starts on the first product", () => {
  const review = startShopifyAuditReview(null, result("2026-10-22", [1, 2, 3]));
  assert.equal(review.currentId, "gid://shopify/Product/1");
  assert.deepEqual(review.marks, {});
  assert.equal(review.tabId, null);
});

test("restarting the same day keeps progress and drops products that are gone", () => {
  const first = startShopifyAuditReview(null, result("2026-10-22", [1, 2, 3]));
  const progressed = { ...first, marks: { [product(1).id]: "done", [product(2).id]: "flagged" }, currentId: product(3).id, tabId: 9 };
  const again = startShopifyAuditReview(progressed, result("2026-10-22", [1, 3, 4]));
  assert.deepEqual(again.marks, { [product(1).id]: "done" });
  assert.equal(again.currentId, product(3).id);
  assert.equal(again.tabId, 9);
});

test("a different day or shop starts over", () => {
  const first = { ...startShopifyAuditReview(null, result("2026-10-21", [1])), marks: { [product(1).id]: "done" }, tabId: 9 };
  const next = startShopifyAuditReview(first, result("2026-10-22", [1]));
  assert.deepEqual(next.marks, {});
  assert.equal(next.tabId, null);
  assert.equal(next.currentId, product(1).id);
});

test("next product skips marked products and wraps around", () => {
  const review = { ...startShopifyAuditReview(null, result("2026-10-22", [1, 2, 3])), marks: { [product(2).id]: "done" } };
  assert.equal(nextShopifyAuditProduct(review, product(1).id)?.id, product(3).id);
  assert.equal(nextShopifyAuditProduct(review, product(3).id)?.id, product(1).id);
  assert.equal(nextShopifyAuditProduct({ ...review, marks: { [product(1).id]: "done", [product(2).id]: "done", [product(3).id]: "flagged" } }, null), null);
});

test("stored reviews are validated before use", () => {
  assert.equal(parseShopifyAuditReview(null), null);
  assert.equal(parseShopifyAuditReview({ shop: "evil.com", date: "x", products: [], marks: {} }), null);
  const parsed = parseShopifyAuditReview({
    shop: "sample.myshopify.com", date: "2026-10-22",
    products: [product(1), { ...product(2), url: "https://evil.example/products/2" }],
    marks: { [product(1).id]: "done", [product(2).id]: "done", other: "bogus" },
    currentId: product(2).id, tabId: 4,
  });
  assert.deepEqual(parsed.products.map((item) => item.id), [product(1).id]);
  assert.deepEqual(parsed.marks, { [product(1).id]: "done" });
  assert.equal(parsed.currentId, null);
  assert.equal(parsed.tabId, 4);
});

test("audit tabs only navigate to Shopify admin product pages", () => {
  assert.equal(isShopifyAdminProductUrl("https://admin.shopify.com/store/sample/products/12"), true);
  assert.equal(isShopifyAdminProductUrl("https://admin.shopify.com/store/sample/orders/12"), false);
  assert.equal(isShopifyAdminProductUrl("https://evil.example/store/sample/products/12"), false);
  assert.equal(isShopifyAdminProductUrl("javascript:alert(1)"), false);
});
