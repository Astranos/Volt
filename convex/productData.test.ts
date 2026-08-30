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
const getProductByUpc = makeFunctionReference<
  "query",
  { upc: string },
  { upc: string; title: string } | null
>("productData:getProductByUpc");
const findProductForAIScanner = makeFunctionReference<
  "query",
  { name: string; platform: string | null; edition: string | null; region: string | null },
  { upc: string; title: string; platform: string | null; edition: string | null } | null
>("productData:findProductForAIScanner");
const createKey = makeFunctionReference<
  "mutation",
  { name: string },
  { id: Id<"productApiKeys">; token: string }
>("productApiKeys:create");

async function seedProduct(t: ReturnType<typeof convexTest>) {
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
    });
  });
}

describe("product data reads", () => {
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
    });

    expect(product).toEqual({
      upc: "012345678905",
      title: "Widget Phone 128GB",
      platform: null,
      edition: null,
    });
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
