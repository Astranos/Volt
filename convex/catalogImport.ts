import { v } from "convex/values";

import { observeCatalogProducts } from "./catalog/observations";
import { upsertCatalogProducts } from "./catalog/store";
import { catalogProductValidator } from "./catalog/validators";
import { requireAdmin } from "./admin";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const LEASE_MS = 10 * 60_000;
const MAX_COLLECTIONS = 500;
const MAX_PAGE_ITEMS = 100;
const COLLECTION_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const BATCH_COLLECTION_PREFIX = "batch-";

const progressValidator = v.object({
  slug: v.string(),
  nextToken: v.union(v.string(), v.null()),
  done: v.boolean(),
  pagesDone: v.number(),
  itemsSeen: v.number(),
});

const ingestResultValidator = v.object({
  duplicate: v.boolean(),
  itemsSeen: v.number(),
  productsIngested: v.number(),
  skippedNoUpc: v.number(),
  skippedNoTitle: v.number(),
  inserted: v.number(),
  updated: v.number(),
  sourcesAdded: v.number(),
  reviewCandidates: v.number(),
});

function requireImportSecret(secret: string): void {
  const configured = process.env.CATALOG_IMPORT_SECRET;
  if (!configured || secret !== configured) throw new Error("Invalid import secret");
}

function requireLease(run: Doc<"catalogImportRuns"> | null, leaseId: string, now: number): asserts run is Doc<"catalogImportRuns"> {
  if (!run || run.status !== "running" || run.leaseId !== leaseId || run.leaseExpiresAt <= now) {
    throw new Error("Import lease is no longer active");
  }
}

async function loadProgress(ctx: MutationCtx | QueryCtx, runId: Id<"catalogImportRuns">) {
  const rows = await ctx.db.query("catalogImportProgress")
    .withIndex("by_runId_and_slug", (q) => q.eq("runId", runId))
    .take(MAX_COLLECTIONS + 1);
  if (rows.length > MAX_COLLECTIONS) throw new Error("Import has too many collections");
  return rows.map(({ slug, nextToken, done, pagesDone, itemsSeen }) => ({
    slug, nextToken, done, pagesDone, itemsSeen,
  }));
}

export const status = query({
  args: {},
  returns: v.union(v.object({
    runId: v.id("catalogImportRuns"),
    status: v.union(v.literal("running"), v.literal("paused"), v.literal("complete")),
    fullImport: v.boolean(),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.union(v.number(), v.null()),
    leaseExpiresAt: v.number(),
    collections: v.array(progressValidator),
  }), v.null()),
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const run = await ctx.db.query("catalogImportRuns")
      .withIndex("by_startedAt")
      .order("desc")
      .first();
    if (!run) return null;
    return {
      runId: run._id,
      status: run.status,
      fullImport: run.fullImport,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      completedAt: run.completedAt ?? null,
      leaseExpiresAt: run.leaseExpiresAt,
      collections: await loadProgress(ctx, run._id),
    };
  },
});

