import assert from "node:assert/strict";
import test from "node:test";
import { normalizeShopifyShopInput, validShopifyAdminProductUrl, yesterdayInComputerTimezone } from "./shopify-audit.ts";

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
