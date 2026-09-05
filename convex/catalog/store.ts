import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeUPCA } from "../aiScanner";
import { mergeProductFields } from "./dedupe";
import { isAuthorizedCatalogProductUrl } from "./hosts";
import { recordCatalogActivity } from "./activity";
import type { CatalogListing, CatalogProduct } from "./types";

export type UpsertStats = {
  inserted: number;
  updated: number;
  sourcesAdded: number;
};

type CatalogProductFields = Omit<CatalogProduct, "sourceUrls" | "listings">;

function productFields(product: CatalogProduct, upc: string, title: string): CatalogProductFields {
  return {
    upc,
    title,
    platform: product.platform,
    edition: product.edition,
    collection: product.collection,
    brand: product.brand,
    model: product.model,
    mpn: product.mpn,
    color: product.color,
    storage: product.storage,
    carrier: product.carrier,
    publisher: product.publisher,
    genre: product.genre,
    rating: product.rating,
    releaseYear: product.releaseYear,
    attributes: product.attributes,
    collections: product.collections,
  };
}

// A known sourceUrl carrying a different UPC is a UPC correction, not a
// multi-UPC alias: the legacy insert/repoint/orphan-delete path owns it.
async function findSourceWithDifferentUpc(
  ctx: MutationCtx,
  listings: CatalogListing[],
  upc: string,
) {
  for (const listing of listings) {
    const existingSource = await ctx.db
      .query("paymoreCatalogSources")
      .withIndex("by_sourceUrl", (q) => q.eq("sourceUrl", listing.sourceUrl))
      .unique();
    if (existingSource && existingSource.upc !== upc) return existingSource;
  }
  return null;
}

async function findProductByMpn(
  ctx: MutationCtx,
  mpn: string,
  platform: string | null,
): Promise<Doc<"paymoreCatalogProducts"> | null> {
  const candidates = await ctx.db
    .query("paymoreCatalogProducts")
    .withIndex("by_mpn", (q) => q.eq("mpn", mpn))
    .take(25);
  return candidates.find((row) => (row.platform ?? null) === (platform ?? null)) ?? null;
}

async function findProductByTitle(
  ctx: MutationCtx,
  title: string,
  platform: string | null,
): Promise<Doc<"paymoreCatalogProducts"> | null> {
  const candidates = await ctx.db
    .query("paymoreCatalogProducts")
    .withIndex("by_title", (q) => q.eq("title", title))
    .take(25);
  return candidates.find((row) => (row.platform ?? null) === (platform ?? null)) ?? null;
}

async function patchProductFields(
  ctx: MutationCtx,
  productId: Id<"paymoreCatalogProducts">,
  merged: CatalogProductFields,
  now: number,
) {
  await ctx.db.patch(productId, {
    title: merged.title,
    platform: merged.platform,
    edition: merged.edition,
    collection: merged.collection,
    brand: merged.brand,
    model: merged.model,
    mpn: merged.mpn,
    color: merged.color,
    storage: merged.storage,
    carrier: merged.carrier,
    publisher: merged.publisher,
    genre: merged.genre,
    rating: merged.rating,
    releaseYear: merged.releaseYear,
    attributes: merged.attributes,
    collections: merged.collections,
    updatedAt: now,
  });
}

// The canonical UPC is the most-used one across the product's source rows.
// Ties keep the existing UPC: it is replaced only when a different UPC
// strictly exceeds its usage.
async function reconcileCanonicalUpc(
  ctx: MutationCtx,
  productId: Id<"paymoreCatalogProducts">,
  currentUpc: string,
) {
  const sources = await ctx.db
    .query("paymoreCatalogSources")
    .withIndex("by_productId", (q) => q.eq("productId", productId))
    .collect();
  if (sources.length === 0) return;
  const usage = new Map<string, number>();
  for (const source of sources) {
    usage.set(source.upc, (usage.get(source.upc) ?? 0) + 1);
  }
  let winnerUpc: string | null = null;
  let winnerUsage = usage.get(currentUpc) ?? 0;
  for (const upc of [...usage.keys()].sort()) {
    const count = usage.get(upc) ?? 0;
    if (upc !== currentUpc && count > winnerUsage) {
      winnerUpc = upc;
      winnerUsage = count;
    }
  }
  if (winnerUpc) await ctx.db.patch(productId, { upc: winnerUpc });
}

