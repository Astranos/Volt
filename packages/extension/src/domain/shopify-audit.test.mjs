import assert from "node:assert/strict";
import test from "node:test";
import {
  auditRangeInComputerTimezone,
  isReusableShopifyAuditTab,
  isShopifyAdminProductUrl,
  nextShopifyAuditProduct,
  normalizeShopifyShopInput,
  parseShopifyAuditDays,
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

test("restarting the same day keeps progress, including for products no longer in range", () => {
  const first = startShopifyAuditReview(null, result("2026-10-22", [1, 2, 3]));
  const progressed = { ...first, marks: { [product(1).id]: "done", [product(2).id]: "done" }, currentId: product(3).id, tabId: 9 };
  const again = startShopifyAuditReview(progressed, result("2026-10-22", [1, 3, 4]));
  assert.deepEqual(again.marks, { [product(1).id]: "done", [product(2).id]: "done" });
  assert.equal(again.currentId, product(3).id);
  assert.equal(again.tabId, 9);
});

test("viewed products carry over to a new day or a wider range for the same shop", () => {
  const first = { ...startShopifyAuditReview(null, result("2026-10-21", [1, 2])), marks: { [product(1).id]: "done" }, tabId: 9 };
  const wider = startShopifyAuditReview(first, result("2026-10-20", [0, 1, 2]), 3);
  assert.deepEqual(wider.marks, { [product(1).id]: "done" });
  assert.equal(wider.days, 3);
  assert.equal(wider.tabId, 9);
});

test("another shop starts over", () => {
  const first = { ...startShopifyAuditReview(null, result("2026-10-21", [1])), marks: { [product(1).id]: "done" }, tabId: 9 };
  const other = startShopifyAuditReview(first, { ...result("2026-10-21", [1]), shop: "other.myshopify.com", products: [{ ...product(1), url: "https://admin.shopify.com/store/other/products/1" }] });
  assert.deepEqual(other.marks, {});
  assert.equal(other.tabId, null);
});

test("audit ranges cover whole local days ending today", () => {
  const now = new Date(2026, 9, 23, 15, 30);
  const one = auditRangeInComputerTimezone(1, now);
  const three = auditRangeInComputerTimezone(3, now);
  assert.equal(one.date, "2026-10-22");
  assert.equal(three.date, "2026-10-20");
  assert.equal(three.endUtc, one.endUtc);
  assert.equal(three.startUtc, new Date(2026, 9, 20).toISOString());
  assert.equal(parseShopifyAuditDays(3), 3);
  assert.equal(parseShopifyAuditDays(7), 1);
});

test("next product skips marked products and wraps around", () => {
  const review = { ...startShopifyAuditReview(null, result("2026-10-22", [1, 2, 3])), marks: { [product(2).id]: "done" } };
  assert.equal(nextShopifyAuditProduct(review, product(1).id)?.id, product(3).id);
  assert.equal(nextShopifyAuditProduct(review, product(3).id)?.id, product(1).id);
  assert.equal(nextShopifyAuditProduct({ ...review, marks: { [product(1).id]: "done", [product(2).id]: "done", [product(3).id]: "done" } }, null), null);
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
  // Marks for valid product IDs are kept even when that product isn't listed.
  assert.deepEqual(parsed.marks, { [product(1).id]: "done", [product(2).id]: "done" });
  assert.equal(parsed.currentId, null);
  assert.equal(parsed.tabId, 4);
});

test("audit tabs only navigate to Shopify admin product pages", () => {
  assert.equal(isShopifyAdminProductUrl("https://admin.shopify.com/store/sample/products/12"), true);
  assert.equal(isShopifyAdminProductUrl("https://admin.shopify.com/store/sample/orders/12"), false);
  assert.equal(isShopifyAdminProductUrl("https://evil.example/store/sample/products/12"), false);
  assert.equal(isShopifyAdminProductUrl("javascript:alert(1)"), false);
});

test("the review tab is reused only on an audit product or the new tab", () => {
  const review = startShopifyAuditReview(null, result("2026-10-22", [1, 2]));
  const newTab = "chrome-extension://ext/newtab.html";
  assert.equal(isReusableShopifyAuditTab(product(2).url, review, newTab), true);
  assert.equal(isReusableShopifyAuditTab(`${product(1).url}?variant=3`, review, newTab), true);
  assert.equal(isReusableShopifyAuditTab("chrome://newtab/", review, newTab), true);
  assert.equal(isReusableShopifyAuditTab(newTab, review, newTab), true);
  assert.equal(isReusableShopifyAuditTab("https://admin.shopify.com/store/sample/products/99", review, newTab), false);
  assert.equal(isReusableShopifyAuditTab("https://admin.shopify.com/store/sample/orders/1", review, newTab), false);
  assert.equal(isReusableShopifyAuditTab("https://mail.google.com/", review, newTab), false);
  assert.equal(isReusableShopifyAuditTab(undefined, review, newTab), false);
});

test("narrowing the range and widening it again keeps what was viewed", () => {
  const wide = { ...startShopifyAuditReview(null, result("2026-10-20", [1, 2, 3]), 3), marks: { [product(1).id]: "done" } };
  const narrow = startShopifyAuditReview(wide, result("2026-10-22", [3]), 1);
  const wideAgain = startShopifyAuditReview(narrow, result("2026-10-20", [1, 2, 3]), 3);
  assert.equal(wideAgain.marks[product(1).id], "done");
});
