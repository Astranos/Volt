import { expect, test } from "vitest";
import { compareProductIds, compareShop, shopifyComparePath } from "./compare-url";

test("round-trips picked products through the compare page URL", () => {
  const ids = ["gid://shopify/Product/12", "gid://shopify/Product/34"];
  const path = shopifyComparePath(ids);
  expect(path).toBe("/shopify-compare.html?ids=12,34");
  expect(compareProductIds(new URL(path, "chrome-extension://ext").search)).toEqual(ids);
});

test("ignores invalid, duplicate, and extra compare IDs", () => {
  expect(compareProductIds("?ids=1,abc,1,,2")).toEqual(["gid://shopify/Product/1", "gid://shopify/Product/2"]);
  expect(compareProductIds("?ids=1,2,3,4,5,6,7,8,9")).toHaveLength(8);
  expect(compareProductIds("")).toEqual([]);
});

test("keeps the store the products came from", () => {
  const path = shopifyComparePath(["gid://shopify/Product/12"], "second-store.myshopify.com");
  expect(path).toBe("/shopify-compare.html?ids=12&shop=second-store.myshopify.com");
  expect(compareShop(new URL(path, "chrome-extension://ext").search)).toBe("second-store.myshopify.com");
  expect(compareShop("?ids=12")).toBeUndefined();
  expect(compareShop("?ids=12&shop=evil.test")).toBeUndefined();
});
