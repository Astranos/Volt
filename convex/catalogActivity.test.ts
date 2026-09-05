import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { loadCatalogActivity, UTC_DAY_MS } from "./catalog/activity";
import { upsertCatalogProducts } from "./catalog/store";
import type { CatalogProduct } from "./catalog/types";

const modules = import.meta.glob("./**/*.ts");
const activity = makeFunctionReference<
  "query",
  { days: 7 | 30; endDay: number },
  Awaited<ReturnType<typeof loadCatalogActivity>>
>("catalogActivity:summary");
const today = Date.UTC(2026, 8, 5);
const product: CatalogProduct = {
  upc: "012345678905",
  title: "Widget Phone",
  platform: null,
  edition: null,
  collection: null,
  brand: "Volt",
  model: "Widget",
  mpn: "WIDGET-128",
  color: null,
  storage: "128GB",
  carrier: null,
  publisher: null,
  genre: null,
  rating: null,
  releaseYear: null,
  attributes: {},
  sourceUrls: ["https://shop.paymore.com/products/widget-phone"],
  listings: [{ sourceUrl: "https://shop.paymore.com/products/widget-phone" }],
};

function signedIn(t: ReturnType<typeof convexTest>) {
  return t.withIdentity({ subject: "reader", tokenIdentifier: "clerk|reader" });
}

describe("global catalog activity", () => {
  test("requires authentication even without activity", async () => {
    const t = convexTest(schema, modules);
    await expect(t.query(activity, { days: 7, endDay: today })).rejects.toThrow("Not authenticated");
  });

  test("returns uncovered empty history rather than inventing a tracking date", async () => {
    const t = convexTest(schema, modules);
    const result = await signedIn(t).query(activity, { days: 7, endDay: today });
    expect(result.trackingStartedAt).toBeNull();
    expect(result.lastIngestAt).toBeNull();
    expect(result.points).toHaveLength(7);
    expect(result.totals).toEqual({ inserted: 0, refreshed: 0, sourcesAdded: 0, batches: 0 });
    expect(result.points[0]?.dayStart).toBe(today - 6 * UTC_DAY_MS);
    expect(result.points[6]?.dayStart).toBe(today);
  });

  test("counts new records and replay refreshes transactionally across UTC midnight", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => upsertCatalogProducts(ctx, [product], today - 1));
    await t.run((ctx) => upsertCatalogProducts(ctx, [product], today + 1));
    await t.run((ctx) => upsertCatalogProducts(ctx, [product], today + 2));
    const result = await signedIn(t).query(activity, { days: 7, endDay: today });
    expect(result.trackingStartedAt).toBe(today - 1);
    expect(result.lastIngestAt).toBe(today + 2);
    expect(result.points[5]).toEqual({ dayStart: today - UTC_DAY_MS, inserted: 1, refreshed: 0, sourcesAdded: 1, batches: 1 });
    expect(result.points[6]).toEqual({ dayStart: today, inserted: 0, refreshed: 2, sourcesAdded: 0, batches: 2 });
    expect(result.totals).toEqual({ inserted: 1, refreshed: 2, sourcesAdded: 1, batches: 3 });
  });

  test("ignores empty or entirely rejected product batches", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => upsertCatalogProducts(ctx, [], today));
    await t.run((ctx) => upsertCatalogProducts(ctx, [{ ...product, upc: "invalid" }], today));
    const result = await signedIn(t).query(activity, { days: 7, endDay: today });
    expect(result.trackingStartedAt).toBeNull();
    expect(result.totals.batches).toBe(0);
  });

  test("rolls back products and activity together on failed transaction", async () => {
    const t = convexTest(schema, modules);
    await expect(t.run(async (ctx) => {
      await upsertCatalogProducts(ctx, [product], today);
      throw new Error("abort import");
    })).rejects.toThrow("abort import");
    const result = await signedIn(t).query(activity, { days: 7, endDay: today });
    expect(result.trackingStartedAt).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("paymoreCatalogProducts").take(1))).toEqual([]);
  });

  test("limits the range to 30 rows while retaining global coverage metadata", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let offset = 0; offset < 60; offset += 1) {
        const dayStart = today - offset * UTC_DAY_MS;
        await ctx.db.insert("catalogActivityDays", {
          dayStart, inserted: 1, refreshed: 2, sourcesAdded: 3, batches: 1,
          firstIngestAt: dayStart + 1, lastIngestAt: dayStart + 2,
        });
      }
    });
    const result = await signedIn(t).query(activity, { days: 30, endDay: today });
    expect(result.points).toHaveLength(30);
    expect(result.points[0]?.dayStart).toBe(today - 29 * UTC_DAY_MS);
    expect(result.totals).toEqual({ inserted: 30, refreshed: 60, sourcesAdded: 90, batches: 30 });
    expect(result.trackingStartedAt).toBe(today - 59 * UTC_DAY_MS + 1);
    expect(result.lastIngestAt).toBe(today + 2);
  });

  test.each([today + 1, -UTC_DAY_MS, 8_640_000_000_000_000 + UTC_DAY_MS, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid UTC range endpoint %s", async (endDay) => {
      const t = convexTest(schema, modules);
      await expect(signedIn(t).query(activity, { days: 7, endDay })).rejects.toThrow("UTC midnight");
    },
  );
});
