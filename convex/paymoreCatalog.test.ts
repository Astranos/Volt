import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test, vi } from "vitest";

import { crawlAuthorizedUrls, crawlSavedPages } from "./catalog/crawl";
import { splitSpecAttributes } from "./catalog/attributes";
import {
  CLAIR_OBSCUR_HTML,
  GALAXIAN_HTML,
  GALAXIAN_JSON_LD_HTML,
  IPHONE_HTML,
  INVALID_UPC_HTML,
  MARIO_HTML,
  MISSING_UPC_HTML,
  paymoreProductHtml,
} from "./catalog/fixtures";import { parseProductIdentity } from "./catalog/parseTitle";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const ingestPages = makeFunctionReference<
  "mutation",
  { pages: Array<{ sourceUrl: string; body: string }>; now?: number },
  {
    inserted: number;
    updated: number;
    sourcesAdded: number;
    fetched: number;
    rejected: Array<{ sourceUrl: string; reason: string }>;
  }
>("paymoreCatalog:ingestPages");
const ingestInventoryPage = makeFunctionReference<
  "mutation",
  { secret: string; collectionSlug: string; items: Array<unknown> },
  {
    itemsSeen: number;
    productsIngested: number;
    skippedNoUpc: number;
    skippedNoTitle: number;
    inserted: number;
    updated: number;
    sourcesAdded: number;
  }
>("paymoreCrawl:ingestInventoryPage");
const getByUpcInternal = makeFunctionReference<
  "query",
  { upc: string },
  {
    upc: string;
    title: string;
    platform: string | null;
    edition: string | null;
    sourceUrls: string[];
    upcs: string[];
    listings: Array<{
      sourceUrl: string;
      imageUrl?: string;
      updatedAt?: number;
    }>;
    createdAt: number;
    updatedAt: number;
  } | null
>("paymoreCatalog:getByUpcInternal");
const stripSourceListingFacts = makeFunctionReference<
  "mutation",
  { cursor?: string },
  { processed: number; stripped: number; isDone: boolean }
>("paymoreCatalog:stripSourceListingFacts");
const getProductByUpc = makeFunctionReference<
  "query",
  { upc: string },
  {
    upc: string;
    title: string;
    platform: string | null;
    edition: string | null;
    sourceUrls: string[];
    upcs: string[];
    createdAt: number;
    updatedAt: number;
} | null
>("productData:getProductByUpc");
const searchProducts = makeFunctionReference<
  "query",
  { searchQuery?: string; paginationOpts: { numItems: number; cursor: string | null } },
  {
    page: Array<{
      upc: string;
      title: string;
      platform: string | null;
      edition: string | null;
      brand: string | null;
      model: string | null;
      color: string | null;
      storage: string | null;
      carrier: string | null;
      updatedAt: number;
    }>;
    isDone: boolean;
    continueCursor: string | null;
  }
>("productData:searchProducts");

const ROCKVILLE_CLAIR =
  "https://rockvillemd.paymore.com/products/new-clair-obscur-expedition-33-lumiere-edition-sony-playstation-5-ps5-2025";
const ROCKVILLE_GALAXIAN =
  "https://rockvillemd.paymore.com/products/galaxian-atari-5200-1981";
const ANAHEIM_GALAXIAN =
  "https://anaheimca.paymore.com/products/galaxian-atari-5200-1981";
const ROCKVILLE_MARIO =
  "https://rockvillemd.paymore.com/products/super-mario-bros-nintendo-nes-1985-cartridge-only";
const ROCKVILLE_INVALID =
  "https://rockvillemd.paymore.com/products/unknown-prototype-nintendo-switch";
const ROCKVILLE_BARGAIN =
  "https://rockvillemd.paymore.com/products/bargain-bin-game";
const POOLER_IPHONE =
  "https://poolerga.paymore.com/products/t-mobile-apple-iphone-17-256gb-lavender-mg494ll-a";

describe("PayMore catalog identity parsing", () => {
  test("strips condition, edition brackets, platform, and year", () => {
    expect(parseProductIdentity("New Clair Obscur: Expedition 33 [Lumiere Edition] (Sony PlayStation 5 PS5, 2025)")).toEqual({
      title: "Clair Obscur: Expedition 33",
      platform: "Sony PlayStation 5 PS5",
      edition: "Lumiere Edition",
    });
  });

  test("keeps cartridge-only listings as the base title and platform", () => {
    expect(parseProductIdentity("Super Mario Bros (Nintendo NES, 1985) Cartridge Only")).toEqual({
      title: "Super Mario Bros",
      platform: "Nintendo NES",
      edition: null,
    });
  });
});

