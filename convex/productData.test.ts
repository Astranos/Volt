import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";

import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type ProductSummary = {
  upc: string;
  title: string;
  platform: string | null;
  edition: string | null;
  mpn: string | null;
  brand: string | null;
  model: string | null;
  color: string | null;
  storage: string | null;
  carrier: string | null;
  updatedAt: number;
};

type SearchResult = {
  page: ProductSummary[];
  isDone: boolean;
  continueCursor: string;
};

const searchProducts = makeFunctionReference<
  "query",
  { searchQuery?: string; paginationOpts: { numItems: number; cursor: string | null } },
  SearchResult
>("productData:searchProducts");
const searchPublicProducts = makeFunctionReference<
  "query",
  { searchQuery: string },
  { products: ProductSummary[]; hasMore: boolean }
>("productData:searchPublicProducts");
const getProductByUpc = makeFunctionReference<
  "query",
  { upc: string },
  { upc: string; title: string } | null
>("productData:getProductByUpc");
const findProductForAIScanner = makeFunctionReference<
  "query",
  {
    name: string;
    platform: string | null;
    edition: string | null;
    region: string | null;
    brand: string | null;
    model: string | null;
    mpn: string | null;
    color: string | null;
    storage: string | null;
    carrier: string | null;
  },
  { upc: string; title: string; platform: string | null; edition: string | null } | null
>("productData:findProductForAIScanner");
const createKey = makeFunctionReference<
  "mutation",
  { name: string },
  { id: Id<"productApiKeys">; token: string }
>("productApiKeys:create");

async function seedProduct(
  t: ReturnType<typeof convexTest>,
  overrides: { upc?: string; title?: string; mpn?: string } = {},
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("paymoreCatalogProducts", {
      upc: "012345678905",
      title: "Widget Phone 128GB",
      platform: null,
      edition: null,
      collection: null,
      brand: "Volt",
      model: "Widget",
      mpn: "WIDGET-128",
      color: "Black",
      storage: "128GB",
      carrier: null,
      publisher: null,
      genre: null,
      rating: null,
      releaseYear: "2026",
      attributes: {},
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      ...overrides,
    });
  });
}

