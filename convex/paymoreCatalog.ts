import { v } from "convex/values";

import { normalizeUPCA } from "./aiScanner";
import { crawlSavedPages } from "./catalog/crawl";
import { loadCatalogProductByUpc, upsertCatalogProducts } from "./catalog/store";
import {
  catalogProductValidator,
  rejectedListingValidator,
  storedCatalogProductValidator,
  upsertStatsValidator,
} from "./catalog/validators";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

const ingestResultValidator = v.object({
  products: v.array(catalogProductValidator),
  rejected: v.array(rejectedListingValidator),
  fetched: v.number(),
  inserted: v.number(),
  updated: v.number(),
  sourcesAdded: v.number(),
});

export const ingestPages = internalMutation({
  args: {
    pages: v.array(v.object({
      sourceUrl: v.string(),
      body: v.string(),
    })),
    now: v.optional(v.number()),
  },
  returns: ingestResultValidator,
  handler: async (ctx, args) => {
    const crawled = crawlSavedPages(args.pages);
    const stats = await upsertCatalogProducts(ctx, crawled.products, args.now ?? Date.now());
    return { ...crawled, ...stats };
  },
});

export const upsertProducts = internalMutation({
  args: {
    products: v.array(catalogProductValidator),
    now: v.optional(v.number()),
  },
  returns: upsertStatsValidator,
  handler: async (ctx, args) => {
    return await upsertCatalogProducts(ctx, args.products, args.now ?? Date.now());
  },
});

export const getByUpcInternal = internalQuery({
  args: { upc: v.string() },
  returns: v.union(storedCatalogProductValidator, v.null()),
  handler: async (ctx, args) => {
    const upc = normalizeUPCA(args.upc);
    if (!upc) return null;
    return await loadCatalogProductByUpc(ctx, upc);
  },
});

// One-time migration: strips legacy per-listing facts (price, quantity,
// store name, condition, listingAttributes) from every paymoreCatalogSources
// row so a source row is pure provenance (product, UPC, source URL, photo,
// timestamps). The schema still lists those fields until phase 2 removes all
// five from the schema once this migration has run.
export const stripSourceListingFacts = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    processed: v.number(),
    stripped: v.number(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("paymoreCatalogSources")
      .paginate({ numItems: 500, cursor: args.cursor ?? null });

    let stripped = 0;
    for (const source of page.page) {
      if (
        !("price" in source) &&
        !("quantity" in source) &&
        !("storeName" in source) &&
        !("condition" in source) &&
        !("listingAttributes" in source)
      ) {
        continue;
      }
      // The schema still marks condition/listingAttributes as required until
      // phase 2, so the stripped payload does not typecheck as a full row;
      // the assertion bridges that gap and goes away with the schema change.
      await ctx.db.replace(
        source._id,
        ({
          productId: source.productId,
          upc: source.upc,
          sourceUrl: source.sourceUrl,
          createdAt: source.createdAt,
          ...(source.imageUrl !== undefined ? { imageUrl: source.imageUrl } : {}),
          ...(source.updatedAt !== undefined ? { updatedAt: source.updatedAt } : {}),
        }) as Doc<"paymoreCatalogSources">,
      );
      stripped += 1;
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.paymoreCatalog.stripSourceListingFacts, {
        cursor: page.continueCursor,
      });
    }

    return { processed: page.page.length, stripped, isDone: page.isDone };
  },
});