describe("PayMore catalog crawler", () => {
  test("extracts title, platform, edition, and a valid UPC from a specs table", () => {
    const result = crawlSavedPages([{ sourceUrl: ROCKVILLE_CLAIR, body: CLAIR_OBSCUR_HTML }]);
    expect(result.rejected).toEqual([]);
    expect(result.products[0]).toMatchObject({
      upc: "810145310328",
      title: "Clair Obscur: Expedition 33",
      platform: "Sony PlayStation 5 PS5",
      edition: "Lumiere Edition",
      collection: "Video Game",
      publisher: "Sandfall Interactive",
      genre: "RPG",
      rating: "M - Mature 17+",
      releaseYear: "2025",
      sourceUrls: [ROCKVILLE_CLAIR],
      listings: [{ sourceUrl: ROCKVILLE_CLAIR }],
    });
  });

  test("rejects invalid UPC checksums and listings without a UPC", () => {
    const result = crawlSavedPages([
      { sourceUrl: ROCKVILLE_INVALID, body: INVALID_UPC_HTML },
      { sourceUrl: ROCKVILLE_BARGAIN, body: MISSING_UPC_HTML },
    ]);
    expect(result.products).toEqual([]);
    expect(result.rejected).toEqual([
      { sourceUrl: ROCKVILLE_INVALID, reason: "invalid-upc" },
      { sourceUrl: ROCKVILLE_BARGAIN, reason: "missing-upc" },
    ]);
  });

  test("deduplicates by UPC and preserves every authorized source URL", () => {
    const result = crawlSavedPages([
      { sourceUrl: ROCKVILLE_GALAXIAN, body: GALAXIAN_HTML },
      { sourceUrl: ANAHEIM_GALAXIAN, body: GALAXIAN_JSON_LD_HTML },
      { sourceUrl: ROCKVILLE_MARIO, body: MARIO_HTML },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.products).toMatchObject([
      {
        upc: "077000052063",
        title: "Galaxian",
        platform: "Atari 5200",
        publisher: "Atari",
        sourceUrls: [ROCKVILLE_GALAXIAN, ANAHEIM_GALAXIAN],
      },
      {
        upc: "074299009129",
        title: "Super Mario Bros",
        platform: "Nintendo NES",
        publisher: "Nintendo",
        sourceUrls: [ROCKVILLE_MARIO],
      },
    ]);
  });

  test("extracts the same fields from authorized Shopify product JSON fixtures", () => {
    const result = crawlSavedPages([
      {
        sourceUrl: "https://rockvillemd.paymore.com/products/galaxian-atari-5200-1981.json",
        body: JSON.stringify({
          product: {
            title: "Galaxian (Atari 5200, 1981)",
            handle: "galaxian-atari-5200-1981",
            body_html: GALAXIAN_HTML,
            variants: [{ barcode: "077000052063" }],
          },
        }),
      },
    ]);
    expect(result.rejected).toEqual([]);
    expect(result.products).toMatchObject([
      {
        upc: "077000052063",
        title: "Galaxian",
        platform: "Atari 5200",
        sourceUrls: [ROCKVILLE_GALAXIAN],
      },
    ]);
  });

  test("refuses unauthorized hosts even when the HTML is otherwise valid", () => {
    const result = crawlSavedPages([
      { sourceUrl: "https://example.com/products/galaxian-atari-5200-1981", body: GALAXIAN_HTML },
    ]);
    expect(result.products).toEqual([]);
    expect(result.rejected).toEqual([
      { sourceUrl: "https://example.com/products/galaxian-atari-5200-1981", reason: "unauthorized-host" },
    ]);
  });

  test("fetches only through the provided client and never requires a live PayMore request", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(GALAXIAN_HTML, { status: 200 }));
    const result = await crawlAuthorizedUrls([ROCKVILLE_GALAXIAN, "https://evil.test/products/galaxian"], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(ROCKVILLE_GALAXIAN);
    expect(result.products[0]).toMatchObject({ upc: "077000052063", sourceUrls: [ROCKVILLE_GALAXIAN] });
    expect(result.rejected).toEqual([
      { sourceUrl: "https://evil.test/products/galaxian", reason: "unauthorized-host" },
    ]);
  });

  test("extracts device attributes and drops unit-only fields", () => {
    const result = crawlSavedPages([{ sourceUrl: POOLER_IPHONE, body: IPHONE_HTML }]);
    expect(result.rejected).toEqual([]);
    expect(result.products[0]).toMatchObject({
      upc: "195950642834",
      title: "T-Mobile Apple iPhone 17 256GB Lavender MG494LL/A",
      collection: "Apple iPhone",
      brand: "Apple",
      model: "iPhone 17",
      mpn: "MG494LL/A",
      color: "Lavender",
      storage: "256GB",
      carrier: "T-Mobile",
      attributes: {
        simSlot: "eSIM",
        screenSize: "6.3\"",
      },
      listings: [{ sourceUrl: POOLER_IPHONE }],
    });
    // Condition and SKU are per-unit listing facts: discarded, not stored.
    expect(result.products[0]?.listings[0]).toEqual({ sourceUrl: POOLER_IPHONE });
  });

  test("drops unit-only spec rows even with unfamiliar labels", () => {
    const split = splitSpecAttributes([
      ["ICloud Lock", "On"],
      ["ESN", "A12345"],
      ["Find My iPhone", "Enabled"],
      ["Screen Size", "6.3\""],
      ["Condition", "Good"],
    ]);
    expect(split.product).toEqual({ screenSize: "6.3\"" });
    // Condition is a per-unit listing fact: discarded, and no listing
    // record comes back from the split at all.
    expect(split).not.toHaveProperty("listing");
  });

  test("reports invalid-json instead of missing-title for malformed JSON bodies", () => {
    const result = crawlSavedPages([
      { sourceUrl: `${ROCKVILLE_GALAXIAN}.json`, body: "{not valid json" },
    ]);
    expect(result.products).toEqual([]);
    expect(result.rejected[0]).toMatchObject({ reason: "invalid-json" });
    expect(result.rejected[0]?.detail).toBeTruthy();
  });

  test("retries transient fetch failures before reporting fetch-failed", async () => {
    const responses = [
      new Response("rate limited", { status: 429 }),
      new Response("bad gateway", { status: 502 }),
      new Response(GALAXIAN_HTML, { status: 200 }),
    ];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => {
      const response = responses.shift();
      return Promise.resolve(response ?? new Response(null, { status: 500 }));
    });
    const result = await crawlAuthorizedUrls([ROCKVILLE_GALAXIAN], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.products).toMatchObject([{ upc: "077000052063" }]);
    expect(result.rejected).toEqual([]);
  });

  test("does not retry permanent failures like 404", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("nope", { status: 404 }));
    const result = await crawlAuthorizedUrls([ROCKVILLE_GALAXIAN], fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.products).toEqual([]);
    expect(result.rejected).toEqual([
      { sourceUrl: ROCKVILLE_GALAXIAN, reason: "fetch-failed", detail: "HTTP 404" },
    ]);
  });
});

