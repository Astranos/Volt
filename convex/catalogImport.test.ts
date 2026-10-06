import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import type { CatalogProduct } from "./catalog/types";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const secret = "test-import-secret";
const group = "video-games";

const begin = makeFunctionReference<"mutation", {
  secret: string; leaseId: string; collections: string[]; fullImport: boolean;
}, { runId: Id<"catalogImportRuns">; resumed: boolean; collections: Array<{
  slug: string; nextToken: string | null; pagesDone: number;
}> }>("catalogImport:beginRun");
const ingest = makeFunctionReference<"mutation", {
  secret: string; runId: Id<"catalogImportRuns">; leaseId: string;
  collectionSlug: string; requestToken: string | null; nextToken: string | null;
  itemsSeen: number; skippedNoUpc: number; skippedNoTitle: number;
  products: CatalogProduct[];
}, { duplicate: boolean; inserted: number; reviewCandidates: number }>("catalogImport:ingestPage");
const ingestBatch = makeFunctionReference<"mutation", {
  secret: string; products: CatalogProduct[]; itemsSeen: number;
  skippedNoUpc: number; skippedNoTitle: number; skippedInvalidSource: number;
}, { productsIngested: number; inserted: number }>("catalogImport:ingestBatch");
const finish = makeFunctionReference<"mutation", {
  secret: string; runId: Id<"catalogImportRuns">; leaseId: string;
}, "paused" | "complete">("catalogImport:finishRun");
const status = makeFunctionReference<"query", {}, {
  status: string; collections: Array<{ slug: string; pagesDone: number; itemsSeen: number }>;
} | null>("catalogImport:status");
const listPending = makeFunctionReference<"query", {
  paginationOpts: { numItems: number; cursor: string | null };
}, { page: Array<{ id: Id<"catalogObservations">; observedUpc: string; reason: string }> }>("catalogReview:listPending");
const resolve = makeFunctionReference<"mutation", {
  id: Id<"catalogObservations">; decision: "accept" | "reject";
}, "accepted" | "rejected">("catalogReview:resolve");

function product(id: string, upc: string, title = "Galaxian"): CatalogProduct {
  const sourceUrl = `https://www.pricecharting.com/game/atari-5200/item-${id}`;
  return {
    upc, title, platform: "Atari 5200", edition: null, collection: group,
    brand: null, model: null, mpn: null, color: null, storage: null,
    carrier: null, publisher: null, genre: null, rating: null,
    releaseYear: null, attributes: {}, collections: [group],
    sourceUrls: [sourceUrl], listings: [{ sourceUrl }],
  };
}

function page(runId: Id<"catalogImportRuns">, leaseId: string, collectionSlug: string,
  requestToken: string | null, nextToken: string | null, products: CatalogProduct[]) {
  return {
    secret, runId, leaseId, collectionSlug, requestToken, nextToken,
    itemsSeen: products.length, skippedNoUpc: 0, skippedNoTitle: 0, products,
  };
}