describe("product data reads", () => {
  test.each(["  Widget Phone  ", "012345678905", "WIDGET-12"])(
    "allows anonymous public summary search for %s",
    async (searchQuery) => {
      const t = convexTest(schema, modules);
      await seedProduct(t);
      const result = await t.query(searchPublicProducts, { searchQuery });
      expect(result.hasMore).toBe(false);
      expect(result.products).toEqual([{
        upc: "012345678905",
        title: "Widget Phone 128GB",
        platform: null,
        edition: null,
        mpn: "WIDGET-128",
        brand: "Volt",
        model: "Widget",
        color: "Black",
        storage: "128GB",
        carrier: null,
        updatedAt: 1_700_000_000_000,
      }]);
      expect(Object.keys(result).sort()).toEqual(["hasMore", "products"]);
    },
  );

  test.each(["", "   ", "x", " x ", "x".repeat(121)])(
    "rejects invalid public search length for %j",
    async (searchQuery) => {
      const t = convexTest(schema, modules);
      await expect(t.query(searchPublicProducts, { searchQuery }))
        .rejects.toThrow("Search must be between 2 and 120 characters");
    },
  );

  test("finds MPNs with six digits after UPC lookup does not match", async () => {
    const t = convexTest(schema, modules);
    await seedProduct(t, { mpn: "ABC123456" });
    const result = await t.query(searchPublicProducts, { searchQuery: "ABC123456" });
    expect(result.products).toMatchObject([{ upc: "012345678905", mpn: "ABC123456" }]);
    expect(result.hasMore).toBe(false);
  });

  test("resolves aliases to canonical summaries and prefers a direct canonical match", async () => {
    const t = convexTest(schema, modules);
    await seedProduct(t);
    await t.run(async (ctx) => {
      const product = await ctx.db.query("paymoreCatalogProducts")
        .withIndex("by_upc", (q) => q.eq("upc", "012345678905"))
        .unique();
      if (!product) throw new Error("Missing seeded product");
      await ctx.db.insert("paymoreCatalogSources", {
        productId: product._id,
        upc: "036000291452",
        sourceUrl: "https://example.com/private-listing",
        imageUrl: "https://example.com/private-image.jpg",
        createdAt: 1_700_000_000_000,
      });
    });
    const alias = await t.query(searchPublicProducts, { searchQuery: "036000291452" });
    expect(alias.products).toMatchObject([{ upc: "012345678905", title: "Widget Phone 128GB" }]);
    expect(alias.products[0]).not.toHaveProperty("sourceUrls");
    expect(alias.products[0]).not.toHaveProperty("listings");
    expect(alias.products[0]).not.toHaveProperty("upcs");

    await seedProduct(t, { upc: "036000291452", title: "Direct Canonical Product" });
    const canonical = await t.query(searchPublicProducts, { searchQuery: "036000291452" });
    expect(canonical.products).toMatchObject([{ upc: "036000291452", title: "Direct Canonical Product" }]);
    expect(canonical.hasMore).toBe(false);
  });

  test.each(["xx", "x".repeat(120)])("accepts public search boundary length %s", async (searchQuery) => {
    const t = convexTest(schema, modules);
    expect(await t.query(searchPublicProducts, { searchQuery }))
      .toEqual({ products: [], hasMore: false });
  });

  test.each(["Widget Phone", "WIDGET-12"])(
    "caps anonymous results at twenty for %s",
    async (searchQuery) => {
      const t = convexTest(schema, modules);
      for (let index = 0; index < 25; index += 1) {
        await seedProduct(t, { upc: String(index).padStart(12, "0"), mpn: `WIDGET-12${index}` });
      }
      const result = await t.query(searchPublicProducts, { searchQuery });
      expect(result.products).toHaveLength(20);
      expect(result.hasMore).toBe(true);
    },
  );

  test("does not claim more results when exactly twenty match", async () => {
    const t = convexTest(schema, modules);
    for (let index = 0; index < 20; index += 1) {
      await seedProduct(t, { upc: String(index).padStart(12, "0") });
    }
    const result = await t.query(searchPublicProducts, { searchQuery: "Widget Phone" });
    expect(result.products).toHaveLength(20);
    expect(result.hasMore).toBe(false);
  });

  test("gates dashboard reads on Clerk authentication", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(searchProducts, {
      paginationOpts: { numItems: 25, cursor: null },
    })).rejects.toThrow(/Not authenticated/);
    await expect(t.query(getProductByUpc, { upc: "012345678905" }))
      .rejects.toThrow(/Not authenticated/);
  });

  test("searches and loads product data through the domain-neutral functions", async () => {
    const t = convexTest(schema, modules);
    await seedProduct(t);
    const user = t.withIdentity({ subject: "product-user", tokenIdentifier: "clerk|product-user" });

    const search = await user.query(searchProducts, {
      searchQuery: "Widget Phone",
      paginationOpts: { numItems: 25, cursor: null },
    });
    expect(search.page).toMatchObject([{
      upc: "012345678905",
      title: "Widget Phone 128GB",
      mpn: "WIDGET-128",
    }]);

    const product = await user.query(getProductByUpc, { upc: "012345678905" });
    expect(product).toMatchObject({ upc: "012345678905", title: "Widget Phone 128GB" });
  });

  test("resolves a visually identified product for the mobile AI scanner", async () => {
    const t = convexTest(schema, modules);
    await seedProduct(t);

    const product = await t.query(findProductForAIScanner, {
      name: "Widget Phone 128GB",
      platform: null,
      edition: null,
      region: null,
      brand: "Volt",
      model: "Widget",
      mpn: "WIDGET-128",
      color: "Black",
      storage: "128GB",
      carrier: null,
    });

    expect(product).toEqual({
      upc: "012345678905",
      title: "Widget Phone 128GB",
      platform: null,
      edition: null,
      brand: "Volt",
      model: "Widget",
      mpn: "WIDGET-128",
      color: "Black",
      storage: "128GB",
      carrier: null,
    });
  });

  test("resolves concise AI details against a production-shaped product title", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("paymoreCatalogProducts", {
        upc: "195950642834",
        title: "New T-Mobile Apple iPhone 17 256GB Lavender MG494LL/A",
        platform: null,
        edition: null,
        collection: "apple-iphones",
        brand: "Apple",
        model: "iPhone 17",
        mpn: "MG494LL/A",
        color: "Lavender",
        storage: "256GB",
        carrier: "T-Mobile",
        publisher: null,
        genre: null,
        rating: null,
        releaseYear: null,
        attributes: {},
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
      });
    });

    const product = await t.query(findProductForAIScanner, {
      name: "Apple iPhone 17",
      platform: null,
      edition: null,
      region: null,
      brand: "Apple",
      model: "iPhone 17",
      mpn: "MG494LL/A",
      color: "Lavender",
      storage: "256GB",
      carrier: "T-Mobile",
    });

    expect(product).toMatchObject({
      upc: "195950642834",
      title: "New T-Mobile Apple iPhone 17 256GB Lavender MG494LL/A",
      mpn: "MG494LL/A",
    });
  });

  test("rejects an ambiguous visual identity across distinct catalog variants", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (const product of [
        { upc: "012345678905", storage: "256GB", mpn: "PHONE-256" },
        { upc: "098765432105", storage: "512GB", mpn: "PHONE-512" },
      ]) {
        await ctx.db.insert("paymoreCatalogProducts", {
          upc: product.upc,
          title: `Apple iPhone 17 ${product.storage}`,
          platform: null,
          edition: null,
          collection: "apple-iphones",
          brand: "Apple",
          model: "iPhone 17",
          mpn: product.mpn,
          color: null,
          storage: product.storage,
          carrier: null,
          publisher: null,
          genre: null,
          rating: null,
          releaseYear: null,
          attributes: {},
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        });
      }
    });

    const product = await t.query(findProductForAIScanner, {
      name: "Apple iPhone 17",
      platform: null,
      edition: null,
      region: null,
      brand: "Apple",
      model: "iPhone 17",
      mpn: null,
      color: null,
      storage: null,
      carrier: null,
    });

    expect(product).toBeNull();
  });

  test("serves the external search route with Bearer auth and rate headers", async () => {
    const t = convexTest(schema, modules);
    await seedProduct(t);
    const user = t.withIdentity({ subject: "product-user", tokenIdentifier: "clerk|product-user" });
    const key = await user.mutation(createKey, { name: "Integration test" });

    const response = await t.fetch("/v1/products?q=Widget&limit=1", {
      headers: { Authorization: `Bearer ${key.token}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("X-RateLimit-Limit")).toBe("120");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("119");
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      data: [{ upc: "012345678905", title: "Widget Phone 128GB" }],
      pagination: { nextCursor: null },
    });

    const lookupResponse = await t.fetch("/v1/products/012345678905", {
      headers: { Authorization: `Bearer ${key.token}` },
    });
    expect(lookupResponse.status).toBe(200);
    expect(lookupResponse.headers.get("X-RateLimit-Remaining")).toBe("118");
    const lookupBody: unknown = await lookupResponse.json();
    expect(lookupBody).toMatchObject({
      data: {
        upc: "012345678905",
        title: "Widget Phone 128GB",
        brand: "Volt",
        attributes: {},
      },
    });
  });

  test.each(["/v1/products?q=Widget", "/v1/products/012345678905"])(
    "keeps API authentication required for %s",
    async (path) => {
      const t = convexTest(schema, modules);
      await seedProduct(t);
      const response = await t.fetch(path);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "missing_authorization" },
      });
    },
  );

  test("returns the stable error envelope for an invalid API key", async () => {
    const t = convexTest(schema, modules);
    const response = await t.fetch("/v1/products", {
      headers: { Authorization: `Bearer volt_pd_${"0".repeat(48)}` },
    });
    expect(response.status).toBe(401);
    const body: unknown = await response.json();
    expect(body).toEqual({
      error: {
        code: "invalid_api_key",
        message: "The API key is invalid or revoked",
      },
    });
  });

  test("returns a client error for a malformed pagination cursor", async () => {
    const t = convexTest(schema, modules);
    const user = t.withIdentity({ subject: "product-user", tokenIdentifier: "clerk|product-user" });
    const key = await user.mutation(createKey, { name: "Cursor test" });

    const response = await t.fetch("/v1/products?cursor=not-a-cursor", {
      headers: { Authorization: `Bearer ${key.token}` },
    });
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toEqual({
      error: {
        code: "invalid_cursor",
        message: "The pagination cursor is invalid or expired",
      },
    });
  });
});
