import { expect, test } from "vitest";
import type { ShopifyProductDetails } from "../domain/shopify-audit";
import { buildCompareModel, compareRowCount, splitSpecifications } from "./compare-model";
import type { DetailBlock } from "./listing";

const product = (id: string, overrides: Partial<ShopifyProductDetails> = {}): ShopifyProductDetails => ({
  id, title: id, status: "ACTIVE", totalInventory: 1, url: "", images: [], currencyCode: "USD", minPrice: "100.00", maxPrice: "100.00",
  condition: "Used - Good", vendor: "Apple", productType: null, descriptionHtml: "", variants: [], ...overrides,
});

test("drops spec tables and the heading that introduces them from the listing text", () => {
  const blocks: DetailBlock[] = [
    { kind: "heading", text: "Items included" },
    { kind: "list", items: ["Phone"] },
    { kind: "heading", text: "Specifications" },
    { kind: "specifications", rows: [{ label: "Storage", value: "128GB" }] },
  ];
  expect(splitSpecifications(blocks)).toEqual({ specs: [{ label: "Storage", value: "128GB" }], rest: blocks.slice(0, 2) });
});

test("aligns specs across products and marks rows that differ", () => {
  const details = new Map<string, DetailBlock[]>([
    ["a", [{ kind: "heading", text: "Cosmetic Condition:" }, { kind: "paragraph", text: "Scuffed" }, { kind: "heading", text: "Specs" },
      { kind: "specifications", rows: [{ label: "Storage", value: "128GB" }, { label: "Carrier", value: "Unlocked" }] }]],
    ["b", [{ kind: "specifications", rows: [{ label: "carrier", value: "unlocked" }, { label: "Color", value: "Green" }] }]],
  ]);
  const model = buildCompareModel([product("a"), product("b", { minPrice: "80.00", condition: "Used - Fair" })], (item) => details.get(item.id) ?? []);

  expect(model.specs).toEqual([
    { label: "Storage", values: ["128GB", ""], differs: true },
    { label: "Carrier", values: ["Unlocked", "unlocked"], differs: false },
    { label: "Color", values: ["", "Green"], differs: true },
  ]);
  expect(model.facts.map((row) => [row.label, row.differs])).toEqual([["Condition", true], ["Status", false], ["Vendor", false]]);
  expect(model.items.map((item) => item.isLowestPrice)).toEqual([false, true]);
  expect(model.hasNotes).toBe(true);
  expect(model.hasDetails).toBe(false);
  expect(compareRowCount(model)).toBe(3 + 3 + 1 + 1 + 4);
});

test("does not call out a lowest price when every price matches", () => {
  const model = buildCompareModel([product("a"), product("b")], () => []);
  expect(model.items.some((item) => item.isLowestPrice)).toBe(false);
});
