import { describe, expect, test } from "vitest";
import {
  catalogCollections,
  catalogCsv,
  catalogDate,
  catalogFacts,
  catalogFilterOptions,
  catalogSummary,
  filterCatalogResults,
  safeCatalogUrl,
  type CatalogProduct,
  type CatalogResult,
} from "./catalog";

const summary = {
  upc: "012345678905",
  title: "Widget Phone",
  mpn: "WIDGET-128",
  brand: "Volt",
  model: "Widget",
  platform: null,
  edition: null,
  storage: "128GB",
  color: "Black",
  carrier: null,
  updatedAt: 1_700_000_000_000,
} satisfies CatalogResult;

const product = {
  ...summary,
  collection: "phones",
  collections: undefined,
  publisher: null,
  genre: null,
  rating: null,
  releaseYear: "2026",
  attributes: { screenSize: "6 inches", brand: "Other brand", empty: " " },
  upcs: ["098765432105", summary.upc, "098765432105"],
  sourceUrls: [],
  listings: [],
  createdAt: summary.updatedAt,
} satisfies CatalogProduct;

describe("catalog research helpers", () => {
  test("shows canonical UPC, aliases, rich metadata and named attributes without empty or duplicate facts", () => {
    const facts = catalogFacts(product);
    expect(facts).toContainEqual({ label: "UPC", value: summary.upc });
    expect(facts).toContainEqual({ label: "Additional UPCs", value: "098765432105" });
    expect(facts).toContainEqual({ label: "Release year", value: "2026" });
    expect(facts).toContainEqual({ label: "Screen size", value: "6 inches" });
    expect(facts.filter((fact) => fact.label === "Brand")).toEqual([{ label: "Brand", value: "Volt" }]);
    expect(facts.some((fact) => fact.label === "Carrier" || fact.label === "Empty")).toBe(false);
    expect(catalogFacts({ ...product, upcs: [] })).toContainEqual({ label: "UPC", value: summary.upc });
  });

  test("uses collection names when present and legacy collection as fallback", () => {
    expect(catalogCollections(product)).toEqual(["phones"]);
    expect(catalogCollections({ ...product, collections: ["Phones", " phones ", ""] })).toEqual(["Phones"]);
    expect(catalogCollections({ ...product, collection: null, collections: [] })).toEqual([]);
    expect(catalogSummary(product)).toContain("Collections: phones");
    expect(catalogSummary(product)).toContain("UPC: 012345678905");
    expect(catalogSummary(product)).not.toContain("null");
  });

  test.each([
    undefined, "", "javascript:alert(1)", "data:image/png;base64,abc", "file:///tmp/a", "/relative/path", "https://user:password@example.com/x",
  ])("rejects unsafe or unsupported source URL %s", (url) => {
    expect(safeCatalogUrl(url)).toBeNull();
  });

  test("keeps only absolute HTTP(S) links", () => {
    expect(safeCatalogUrl("https://shop.paymore.com/products/a?b=1")).toBe("https://shop.paymore.com/products/a?b=1");
    expect(safeCatalogUrl("http://example.com/item")).toBe("http://example.com/item");
  });

  test("exports loaded products as quoted CSV with ISO freshness, null cells and escaped text", () => {
    const csv = catalogCsv([{ ...summary, title: 'Phone, "special"\nsecond line' }]);
    expect(csv).toContain('"UPC","Title","MPN"');
    expect(csv).toContain('"012345678905","Phone, ""special""\nsecond line"');
    expect(csv).toContain('"2023-11-14T22:13:20.000Z"');
    expect(csv).toContain('"128GB","Black",""');
    expect(catalogCsv([]).split("\r\n")).toHaveLength(1);
  });

  test.each(["=SUM(A1)", "+1", "-1", "@SUM(A1)", "  =SUM(A1)", "\tformula", "\nformula"])(
    "neutralizes spreadsheet formulas and control-prefixed cell %s",
    (title) => {
      expect(catalogCsv([{ ...summary, title }])).toContain(`"'${title}"`);
    },
  );

  test("handles invalid or absent timestamps without throwing", () => {
    expect(catalogDate(undefined)).toBe("Unknown");
    expect(catalogDate(Number.NaN)).toBe("Unknown");
    expect(catalogDate(1e20)).toBe("Unknown");
    expect(catalogDate(summary.updatedAt)).toMatch(/2023/);
    expect(catalogCsv([{ ...summary, updatedAt: Number.NaN }])).toMatch(/,""$/);
  });

  test("filters loaded results, deduplicates facets, and preserves input order for relevance", () => {
    const first = { ...summary, title: "Z phone", brand: "Volt", platform: "Android" };
    const second = { ...summary, upc: "098765432105", title: "A phone", brand: "volt", platform: "iOS", updatedAt: 2 };
    const third = { ...summary, upc: "123456789012", brand: "Apple", platform: "iOS" };
    const products = [first, second, third];
    expect(catalogFilterOptions(products)).toEqual({ brands: ["Apple", "Volt"], platforms: ["Android", "iOS"] });
    expect(filterCatalogResults(products, { brand: " VOLT ", platform: "", sort: "relevance" })).toEqual([first, second]);
    expect(filterCatalogResults(products, { brand: "Volt", platform: "ios", sort: "relevance" })).toEqual([second]);
    expect(filterCatalogResults(products, { brand: "Volt", platform: "", sort: "title" })).toEqual([second, first]);
    expect(filterCatalogResults(products, { brand: "Volt", platform: "", sort: "updated" })).toEqual([first, second]);
    expect(filterCatalogResults(products, { brand: "Missing", platform: "", sort: "relevance" })).toEqual([]);
    expect(products).toEqual([first, second, third]);
  });
});