function admin(t: ReturnType<typeof convexTest>) {
  return t.withIdentity({
    subject: "admin", tokenIdentifier: "clerk|admin", email: "juanquenga@gmail.com",
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T12:00:00Z"));
  vi.stubEnv("CATALOG_IMPORT_SECRET", secret);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("catalog import", () => {
  test("commits pages atomically, ignores a replay, and resumes an interrupted run", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(begin, {
      secret, leaseId: "one", collections: [group], fullImport: false,
    });
    const firstPage = page(first.runId, "one", group, null, "next", [product("1", "012345678905")]);
    expect(await t.mutation(ingest, firstPage)).toMatchObject({ duplicate: false, inserted: 1 });
    expect(await t.mutation(ingest, firstPage)).toMatchObject({ duplicate: true, inserted: 0 });
    expect(await t.mutation(finish, { secret, runId: first.runId, leaseId: "one" })).toBe("paused");
    expect(await admin(t).query(status, {})).toMatchObject({
      status: "paused", collections: [{ slug: group, pagesDone: 1, itemsSeen: 1 }],
    });

    const resumed = await t.mutation(begin, {
      secret, leaseId: "two", collections: [group], fullImport: false,
    });
    expect(resumed).toMatchObject({ runId: first.runId, resumed: true,
      collections: [{ nextToken: "next", pagesDone: 1 }] });
    await t.mutation(ingest, page(first.runId, "two", group, "next", null, []));
    expect(await t.mutation(finish, { secret, runId: first.runId, leaseId: "two" })).toBe("complete");
  });

  test("holds a possible UPC alias for an administrator to review", async () => {
    const t = convexTest(schema, modules);
    const run = await t.mutation(begin, {
      secret, leaseId: "one", collections: [group], fullImport: false,
    });
    await t.mutation(ingest, page(run.runId, "one", group, null, "next",
      [product("1", "012345678905")]));
    expect(await t.mutation(ingest, page(run.runId, "one", group, "next", null,
      [product("2", "098765432105")]))).toMatchObject({ inserted: 0, reviewCandidates: 1 });
    const pending = await admin(t).query(listPending, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(pending.page).toMatchObject([{
      observedUpc: "098765432105", reason: "possible_upc_alias",
    }]);
    expect(await admin(t).mutation(resolve, {
      id: pending.page[0].id, decision: "accept",
    })).toBe("accepted");
    const accepted = await t.run((ctx) => ctx.db.query("paymoreCatalogProducts")
      .withIndex("by_upc", (q) => q.eq("upc", "098765432105"))
      .first());
    expect(accepted).toMatchObject({ qualityStatus: "reviewed" });
  });

  test("requires review before moving an existing source to a different UPC", async () => {
    const t = convexTest(schema, modules);
    const run = await t.mutation(begin, {
      secret, leaseId: "one", collections: [group], fullImport: false,
    });
    await t.mutation(ingest, page(run.runId, "one", group, null, "next",
      [product("1", "012345678905")]));
    expect(await t.mutation(ingest, page(run.runId, "one", group, "next", null,
      [product("1", "098765432105")]))).toMatchObject({ inserted: 0, reviewCandidates: 1 });

    const before = await t.run((ctx) => ctx.db.query("paymoreCatalogSources")
      .withIndex("by_sourceUrl", (q) => q.eq("sourceUrl", product("1", "012345678905").sourceUrls[0]))
      .unique());
    expect(before).toMatchObject({ upc: "012345678905", active: false });

    const pending = await admin(t).query(listPending, {
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(pending.page).toMatchObject([{
      observedUpc: "098765432105", reason: "source_upc_changed",
    }]);
    await admin(t).mutation(resolve, { id: pending.page[0].id, decision: "accept" });
    const after = await t.run((ctx) => ctx.db.query("paymoreCatalogSources")
      .withIndex("by_sourceUrl", (q) => q.eq("sourceUrl", product("1", "012345678905").sourceUrls[0]))
      .unique());
    expect(after).toMatchObject({ upc: "098765432105", active: true });
  });

  test("deduplicates repeated listing URLs within one product", async () => {
    const t = convexTest(schema, modules);
    const run = await t.mutation(begin, {
      secret, leaseId: "one", collections: [group], fullImport: false,
    });
    const candidate = product("1", "012345678905");
    candidate.listings.push({ ...candidate.listings[0] });
    expect(await t.mutation(ingest, page(run.runId, "one", group, null, null,
      [candidate]))).toMatchObject({ inserted: 1 });
    const sources = await t.run((ctx) => ctx.db.query("paymoreCatalogSources")
      .withIndex("by_sourceUrl", (q) => q.eq("sourceUrl", candidate.sourceUrls[0]))
      .collect());
    expect(sources).toHaveLength(1);
  });

  test("rejects multiple distinct listings in one source observation", async () => {
    const t = convexTest(schema, modules);
    const run = await t.mutation(begin, {
      secret, leaseId: "one", collections: [group], fullImport: false,
    });
    const candidate = product("1", "012345678905");
    candidate.listings.push(product("2", "012345678905").listings[0]);
    await expect(t.mutation(ingest, page(run.runId, "one", group, null, null,
      [candidate]))).rejects.toThrow("one source listing");
  });

  test("normalizes equivalent UPC and EAN codes before checking source changes", async () => {
    const t = convexTest(schema, modules);
    const run = await t.mutation(begin, {
      secret, leaseId: "one", collections: [group], fullImport: false,
    });
    await t.mutation(ingest, page(run.runId, "one", group, null, "next",
      [product("1", "0036000291452")]));
    expect(await t.mutation(ingest, page(run.runId, "one", group, "next", null,
      [product("1", "036000291452")]))).toMatchObject({ reviewCandidates: 0 });
    const source = await t.run((ctx) => ctx.db.query("paymoreCatalogSources")
      .withIndex("by_sourceUrl", (q) => q.eq("sourceUrl", product("1", "036000291452").sourceUrls[0]))
      .unique());
    expect(source).toMatchObject({ upc: "036000291452", active: true });
  });

  test("rejects cursor cycles across committed pages", async () => {
    const t = convexTest(schema, modules);
    const run = await t.mutation(begin, {
      secret, leaseId: "one", collections: [group], fullImport: false,
    });
    await t.mutation(ingest, page(run.runId, "one", group, null, "A", []));
    await t.mutation(ingest, page(run.runId, "one", group, "A", "B", []));
    await expect(t.mutation(ingest, page(run.runId, "one", group, "B", "A", [])))
      .rejects.toThrow("previously seen page cursor");
  });

  test("reports only products actually stored by a batch", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(ingestBatch, {
      secret, products: [product("1", "invalid")], itemsSeen: 1,
      skippedNoUpc: 0, skippedNoTitle: 0, skippedInvalidSource: 0,
    });
    expect(result).toMatchObject({ productsIngested: 0, inserted: 0 });
  });

  test("marks unseen sources inactive only in collections included in a full run", async () => {
    const t = convexTest(schema, modules);
    const otherGroup = "systems";
    const first = await t.mutation(begin, {
      secret, leaseId: "one", collections: [group, otherGroup], fullImport: true,
    });
    await t.mutation(ingest, page(first.runId, "one", group, null, null,
      [product("1", "012345678905")]));
    await t.mutation(ingest, page(first.runId, "one", otherGroup, null, null,
      [product("2", "098765432105", "Console")]));
    await t.mutation(finish, { secret, runId: first.runId, leaseId: "one" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    const second = await t.mutation(begin, {
      secret, leaseId: "two", collections: [group], fullImport: true,
    });
    await t.mutation(ingest, page(second.runId, "two", group, null, null, []));
    await t.mutation(finish, { secret, runId: second.runId, leaseId: "two" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const sources = await t.run((ctx) => ctx.db.query("paymoreCatalogSources").collect());
    expect(sources.find((source) => source.sourceUrl.endsWith("item-1"))?.active).toBe(false);
    expect(sources.find((source) => source.sourceUrl.endsWith("item-2"))?.active).toBe(true);
  });
});
