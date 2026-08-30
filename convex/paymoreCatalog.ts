import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { normalizeUPCA } from "./aiScanner";
import { crawlSavedPages } from "./catalog/crawl";
import { loadCatalogProductByUpc, upsertCatalogProducts } from "./catalog/store";
import {
  catalogProductValidator,
  catalogSummaryValidator,
  rejectedListingValidator,
  storedCatalogProductValidator,
  upsertStatsValidator,
} from "./catalog/validators";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";

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

export const searchCatalog = query({
  args: {
    searchQuery: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(catalogSummaryValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const raw = args.searchQuery?.trim() ?? "";
    const digits = raw.replace(/\D/g, "");
    // MPNs are single code-like tokens that usually contain a digit
    // (e.g. MG494LL/A). Word searches go straight to title search.
    const codeLike = /^[A-Za-z0-9][A-Za-z0-9/.-]{2,}$/.test(raw) && /\d/.test(raw);

    if (digits.length >= 6) {
      const upc = normalizeUPCA(digits);
      if (upc) {
        // Alias-aware: resolves the canonical product even when the query
        // names a non-canonical UPC carried by one of its source rows.
        const product = await loadCatalogProductByUpc(ctx, upc);
        if (product) {
          return {
            page: [catalogSummary(product)],
            isDone: true,
            // Matching the real PaginationResult shape keeps this query
            // usable with usePaginatedQuery; the cursor is never sent back
            // because isDone is true.
            continueCursor: "",
          };
        }
      }
    } else if (codeLike) {
      const matches = await loadCatalogProductsByMpnPrefix(ctx, raw);
      if (matches.length > 0) {
        return { page: matches, isDone: true, continueCursor: "" };
      }
    }
    // Fall through: a code-like query can still match a title
    // (e.g. "iPhone 15"), so only the lookups above short-circuit.

    const tokens = raw.split(/\s+/).filter((token) => token.length > 0);
    const results =
      tokens.length === 0
        ? await ctx.db
            .query("paymoreCatalogProducts")
            .withIndex("by_title")
            .order("asc")
            .paginate(args.paginationOpts)
        : await ctx.db
            .query("paymoreCatalogProducts")
            .withSearchIndex("search_title", (q) => q.search("title", tokens.join(" ")))
            .paginate(args.paginationOpts);

    return {
      page: results.page.map(catalogSummary),
      isDone: results.isDone,
      continueCursor: results.continueCursor,
    };
  },
});

async function loadCatalogProductsByMpnPrefix(ctx: QueryCtx, raw: string) {
  // Case-insensitive prefix match: try the query as typed plus uppercase,
  // since stored MPNs are usually uppercase (MG494LL/A).
  const variants = Array.from(new Set([raw, raw.toUpperCase()]));
  const byUpc = new Map<string, ReturnType<typeof catalogSummary>>();
  for (const prefix of variants) {
    const rows = await ctx.db
      .query("paymoreCatalogProducts")
      .withIndex("by_mpn", (q) => q.gte("mpn", prefix).lt("mpn", prefix + "\uffff"))
      .take(25);
    for (const row of rows) {
      if (!byUpc.has(row.upc)) byUpc.set(row.upc, catalogSummary(row));
    }
    if (byUpc.size >= 25) break;
  }
  return Array.from(byUpc.values());
}

function catalogSummary(product: {
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
}) {
  return {
    upc: product.upc,
    title: product.title,
    platform: product.platform,
    edition: product.edition,
    mpn: product.mpn,
    brand: product.brand,
    model: product.model,
    color: product.color,
    storage: product.storage,
    carrier: product.carrier,
    updatedAt: product.updatedAt,
  };
}

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