// UPCs across the product's source rows, deduped, ranked by usage count
// descending; the canonical UPC wins ties.
function rankUpcs(sources: Array<{ upc: string }>, canonicalUpc: string): string[] {
  const usage = new Map<string, number>();
  for (const source of sources) {
    usage.set(source.upc, (usage.get(source.upc) ?? 0) + 1);
  }
  return [...usage.keys()].sort((a, b) => {
    const byUsage = (usage.get(b) ?? 0) - (usage.get(a) ?? 0);
    if (byUsage !== 0) return byUsage;
    if (a === canonicalUpc) return -1;
    if (b === canonicalUpc) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export async function upsertCatalogProducts(
  ctx: MutationCtx,
  products: CatalogProduct[],
  now: number,
): Promise<UpsertStats> {
  let inserted = 0;
  let updated = 0;
  let sourcesAdded = 0;

  for (const product of products) {
    const upc = normalizeUPCA(product.upc);
    const title = product.title.trim();
    const listings = product.listings.filter((listing) => isAuthorizedCatalogProductUrl(listing.sourceUrl));
    if (!upc || !title || listings.length === 0) continue;

    const fields = productFields(product, upc, title);
    const existing = await ctx.db
      .query("paymoreCatalogProducts")
      .withIndex("by_upc", (q) => q.eq("upc", upc))
      .unique();

    // Identity resolution order: exact UPC match, then (for genuinely new
    // source URLs) the same MPN + platform, then the same title + platform.
    // A known sourceUrl with a different UPC keeps the legacy correction
    // path below instead of merging by MPN/title.
    const correctingSource = existing ? null : await findSourceWithDifferentUpc(ctx, listings, upc);

    let productId = existing?._id ?? null;
    // Preserve the stored canonical UPC when a new source merges into an
    // existing product. The incoming UPC is an alias until its source usage
    // strictly exceeds the current canonical UPC's usage.
    let canonicalUpc = existing?.upc ?? upc;
    if (existing) {
      const merged = mergeProductFields(existing, fields);
      await patchProductFields(ctx, existing._id, merged, now);
      updated += 1;
    } else if (!correctingSource) {
      const matched =
        (fields.mpn ? await findProductByMpn(ctx, fields.mpn, fields.platform) : null) ??
        (await findProductByTitle(ctx, title, fields.platform));
      if (matched) {
        const merged = mergeProductFields(matched, fields);
        await patchProductFields(ctx, matched._id, merged, now);
        updated += 1;
        productId = matched._id;
        canonicalUpc = matched.upc;
      }
    }

    if (!productId) {
      productId = await ctx.db.insert("paymoreCatalogProducts", {
        ...fields,
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }

    for (const listing of listings) {
      const existingSource = await ctx.db
        .query("paymoreCatalogSources")
        .withIndex("by_sourceUrl", (q) => q.eq("sourceUrl", listing.sourceUrl))
        .unique();
      if (existingSource) {
        // A corrected UPC on re-crawl must move the source row to the new
        // product; only delete its old product when this is that product's
        // last source row, so differently-UPC'd sources are not orphaned.
        if (existingSource.upc !== upc) {
          const remaining = await ctx.db
            .query("paymoreCatalogSources")
            .withIndex("by_productId", (q) => q.eq("productId", existingSource.productId))
            .collect();
          if (remaining.length === 1) await ctx.db.delete(existingSource.productId);
        }
        await ctx.db.patch(existingSource._id, {
          productId: productId!,
          upc,
          updatedAt: now,
          ...(listing.imageUrl !== undefined ? { imageUrl: listing.imageUrl } : {}),
        });
        continue;
      }
      await ctx.db.insert("paymoreCatalogSources", {
        productId: productId!,
        upc,
        sourceUrl: listing.sourceUrl,
        createdAt: now,
        updatedAt: now,
        ...(listing.imageUrl !== undefined ? { imageUrl: listing.imageUrl } : {}),
      });
      sourcesAdded += 1;
    }

    await reconcileCanonicalUpc(ctx, productId!, canonicalUpc);
  }

  const stats = { inserted, updated, sourcesAdded };
  await recordCatalogActivity(ctx, stats, now);
  return stats;
}

export async function loadCatalogProductByUpc(ctx: QueryCtx, upc: string) {
  let product: Doc<"paymoreCatalogProducts"> | null = await ctx.db
    .query("paymoreCatalogProducts")
    .withIndex("by_upc", (q) => q.eq("upc", upc))
    .unique();
  if (!product) {
    // Alias UPCs live on the source rows rather than the product row, so a
    // miss on by_upc falls back to whichever product claims the UPC.
    const source = await ctx.db
      .query("paymoreCatalogSources")
      .withIndex("by_upc", (q) => q.eq("upc", upc))
      .first();
    if (source) product = (await ctx.db.get(source.productId)) ?? null;
  }
  if (!product) return null;

  const canonical = product;
  const sources = await ctx.db
    .query("paymoreCatalogSources")
    .withIndex("by_productId", (q) => q.eq("productId", canonical._id))
    .collect();

  return {
    upc: canonical.upc,
    title: canonical.title,
    platform: canonical.platform,
    edition: canonical.edition,
    collection: canonical.collection,
    brand: canonical.brand,
    model: canonical.model,
    mpn: canonical.mpn,
    color: canonical.color,
    storage: canonical.storage,
    carrier: canonical.carrier,
    publisher: canonical.publisher,
    genre: canonical.genre,
    rating: canonical.rating,
    releaseYear: canonical.releaseYear,
    attributes: canonical.attributes,
    collections: canonical.collections,
    upcs: rankUpcs(sources, canonical.upc),
    sourceUrls: sources.map((source) => source.sourceUrl),
    listings: sources.map(sourceToListing),
    createdAt: canonical.createdAt,
    updatedAt: canonical.updatedAt,
  };
}

// A catalog source row is pure provenance: product, UPC, source URL, photo,
// and timestamps. Only attach fields that are present so rows without them
// come back without undefined-valued keys.
function sourceToListing(source: Doc<"paymoreCatalogSources">): CatalogListing {
  const listing: CatalogListing = { sourceUrl: source.sourceUrl };
  if (source.imageUrl !== undefined) listing.imageUrl = source.imageUrl;
  if (source.updatedAt !== undefined) listing.updatedAt = source.updatedAt;
  return listing;
}
