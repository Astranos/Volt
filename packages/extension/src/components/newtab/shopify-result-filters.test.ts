import { expect, test } from "vitest";
import type { ShopifySearchProduct } from "../../shopify-audit/client";
import { applyShopifyResultFilters, conditionGroup, conditionOptions, DEFAULT_SHOPIFY_RESULT_FILTERS } from "./shopify-result-filters";

const product = (id: number, price: string | null, stock: number, condition: string | null): ShopifySearchProduct => ({
  id: `gid://shopify/Product/${id}`, title: `Product ${id}`, status: "ACTIVE", totalInventory: stock,
  url: `https://admin.shopify.com/store/sample/products/${id}`, imageUrl: null, price, currencyCode: "USD", condition, sku: null,
});
const products = [
  product(1, "120.00", 2, "Used - Excellent"),
  product(2, "80.00", 0, "New"),
  product(3, null, 1, "used: good"),
  product(4, "300.00", 5, "Open Box"),
  product(5, "45.50", 1, null),
];
const ids = (list: ShopifySearchProduct[]) => list.map((item) => Number(item.id.split("/").pop()));

test("condition variants group under one name", () => {
  expect(conditionGroup("Used - Excellent")).toBe("Used");
  expect(conditionGroup("used: good")).toBe("Used");
  expect(conditionGroup("Open Box")).toBe("Open Box");
  expect(conditionGroup(null)).toBeNull();
  expect(conditionOptions(products)).toEqual(["Used", "New", "Open Box"]);
});

test("defaults keep Shopify's order", () => {
  expect(ids(applyShopifyResultFilters(products, DEFAULT_SHOPIFY_RESULT_FILTERS))).toEqual([1, 2, 3, 4, 5]);
});

test("in stock only and condition narrow the results", () => {
  expect(ids(applyShopifyResultFilters(products, { ...DEFAULT_SHOPIFY_RESULT_FILTERS, inStockOnly: true }))).toEqual([1, 3, 4, 5]);
  expect(ids(applyShopifyResultFilters(products, { ...DEFAULT_SHOPIFY_RESULT_FILTERS, condition: "Used" }))).toEqual([1, 3]);
  expect(ids(applyShopifyResultFilters(products, { inStockOnly: true, condition: "New", sort: "relevance" }))).toEqual([]);
});

test("price sorts both ways with unpriced products last", () => {
  expect(ids(applyShopifyResultFilters(products, { ...DEFAULT_SHOPIFY_RESULT_FILTERS, sort: "price-asc" }))).toEqual([5, 2, 1, 4, 3]);
  expect(ids(applyShopifyResultFilters(products, { ...DEFAULT_SHOPIFY_RESULT_FILTERS, sort: "price-desc" }))).toEqual([4, 1, 2, 5, 3]);
});
