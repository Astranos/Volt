import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import {
  catalogIdentityMatchScore,
  normalizeUPCA,
  type AIScannerCatalogMatch,
  type ProductIdentity,
} from "./aiScanner";
import { loadCatalogProductByUpc } from "./catalog/store";
import {
  catalogSummaryValidator,
  storedCatalogProductValidator,
} from "./catalog/validators";
import type { Doc } from "./_generated/dataModel";
import {
  internalQuery,
  query,
  type QueryCtx,
} from "./_generated/server";

const searchProductsResultValidator = v.object({
  page: v.array(catalogSummaryValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

const aiScannerCatalogMatchValidator = v.object({
  upc: v.string(),
  title: v.string(),
  platform: v.union(v.string(), v.null()),
  edition: v.union(v.string(), v.null()),
  brand: v.union(v.string(), v.null()),
  model: v.union(v.string(), v.null()),
  mpn: v.union(v.string(), v.null()),
  color: v.union(v.string(), v.null()),
  storage: v.union(v.string(), v.null()),
  carrier: v.union(v.string(), v.null()),
});

type SearchProductsArgs = {
  searchQuery?: string;
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
};

function productSummary(product: Doc<"paymoreCatalogProducts">) {
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

async function loadProductsByMpnPrefix(ctx: QueryCtx, raw: string) {
  const variants = Array.from(new Set([raw, raw.toUpperCase()]));
  const byUpc = new Map<string, ReturnType<typeof productSummary>>();
  for (const prefix of variants) {
    const rows = await ctx.db
      .query("paymoreCatalogProducts")
      .withIndex("by_mpn", (q) => q.gte("mpn", prefix).lt("mpn", `${prefix}\uffff`))
      .take(25);
    for (const row of rows) {
      if (!byUpc.has(row.upc)) byUpc.set(row.upc, productSummary(row));
    }
    if (byUpc.size >= 25) break;
  }
  return Array.from(byUpc.values()).slice(0, 25);
}

async function searchProductsFromCatalog(ctx: QueryCtx, args: SearchProductsArgs) {
  const raw = args.searchQuery?.trim() ?? "";
  const digits = raw.replace(/\D/g, "");
  const codeLike = /^[A-Za-z0-9][A-Za-z0-9/.-]{2,}$/.test(raw) && /\d/.test(raw);
  // Server-owned page bound: paginationOptsValidator only checks the type, so
  // a caller could otherwise request unbounded pages of the catalog.
  const requested = args.paginationOpts.numItems;
  const numItems = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), 100)
    : 25;
  const paginationOpts = { ...args.paginationOpts, numItems };

  if (digits.length >= 6) {
    const upc = normalizeUPCA(digits);
    if (upc) {
      const product = await loadCatalogProductByUpc(ctx, upc);
      if (product) {
        return {
          page: [{
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
          }],
          isDone: true,
          continueCursor: "",
        };
      }
    }
  } else if (codeLike) {
    const matches = await loadProductsByMpnPrefix(ctx, raw);
    if (matches.length > 0) {
      return { page: matches, isDone: true, continueCursor: "" };
    }
  }

  const tokens = raw.split(/\s+/).filter((token) => token.length > 0);
  const results = tokens.length === 0
    ? await ctx.db
        .query("paymoreCatalogProducts")
        .withIndex("by_title")
        .order("asc")
        .paginate(paginationOpts)
    : await ctx.db
        .query("paymoreCatalogProducts")
        .withSearchIndex("search_title", (q) => q.search("title", tokens.join(" ")))
        .paginate(paginationOpts);

  return {
    page: results.page.map(productSummary),
    isDone: results.isDone,
    continueCursor: results.continueCursor,
  };
}

async function getProductFromCatalog(ctx: QueryCtx, upcInput: string) {
  const upc = normalizeUPCA(upcInput);
  if (!upc) return null;
  return await loadCatalogProductByUpc(ctx, upc);
}

function aiScannerCatalogMatch(product: Doc<"paymoreCatalogProducts">): AIScannerCatalogMatch {
  return {
    upc: product.upc,
    title: product.title,
    platform: product.platform,
    edition: product.edition,
    brand: product.brand,
    model: product.model,
    mpn: product.mpn,
    color: product.color,
    storage: product.storage,
    carrier: product.carrier,
  };
}

async function findProductForAIIdentity(ctx: QueryCtx, identity: ProductIdentity) {
  const exactTitleCandidates = await ctx.db
    .query("paymoreCatalogProducts")
    .withIndex("by_title", (q) => q.eq("title", identity.name))
    .take(25);
  const searchCandidates = await ctx.db
    .query("paymoreCatalogProducts")
    .withSearchIndex("search_title", (q) => q.search("title", identity.name))
    .take(25);
  const candidatesById = new Map<Doc<"paymoreCatalogProducts">["_id"], Doc<"paymoreCatalogProducts">>();
  for (const product of [...exactTitleCandidates, ...searchCandidates]) {
    candidatesById.set(product._id, product);
  }
  const supplementalSearches = Array.from(new Set([
    identity.model,
    [identity.brand, identity.model].filter(Boolean).join(" ") || null,
  ].filter((value): value is string => Boolean(value) && value !== identity.name)));
  for (const searchText of supplementalSearches) {
    const matches = await ctx.db
      .query("paymoreCatalogProducts")
      .withSearchIndex("search_title", (q) => q.search("title", searchText))
      .take(25);
    for (const product of matches) candidatesById.set(product._id, product);
  }
  if (identity.mpn) {
    for (const mpn of new Set([identity.mpn, identity.mpn.toUpperCase()])) {
      const matches = await ctx.db
        .query("paymoreCatalogProducts")
        .withIndex("by_mpn", (q) => q.eq("mpn", mpn))
        .take(25);
      for (const product of matches) candidatesById.set(product._id, product);
    }
  }
  const candidates = [...candidatesById.values()];
  const scored = candidates.flatMap((product) => {
    const score = catalogIdentityMatchScore(identity, product);
    return score === null ? [] : [{ product, score }];
  }).sort((left, right) => right.score - left.score || right.product.updatedAt - left.product.updatedAt);
  const best = scored[0];
  if (!best) return null;
  const runnerUp = scored[1];
  if (runnerUp && best.score - runnerUp.score < 8 && runnerUp.product.upc !== best.product.upc) return null;
  return aiScannerCatalogMatch(best.product);
}

export const searchProducts = query({
  args: {
    searchQuery: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: searchProductsResultValidator,
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return await searchProductsFromCatalog(ctx, args);
  },
});

export const getProductByUpc = query({
  args: { upc: v.string() },
  returns: v.union(storedCatalogProductValidator, v.null()),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return await getProductFromCatalog(ctx, args.upc);
  },
});

export const searchProductsForApi = internalQuery({
  args: {
    searchQuery: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: searchProductsResultValidator,
  handler: async (ctx, args) => {
    return await searchProductsFromCatalog(ctx, args);
  },
});

export const getProductByUpcForApi = internalQuery({
  args: { upc: v.string() },
  returns: v.union(storedCatalogProductValidator, v.null()),
  handler: async (ctx, args) => {
    return await getProductFromCatalog(ctx, args.upc);
  },
});

export const findProductForAIScanner = internalQuery({
  args: {
    name: v.string(),
    platform: v.union(v.string(), v.null()),
    edition: v.union(v.string(), v.null()),
    region: v.union(v.string(), v.null()),
    brand: v.union(v.string(), v.null()),
    model: v.union(v.string(), v.null()),
    mpn: v.union(v.string(), v.null()),
    color: v.union(v.string(), v.null()),
    storage: v.union(v.string(), v.null()),
    carrier: v.union(v.string(), v.null()),
  },
  returns: v.union(aiScannerCatalogMatchValidator, v.null()),
  handler: async (ctx, args) => {
    return await findProductForAIIdentity(ctx, args);
  },
});
