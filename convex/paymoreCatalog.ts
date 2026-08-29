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
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

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

export const getByUpc = query({
  args: { upc: v.string() },
  returns: v.union(storedCatalogProductValidator, v.null()),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const upc = normalizeUPCA(args.upc);
    if (!upc) return null;
    return await loadCatalogProductByUpc(ctx, upc);
  },
});

export const ingestExtractedProducts = mutation({
  args: {
    products: v.array(catalogProductValidator),
  },
  returns: upsertStatsValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return await upsertCatalogProducts(ctx, args.products, Date.now());
  },
});