describe("PayMore catalog Convex storage", () => {
  test("upserts extracted products and keeps both source URLs on the same UPC", async () => {
    const t = convexTest(schema, modules);
    const now = 1_700_000_000_000;
    const ingested = await t.mutation(ingestPages, {
      now,
      pages: [
        { sourceUrl: ROCKVILLE_GALAXIAN, body: GALAXIAN_HTML },
        { sourceUrl: ANAHEIM_GALAXIAN, body: GALAXIAN_JSON_LD_HTML },
        { sourceUrl: ROCKVILLE_CLAIR, body: CLAIR_OBSCUR_HTML },
        { sourceUrl: ROCKVILLE_INVALID, body: INVALID_UPC_HTML },
      ],
    });

    expect(ingested).toMatchObject({
      inserted: 2,
      updated: 0,
      sourcesAdded: 3,
      rejected: [{ sourceUrl: ROCKVILLE_INVALID, reason: "invalid-upc" }],
    });

    const galaxian = await t.query(getByUpcInternal, { upc: "077000052063" });
    expect(galaxian).toMatchObject({
      upc: "077000052063",
      title: "Galaxian",
      platform: "Atari 5200",
      publisher: "Atari",
      genre: "Arcade",
      sourceUrls: [ROCKVILLE_GALAXIAN, ANAHEIM_GALAXIAN],
      listings: [
        { sourceUrl: ROCKVILLE_GALAXIAN },
        { sourceUrl: ANAHEIM_GALAXIAN },
      ],
      createdAt: now,
      updatedAt: now,
    });

    const replay = await t.mutation(ingestPages, {
      now: now + 1,
      pages: [{ sourceUrl: ROCKVILLE_GALAXIAN, body: GALAXIAN_HTML }],
    });
    expect(replay).toMatchObject({ inserted: 0, updated: 1, sourcesAdded: 0 });
  });

  test("requires authentication for public catalog lookup", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(getProductByUpc, { upc: "077000052063" })).rejects.toThrow(/Not authenticated/);

    const authed = t.withIdentity({ subject: "catalog-user", tokenIdentifier: "clerk|catalog-user" });
    await authed.mutation(ingestPages, {
      pages: [{ sourceUrl: ROCKVILLE_MARIO, body: MARIO_HTML }],
    });
    const product = await authed.query(getProductByUpc, { upc: "074299009129" });
    expect(product).toMatchObject({
      upc: "074299009129",
      title: "Super Mario Bros",
      platform: "Nintendo NES",
      sourceUrls: [ROCKVILLE_MARIO],
    });
  });

  test("re-points a source to the corrected UPC and removes the orphaned product", async () => {
    const t = convexTest(schema, modules);
    const now = 1_700_000_000_000;
    const wrongUpcHtml = paymoreProductHtml({
      title: "Galaxian (Atari 5200, 1981)",
      gameName: "Galaxian",
      platform: "Atari 5200",
      upc: "012345678905",
      extraRows: [["Publisher", "Atari"]],
    });

    await t.mutation(ingestPages, { now, pages: [{ sourceUrl: ROCKVILLE_GALAXIAN, body: wrongUpcHtml }] });
    expect(await t.query(getByUpcInternal, { upc: "012345678905" })).toMatchObject({
      sourceUrls: [ROCKVILLE_GALAXIAN],
    });

    const corrected = await t.mutation(ingestPages, {
      now: now + 1,
      pages: [{ sourceUrl: ROCKVILLE_GALAXIAN, body: GALAXIAN_HTML }],
    });
    expect(corrected).toMatchObject({ inserted: 1, updated: 0, sourcesAdded: 0 });

    expect(await t.query(getByUpcInternal, { upc: "012345678905" })).toBeNull();
    expect(await t.query(getByUpcInternal, { upc: "077000052063" })).toMatchObject({
      upc: "077000052063",
      sourceUrls: [ROCKVILLE_GALAXIAN],
    });
  });

  test("merges API page sources with freshness and no legacy metric fields", async () => {
    vi.stubEnv("INVENTORY_CRAWL_SECRET", "test-crawl-secret");
    const t = convexTest(schema, modules);
    const page = { secret: "test-crawl-secret", collectionSlug: "used-video-games-us" };

    const first = await t.mutation(ingestInventoryPage, {
      ...page,
      items: [
        {
          p_id: "15872618299690",
          filter_attributes: {
            Platform: "Nintendo NES",
            "Game Name": "Galaxian",
            UPC: "012345678905",
          },
          v_price: 59.99,
          v_qty: 1,
          shop_name: "paymore-rockville",
          p_image: "https://paymore.com/cdn/shop/files/galaxian-nes-rockville.jpg",
        },
      ],
    });
    const second = await t.mutation(ingestInventoryPage, {
      ...page,
      items: [
        {
          p_id: "15872618299691",
          filter_attributes: {
            Platform: "Nintendo NES",
            "Game Name": "Galaxian",
            UPC: "098765432105",
          },
          v_price: 49.99,
          v_qty: 2,
          shop_name: "paymore-anaheim",
          p_image: "https://paymore.com/cdn/shop/files/galaxian-nes-anaheim.jpg",
        },
      ],
    });
    expect(first).toMatchObject({ inserted: 1, updated: 0, sourcesAdded: 1 });
    expect(second).toMatchObject({ inserted: 0, updated: 1, sourcesAdded: 1 });

    const product = await t.query(getByUpcInternal, { upc: "012345678905" });
    expect(product?.upcs).toEqual(["012345678905", "098765432105"]);
    const listings = product?.listings ?? [];
    expect(listings).toHaveLength(2);

    const rockville = listings.find(
      (listing) => listing.sourceUrl === "https://paymore.com/shop/product/15872618299690",
    );
    const anaheim = listings.find(
      (listing) => listing.sourceUrl === "https://paymore.com/shop/product/15872618299691",
    );
    expect(rockville).toMatchObject({
      imageUrl: "https://paymore.com/cdn/shop/files/galaxian-nes-rockville.jpg",
    });
    expect(anaheim).toMatchObject({
      imageUrl: "https://paymore.com/cdn/shop/files/galaxian-nes-anaheim.jpg",
    });
    expect(rockville).not.toHaveProperty("price");
    expect(rockville).not.toHaveProperty("quantity");
    expect(rockville).not.toHaveProperty("storeName");
    expect(rockville).not.toHaveProperty("condition");
    expect(rockville).not.toHaveProperty("attributes");
    expect(anaheim).not.toHaveProperty("price");
    expect(anaheim).not.toHaveProperty("storeName");
    expect(anaheim).not.toHaveProperty("condition");
    expect(anaheim).not.toHaveProperty("attributes");
    expect(rockville?.updatedAt).toBeGreaterThan(0);
    expect(anaheim?.updatedAt).toBeGreaterThan(0);
    expect(anaheim?.updatedAt ?? 0).toBeGreaterThanOrEqual(rockville?.updatedAt ?? 0);
    vi.unstubAllEnvs();
  });

  test("stripSourceListingFacts removes all legacy listing facts from source rows", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const now = 1_700_000_000_000;
    await t.mutation(ingestPages, {
      now,
      pages: [{ sourceUrl: ROCKVILLE_GALAXIAN, body: GALAXIAN_HTML }],
    });

    // Seed every legacy per-listing fact directly, mimicking rows created
    // before the catalog went spec-only.
    const seeded = await t.run(async (ctx) => {
      const sources = await ctx.db.query("paymoreCatalogSources").collect();
      for (const source of sources) {
        await ctx.db.patch(source._id, {
          price: 49.99,
          quantity: 2,
          storeName: "paymore-rockville",
          condition: "Acceptable",
          listingAttributes: { condition: "Acceptable", sku: "GA-1" },
        });
      }
      return sources.length;
    });
    expect(seeded).toBeGreaterThan(0);

    const first = await t.mutation(stripSourceListingFacts, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(first.processed).toBe(seeded);
    expect(first.stripped).toBe(seeded);
    expect(first.isDone).toBe(true);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("paymoreCatalogSources").collect(),
    );
    for (const row of rows) {
      expect(row).not.toHaveProperty("price");
      expect(row).not.toHaveProperty("quantity");
      expect(row).not.toHaveProperty("storeName");
      expect(row).not.toHaveProperty("condition");
      expect(row).not.toHaveProperty("listingAttributes");
      expect(row.sourceUrl).toBe(ROCKVILLE_GALAXIAN);
      expect(row.upc).toBe("077000052063");
      expect(row.createdAt).toBe(now);
      expect(row.updatedAt).toBe(now);
      // Fields absent on the legacy row stay absent after replace.
      expect(row).not.toHaveProperty("imageUrl");
    }

    const second = await t.mutation(stripSourceListingFacts, {});
    expect(second).toEqual({ processed: rows.length, stripped: 0, isDone: true });

    vi.useRealTimers();
  });
});

