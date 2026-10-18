import { expect, test } from "vitest";
import { compareProductIds, shopifyComparePath } from "./compare-url";

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