export const beginRun = mutation({
  args: {
    secret: v.string(),
    leaseId: v.string(),
    collections: v.array(v.string()),
    fullImport: v.boolean(),
  },
  returns: v.object({
    runId: v.id("catalogImportRuns"),
    resumed: v.boolean(),
    collections: v.array(progressValidator),
  }),
  handler: async (ctx, args) => {
    requireImportSecret(args.secret);
    if (!args.leaseId || args.leaseId.length > 100) throw new Error("Invalid import lease ID");
    const slugs = [...new Set(args.collections)];
    if (slugs.length === 0 || slugs.length > MAX_COLLECTIONS || slugs.some((slug) =>
      !COLLECTION_SLUG.test(slug) || slug.startsWith(BATCH_COLLECTION_PREFIX))) {
      throw new Error("Invalid import collections");
    }

    const now = Date.now();
    const control = await ctx.db.query("catalogImportControl")
      .withIndex("by_name", (q) => q.eq("name", "catalog"))
      .unique();
    const previous = control?.runId ? await ctx.db.get(control.runId) : null;
    if (previous && previous.status !== "complete") {
      if (previous.status === "running" && previous.leaseExpiresAt > now) {
        throw new Error("Another catalog import is still running");
      }
      const progress = await loadProgress(ctx, previous._id);
      const storedSlugs = new Set(progress.map((row) => row.slug));
      if (previous.fullImport !== args.fullImport || storedSlugs.size !== slugs.length
        || slugs.some((slug) => !storedSlugs.has(slug))) {
        throw new Error("Unfinished import has different collections or mode");
      }
      await ctx.db.patch(previous._id, {
        status: "running", leaseId: args.leaseId, leaseExpiresAt: now + LEASE_MS, updatedAt: now,
      });
      return { runId: previous._id, resumed: true, collections: progress };
    }

    const runId = await ctx.db.insert("catalogImportRuns", {
      status: "running", fullImport: args.fullImport,
      leaseId: args.leaseId, leaseExpiresAt: now + LEASE_MS,
      startedAt: now, updatedAt: now,
    });
    if (control) await ctx.db.patch(control._id, { runId });
    else await ctx.db.insert("catalogImportControl", { name: "catalog", runId });
    for (const slug of slugs) {
      await ctx.db.insert("catalogImportProgress", {
        runId, slug, nextToken: null, lastRequestToken: null, lastNextToken: null,
        done: false, pagesDone: 0, itemsSeen: 0, updatedAt: now,
      });
    }
    return {
      runId, resumed: false,
      collections: slugs.map((slug) => ({ slug, nextToken: null, done: false, pagesDone: 0, itemsSeen: 0 })),
    };
  },
});

export const ingestPage = mutation({
  args: {
    secret: v.string(),
    runId: v.id("catalogImportRuns"),
    leaseId: v.string(),
    collectionSlug: v.string(),
    requestToken: v.union(v.string(), v.null()),
    nextToken: v.union(v.string(), v.null()),
    itemsSeen: v.number(),
    skippedNoUpc: v.number(),
    skippedNoTitle: v.number(),
    products: v.array(catalogProductValidator),
  },
  returns: ingestResultValidator,
  handler: async (ctx, args) => {
    requireImportSecret(args.secret);
    if (!Number.isInteger(args.itemsSeen) || args.itemsSeen < 0 || args.itemsSeen > MAX_PAGE_ITEMS
      || !Number.isInteger(args.skippedNoUpc) || args.skippedNoUpc < 0
      || !Number.isInteger(args.skippedNoTitle) || args.skippedNoTitle < 0
      || args.products.length + args.skippedNoUpc + args.skippedNoTitle > args.itemsSeen) {
      throw new Error("Invalid import page counts");
    }
    if (args.nextToken !== null && args.nextToken === args.requestToken) {
      throw new Error("Source returned a repeated page cursor");
    }
    if ((args.requestToken !== null && args.requestToken.length > 2_000)
      || (args.nextToken !== null && (args.nextToken.length === 0 || args.nextToken.length > 2_000))) {
      throw new Error("Invalid page cursor");
    }
    const now = Date.now();
    const run = await ctx.db.get(args.runId);
    requireLease(run, args.leaseId, now);
    const progress = await ctx.db.query("catalogImportProgress")
      .withIndex("by_runId_and_slug", (q) => q.eq("runId", args.runId).eq("slug", args.collectionSlug))
      .unique();
    if (!progress) throw new Error("Collection is not part of this import");
    if (progress.pagesDone > 0 && progress.lastRequestToken === args.requestToken
      && progress.lastNextToken === args.nextToken) {
      return {
        duplicate: true, itemsSeen: 0, productsIngested: 0, skippedNoUpc: 0,
        skippedNoTitle: 0, inserted: 0, updated: 0, sourcesAdded: 0,
        reviewCandidates: 0,
      };
    }
    if (progress.done || progress.nextToken !== args.requestToken) {
      throw new Error("Page cursor does not match import progress");
    }
    if (args.nextToken !== null) {
      const seen = await ctx.db.query("catalogImportCursors")
        .withIndex("by_runId_and_slug_and_token", (q) =>
          q.eq("runId", args.runId).eq("slug", args.collectionSlug).eq("token", args.nextToken!))
        .unique();
      if (seen) throw new Error("Source returned a previously seen page cursor");
      await ctx.db.insert("catalogImportCursors", {
        runId: args.runId, slug: args.collectionSlug, token: args.nextToken,
      });
    }

    const observed = await observeCatalogProducts(
      ctx, args.products, args.runId, args.collectionSlug, now,
    );
    const stats = await upsertCatalogProducts(ctx, observed.accepted, now);
    if (stats.productsIngested !== observed.accepted.length) {
      throw new Error("Import page contains a conflicting source claim");
    }
    await ctx.db.patch(progress._id, {
      nextToken: args.nextToken,
      lastRequestToken: args.requestToken,
      lastNextToken: args.nextToken,
      done: args.nextToken === null,
      pagesDone: progress.pagesDone + 1,
      itemsSeen: progress.itemsSeen + args.itemsSeen,
      updatedAt: now,
    });
    if (run.leaseExpiresAt - now < 2 * 60_000) {
      await ctx.db.patch(run._id, { leaseExpiresAt: now + LEASE_MS, updatedAt: now });
    }
    return {
      duplicate: false,
      itemsSeen: args.itemsSeen,
      productsIngested: stats.productsIngested,
      skippedNoUpc: args.skippedNoUpc,
      skippedNoTitle: args.skippedNoTitle,
      inserted: stats.inserted,
      updated: stats.updated,
      sourcesAdded: stats.sourcesAdded,
      reviewCandidates: observed.reviewCandidates,
    };
  },
});