describe("Product data search", () => {
  async function ingestTwoProducts(t: ReturnType<typeof convexTest>) {
    await t.mutation(ingestPages, {
      pages: [
        { sourceUrl: ROCKVILLE_GALAXIAN, body: GALAXIAN_HTML },
        { sourceUrl: ROCKVILLE_MARIO, body: MARIO_HTML },
      ],
    });
  }

  test("requires authentication", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(searchProducts, { paginationOpts: { numItems: 25, cursor: null } }),
    ).rejects.toThrow(/Not authenticated/);
  });

  test("returns every product for an empty query in title order", async () => {
    const t = convexTest(schema, modules);
    await ingestTwoProducts(t);
    const authed = t.withIdentity({ subject: "catalog-user", tokenIdentifier: "clerk|catalog-user" });
    const result = await authed.query(searchProducts, {
      searchQuery: "",
      paginationOpts: { numItems: 25, cursor: null },
    });
    expect(result.page.map((product) => product.title)).toEqual(["Galaxian", "Super Mario Bros"]);
    expect(result.isDone).toBe(true);
  });

  test("matches a single product by title search", async () => {
    const t = convexTest(schema, modules);
    await ingestTwoProducts(t);
    const authed = t.withIdentity({ subject: "catalog-user", tokenIdentifier: "clerk|catalog-user" });
    const result = await authed.query(searchProducts, {
      searchQuery: "Mario",
      paginationOpts: { numItems: 25, cursor: null },
    });
    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toMatchObject({ upc: "074299009129", title: "Super Mario Bros" });
  });

  test("matches an exact UPC for an all-digit query", async () => {
    const t = convexTest(schema, modules);
    await ingestTwoProducts(t);
    const authed = t.withIdentity({ subject: "catalog-user", tokenIdentifier: "clerk|catalog-user" });
    const result = await authed.query(searchProducts, {
      searchQuery: "077000052063",
      paginationOpts: { numItems: 25, cursor: null },
    });
    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toMatchObject({ upc: "077000052063", title: "Galaxian" });
    expect(result.isDone).toBe(true);
  });

  test("matches a full or partial MPN case-insensitively", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(ingestPages, {
      pages: [{ sourceUrl: POOLER_IPHONE, body: IPHONE_HTML }],
    });
    const authed = t.withIdentity({ subject: "catalog-user", tokenIdentifier: "clerk|catalog-user" });
    for (const query of ["MG494LL/A", "mg494ll/a", "MG494"]) {
      const result = await authed.query(searchProducts, {
        searchQuery: query,
        paginationOpts: { numItems: 25, cursor: null },
      });
      expect(result.page).toHaveLength(1);
      expect(result.page[0]).toMatchObject({ mpn: "MG494LL/A", title: "T-Mobile Apple iPhone 17 256GB Lavender MG494LL/A" });
    }
  });

  test("falls back to title search when a code-like query matches no MPN", async () => {
    const t = convexTest(schema, modules);
    await ingestTwoProducts(t);
    const authed = t.withIdentity({ subject: "catalog-user", tokenIdentifier: "clerk|catalog-user" });
    const result = await authed.query(searchProducts, {
      searchQuery: "iphone15x",
      paginationOpts: { numItems: 25, cursor: null },
    });
    expect(result.page).toEqual([]);
  });
});

