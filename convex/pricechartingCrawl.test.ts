import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test, vi } from "vitest";

import { parseGamePage } from "./catalog/pricecharting";
import { SUPER_MARIO_64_HTML } from "./catalog/fixtures";
import { upsertCatalogProducts } from "./catalog/store";
import type { CatalogProduct } from "./catalog/types";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ingestGameDetails = makeFunctionReference<
  "mutation",
  { secret: string; items: Array<unknown> },
  {
    itemsSeen: number;
    productsIngested: number;
    skippedNoUpc: number;
    skippedNoTitle: number;
    skippedInvalidSource: number;
    inserted: number;
    updated: number;
    sourcesAdded: number;
  }
>("pricechartingCrawl:ingestGameDetails");
const getByUpcInternal = makeFunctionReference<
  "query",
  { upc: string },
  {
    upc: string;
    title: string;
    platform: string | null;
    upcs: string[];
    sourceUrls: string[];
    listings: Array<{ sourceUrl: string; imageUrl?: string }>;
  } | null
>("paymoreCatalog:getByUpcInternal");

const GAME_URL = "https://www.pricecharting.com/game/nintendo-64/super-mario-64";
const UPC_A = "045496870010";
const UPC_B = "012345678905";
const PAYMORE_URL_ONE = "https://rockvillemd.paymore.com/products/super-mario-64-nintendo-64";
const PAYMORE_URL_TWO = "https://rockvillemd.paymore.com/products/super-mario-64-nintendo-64-player-s-choice";

function paymoreRecord(upc: string, sourceUrls: string[]): CatalogProduct {
  return {
    upc,
    title: "Super Mario 64",
    platform: "Nintendo 64",
    edition: null,
    collection: null,
    brand: null,
    model: null,
    mpn: null,
    color: null,
    storage: null,
    carrier: null,
    publisher: null,
    genre: null,
    rating: null,
    releaseYear: null,
    attributes: {},
    collections: [],
    sourceUrls,
    listings: sourceUrls.map((sourceUrl) => ({ sourceUrl })),
  };
}

async function ingestPaymoreRecord(
  t: ReturnType<typeof convexTest>,
  product: CatalogProduct,
) {
  await t.run((ctx) => upsertCatalogProducts(ctx, [product], Date.now()));
}

describe("PriceCharting crawl ingestion", () => {
  test("rejects an invalid crawl secret", async () => {
    vi.stubEnv("PRICECHARTING_CRAWL_SECRET", "test-crawl-secret");
    const t = convexTest(schema, modules);
    await expect(
      t.mutation(ingestGameDetails, { secret: "wrong-secret", items: [] }),
    ).rejects.toThrow(/Invalid crawl secret/);
  });

  test("stores a parsed game page and exposes it through catalog lookups", async () => {
    vi.stubEnv("PRICECHARTING_CRAWL_SECRET", "test-crawl-secret");
    const t = convexTest(schema, modules);
    const record = parseGamePage(SUPER_MARIO_64_HTML, GAME_URL);
    if (record === null) throw new Error("fixture must parse");

    const result = await t.mutation(ingestGameDetails, {
      secret: "test-crawl-secret",
      items: [record],
    });
    expect(result).toMatchObject({
      itemsSeen: 1,
      productsIngested: 1,
      skippedNoUpc: 0,
      skippedNoTitle: 0,
      skippedInvalidSource: 0,
      inserted: 1,
      updated: 0,
      sourcesAdded: 1,
    });

    const product = await t.query(getByUpcInternal, { upc: UPC_A });
    expect(product).toMatchObject({
      upc: UPC_A,
      title: "Super Mario 64",
      platform: "Nintendo 64",
      sourceUrls: [GAME_URL],
    });
    expect(product?.listings[0]?.imageUrl).toContain("images.pricecharting.com");
  });

  test("keeps a multi-source product when a PriceCharting UPC is corrected", async () => {
    vi.stubEnv("PRICECHARTING_CRAWL_SECRET", "test-crawl-secret");
    const t = convexTest(schema, modules);
    const record = parseGamePage(SUPER_MARIO_64_HTML, GAME_URL);
    if (record === null) throw new Error("fixture must parse");

    await t.mutation(ingestGameDetails, { secret: "test-crawl-secret", items: [record] });
    await ingestPaymoreRecord(t, paymoreRecord(UPC_B, [PAYMORE_URL_ONE, PAYMORE_URL_TWO]));
    await t.mutation(ingestGameDetails, {
      secret: "test-crawl-secret",
      items: [{ ...record, upc: UPC_B }],
    });

    const product = await t.query(getByUpcInternal, { upc: UPC_B });
    expect(product).toMatchObject({ upc: UPC_B });
    expect(product?.sourceUrls).toEqual(expect.arrayContaining([GAME_URL, PAYMORE_URL_ONE]));
    expect(product?.sourceUrls).toHaveLength(3);
    expect(await t.query(getByUpcInternal, { upc: UPC_A })).toBeNull();
  });

  test("retains the stored canonical UPC for ties, then flips to the majority UPC", async () => {
    vi.stubEnv("PRICECHARTING_CRAWL_SECRET", "test-crawl-secret");
    const t = convexTest(schema, modules);
    const record = parseGamePage(SUPER_MARIO_64_HTML, GAME_URL);
    if (record === null) throw new Error("fixture must parse");

    await t.mutation(ingestGameDetails, { secret: "test-crawl-secret", items: [record] });
    await ingestPaymoreRecord(t, paymoreRecord(UPC_B, [PAYMORE_URL_ONE]));
    expect((await t.query(getByUpcInternal, { upc: UPC_A }))?.upc).toBe(UPC_A);

    await ingestPaymoreRecord(t, paymoreRecord(UPC_B, [PAYMORE_URL_TWO]));
    const byMajorityUpc = await t.query(getByUpcInternal, { upc: UPC_B });
    const byAliasUpc = await t.query(getByUpcInternal, { upc: UPC_A });

    expect(byMajorityUpc).toMatchObject({ upc: UPC_B });
    expect(byAliasUpc).toMatchObject({ upc: UPC_B, upcs: [UPC_B, UPC_A] });
  });
});