export const ingestBatch = mutation({
  args: {
    secret: v.string(),
    collectionSlug: v.string(),
    products: v.array(catalogProductValidator),
    itemsSeen: v.number(),
    skippedNoUpc: v.number(),
    skippedNoTitle: v.number(),
    skippedInvalidSource: v.number(),
  },
  returns: v.object({
    itemsSeen: v.number(),
    productsIngested: v.number(),
    skippedNoUpc: v.number(),
    skippedNoTitle: v.number(),
    skippedInvalidSource: v.number(),
    inserted: v.number(),
    updated: v.number(),
    sourcesAdded: v.number(),
    reviewCandidates: v.number(),
  }),
  handler: async (ctx, args) => {
    requireImportSecret(args.secret);
    const counts = [args.itemsSeen, args.skippedNoUpc, args.skippedNoTitle, args.skippedInvalidSource];
    if (counts.some((count) => !Number.isInteger(count) || count < 0)
      || args.itemsSeen > MAX_PAGE_ITEMS
      || args.products.length + args.skippedNoUpc + args.skippedNoTitle + args.skippedInvalidSource > args.itemsSeen) {
      throw new Error("Invalid import batch counts");
    }
    if (!COLLECTION_SLUG.test(args.collectionSlug)) throw new Error("Invalid import collection");
    const now = Date.now();
    const observed = await observeCatalogProducts(
      ctx, args.products, undefined, BATCH_COLLECTION_PREFIX + args.collectionSlug, now,
    );
    const stats = await upsertCatalogProducts(ctx, observed.accepted, now);
    if (stats.productsIngested !== observed.accepted.length) {
      throw new Error("Import batch contains a conflicting source claim");
    }
    return {
      itemsSeen: args.itemsSeen,
      skippedNoUpc: args.skippedNoUpc,
      skippedNoTitle: args.skippedNoTitle,
      skippedInvalidSource: args.skippedInvalidSource,
      ...stats,
      reviewCandidates: observed.reviewCandidates,
    };
  },
});