describe("PayMore catalog multi-UPC products", () => {
  const GALAXIAN_ALIAS =
    "https://rockvillemd.paymore.com/products/galaxian-atari-5200-1981-alias";
  const GALAXIAN_UPC_A = "077000052063";
  const GALAXIAN_UPC_B = "088888888880";
  const NES_GALAXIAN =
    "https://rockvillemd.paymore.com/products/galaxian-nintendo-nes-1984";
  const NES_GALAXIAN_UPC = "022222222220";
  const MPN_UPC_ONE = "012345678905";
  const MPN_UPC_TWO = "098765432105";
  const MPN_SOURCE_ONE =
    "https://rockvillemd.paymore.com/products/apple-iphone-14-pro-max-128gb-mq8r3ll-a";
  const MPN_SOURCE_TWO =
    "https://anaheimca.paymore.com/products/apple-iphone-14-pro-max-mq8r3ll-a-unlocked";

  async function ingestGalaxianPair(t: ReturnType<typeof convexTest>) {
    const aliasHtml = paymoreProductHtml({
      title: "Galaxian (Atari 5200, 1981)",
      gameName: "Galaxian",
      platform: "Atari 5200",
      upc: GALAXIAN_UPC_B,
      extraRows: [["Publisher", "Atari"]],
    });
    await t.mutation(ingestPages, {
      pages: [
        { sourceUrl: ROCKVILLE_GALAXIAN, body: GALAXIAN_HTML },
        { sourceUrl: ANAHEIM_GALAXIAN, body: GALAXIAN_JSON_LD_HTML },
      ],
    });
    await t.mutation(ingestPages, {
      pages: [{ sourceUrl: GALAXIAN_ALIAS, body: aliasHtml }],
    });
  }

  test("merges same title + platform listings across UPCs and resolves both UPCs", async () => {
    const t = convexTest(schema, modules);
    await ingestGalaxianPair(t);

    const byCanonical = await t.query(getByUpcInternal, { upc: GALAXIAN_UPC_A });
    const byAlias = await t.query(getByUpcInternal, { upc: GALAXIAN_UPC_B });
    expect(byCanonical?.upc).toBe(GALAXIAN_UPC_A);
    expect(byAlias).toMatchObject({ upc: GALAXIAN_UPC_A, title: "Galaxian" });

    // Canonical UPC A has two sources, alias UPC B has one, so A ranks first.
    expect(byCanonical?.upcs).toEqual([GALAXIAN_UPC_A, GALAXIAN_UPC_B]);
    expect(byAlias?.upcs).toEqual([GALAXIAN_UPC_A, GALAXIAN_UPC_B]);
    expect([...(byAlias?.sourceUrls ?? [])].sort()).toEqual(
      [ROCKVILLE_GALAXIAN, ANAHEIM_GALAXIAN, GALAXIAN_ALIAS].sort(),
    );
  });

  test("search resolves an alias UPC for an all-digit query", async () => {
    const t = convexTest(schema, modules);
    await ingestGalaxianPair(t);
    const authed = t.withIdentity({ subject: "catalog-user", tokenIdentifier: "clerk|catalog-user" });
    const result = await authed.query(searchProducts, {
      searchQuery: GALAXIAN_UPC_B,
      paginationOpts: { numItems: 25, cursor: null },
    });
    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toMatchObject({ upc: GALAXIAN_UPC_A, title: "Galaxian" });
    expect(result.isDone).toBe(true);
  });

  test("merges listings that share an MPN and platform across UPCs", async () => {
    const t = convexTest(schema, modules);
    const first = paymoreProductHtml({
      title: "Apple iPhone 14 Pro Max (Apple iPhone) 128GB Unlocked MQ8R3LL/A",
      platform: "Apple iPhone",
      upc: MPN_UPC_ONE,
      extraRows: [["MPN", "MQ8R3LL/A"], ["Brand", "Apple"]],
    });
    const second = paymoreProductHtml({
      title: "Unlocked Apple iPhone 14 Pro Max 128GB Deep Purple",
      platform: "Apple iPhone",
      upc: MPN_UPC_TWO,
      extraRows: [["MPN", "MQ8R3LL/A"], ["Brand", "Apple"]],
    });
    await t.mutation(ingestPages, {
      pages: [
        { sourceUrl: MPN_SOURCE_ONE, body: first },
        { sourceUrl: MPN_SOURCE_TWO, body: second },
      ],
    });

    const byFirst = await t.query(getByUpcInternal, { upc: MPN_UPC_ONE });
    const bySecond = await t.query(getByUpcInternal, { upc: MPN_UPC_TWO });
    expect(byFirst).toMatchObject({ upc: MPN_UPC_ONE, mpn: "MQ8R3LL/A" });
    expect(bySecond).toMatchObject({ upc: MPN_UPC_ONE, mpn: "MQ8R3LL/A" });
    expect(bySecond?.sourceUrls).toHaveLength(2);
  });

  test("keeps same-title products on different platforms separate", async () => {
    const t = convexTest(schema, modules);
    const nesHtml = paymoreProductHtml({
      title: "Galaxian (Nintendo NES, 1984)",
      gameName: "Galaxian",
      platform: "Nintendo NES",
      upc: NES_GALAXIAN_UPC,
      extraRows: [["Publisher", "Atari"]],
    });
    await t.mutation(ingestPages, {
      pages: [
        { sourceUrl: ROCKVILLE_GALAXIAN, body: GALAXIAN_HTML },
        { sourceUrl: NES_GALAXIAN, body: nesHtml },
      ],
    });

    const atari = await t.query(getByUpcInternal, { upc: GALAXIAN_UPC_A });
    const nes = await t.query(getByUpcInternal, { upc: NES_GALAXIAN_UPC });
    expect(atari).toMatchObject({ upc: GALAXIAN_UPC_A, platform: "Atari 5200" });
    expect(nes).toMatchObject({ upc: NES_GALAXIAN_UPC, platform: "Nintendo NES" });
    expect(atari?.upcs).toEqual([GALAXIAN_UPC_A]);
    expect(nes?.upcs).toEqual([NES_GALAXIAN_UPC]);
  });
});