export const finishRun = mutation({
  args: { secret: v.string(), runId: v.id("catalogImportRuns"), leaseId: v.string() },
  returns: v.union(v.literal("paused"), v.literal("complete")),
  handler: async (ctx, args) => {
    requireImportSecret(args.secret);
    const now = Date.now();
    const run = await ctx.db.get(args.runId);
    requireLease(run, args.leaseId, now);
    const unfinished = await ctx.db.query("catalogImportProgress")
      .withIndex("by_runId_and_done", (q) => q.eq("runId", args.runId).eq("done", false))
      .first();
    const status = unfinished ? "paused" : "complete";
    await ctx.db.patch(run._id, {
      status, leaseExpiresAt: now, updatedAt: now,
      ...(status === "complete" ? { completedAt: now } : {}),
    });
    if (status === "complete") {
      await ctx.scheduler.runAfter(0, internal.catalogImport.clearImportCursors, {
        runId: args.runId,
      });
      const control = await ctx.db.query("catalogImportControl")
        .withIndex("by_name", (q) => q.eq("name", "catalog"))
        .unique();
      if (control?.runId === args.runId) await ctx.db.patch(control._id, { runId: undefined });
      if (run.fullImport) {
        const firstCollection = await ctx.db.query("catalogImportProgress")
          .withIndex("by_runId_and_slug", (q) => q.eq("runId", args.runId))
          .first();
        if (firstCollection) {
          await ctx.scheduler.runAfter(0, internal.catalogImport.sweepStaleObservations, {
            runId: args.runId, collectionSlug: firstCollection.slug,
          });
        }
      }
    }
    return status;
  },
});

export const clearImportCursors = internalMutation({
  args: { runId: v.id("catalogImportRuns") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "complete") return 0;
    const cursors = await ctx.db.query("catalogImportCursors")
      .withIndex("by_runId_and_slug_and_token", (q) => q.eq("runId", args.runId))
      .take(100);
    for (const cursor of cursors) await ctx.db.delete(cursor._id);
    if (cursors.length === 100) {
      await ctx.scheduler.runAfter(0, internal.catalogImport.clearImportCursors, args);
    }
    return cursors.length;
  },
});

export const sweepStaleObservations = internalMutation({
  args: { runId: v.id("catalogImportRuns"), collectionSlug: v.string() },
  returns: v.object({ deactivated: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.status !== "complete" || !run.fullImport) {
      return { deactivated: 0, done: true };
    }
    const stale = await ctx.db.query("catalogObservations")
      .withIndex("by_collectionSlug_and_active_and_lastSeenAt", (q) =>
        q.eq("collectionSlug", args.collectionSlug).eq("active", true)
          .lt("lastSeenAt", run.startedAt))
      .take(100);
    for (const observation of stale) {
      await ctx.db.patch(observation._id, { active: false });
      const source = await ctx.db.query("paymoreCatalogSources")
        .withIndex("by_sourceUrl", (q) => q.eq("sourceUrl", observation.sourceUrl))
        .unique();
      if (source) await ctx.db.patch(source._id, { active: false });
    }
    let done = false;
    if (stale.length === 100) {
      await ctx.scheduler.runAfter(0, internal.catalogImport.sweepStaleObservations, args);
    } else {
      const nextCollection = await ctx.db.query("catalogImportProgress")
        .withIndex("by_runId_and_slug", (q) =>
          q.eq("runId", args.runId).gt("slug", args.collectionSlug))
        .first();
      if (nextCollection) {
        await ctx.scheduler.runAfter(0, internal.catalogImport.sweepStaleObservations, {
          runId: args.runId, collectionSlug: nextCollection.slug,
        });
      } else done = true;
    }
    return { deactivated: stale.length, done };
  },
});
