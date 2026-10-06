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

type UpsertOptions = {
  // A reviewed correction may move an existing URL to a different UPC.
  allowSourceCorrection?: boolean;
  reviewed?: boolean;
};

function productFieldsChanged(
  current: Doc<"paymoreCatalogProducts">,
  merged: CatalogProductFields,
): boolean {
  const keys = [
    "title", "platform", "edition", "collection", "brand", "model", "mpn",
    "color", "storage", "carrier", "publisher", "genre", "rating", "releaseYear",
  ] as const;
  return keys.some((key) => current[key] !== merged[key])
    || JSON.stringify(current.attributes) !== JSON.stringify(merged.attributes)
    || JSON.stringify(current.collections ?? []) !== JSON.stringify(merged.collections ?? []);
}

export async function upsertCatalogProducts(
  ctx: MutationCtx,
  products: CatalogProduct[],
  now: number,
  options: UpsertOptions = {},
): Promise<UpsertStats> {
  let inserted = 0;
  let updated = 0;
  let sourcesAdded = 0;

  for (const product of products) {
    const upc = normalizeUPCA(product.upc);
    const title = product.title.trim();
    const listings = product.listings.filter((listing) => isAuthorizedCatalogProductUrl(listing.sourceUrl));
    if (!upc || !title || listings.length === 0) continue;

    const knownSources = await Promise.all(listings.map((listing) =>
      ctx.db.query("paymoreCatalogSources")
        .withIndex("by_sourceUrl", (q) => q.eq("sourceUrl", listing.sourceUrl))
        .unique()));
    if (!options.allowSourceCorrection && knownSources.some((source) => source && source.upc !== upc)) {
      continue;
    }

    const fields = productFields(product, upc, title);
    const existing = await ctx.db.query("paymoreCatalogProducts")
      .withIndex("by_upc", (q) => q.eq("upc", upc))
      .first();
    let productId: Id<"paymoreCatalogProducts">;
    if (existing) {
      productId = existing._id;
      const merged = mergeProductFields(existing, fields);
      if (productFieldsChanged(existing, merged)) {
        await patchProductFields(ctx, existing._id, merged, now);
        updated += 1;
      }
      if (options.reviewed && existing.qualityStatus !== "reviewed") {
        await ctx.db.patch(existing._id, { qualityStatus: "reviewed" });
      }
    } else {
      productId = await ctx.db.insert("paymoreCatalogProducts", {
        ...fields,
        qualityStatus: options.reviewed ? "reviewed" : "unreviewed",
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    }

    for (const [index, listing] of listings.entries()) {
      const source = knownSources[index];
      if (source) {
        const corrected = source.upc !== upc || source.productId !== productId;
        const imageChanged = listing.imageUrl !== undefined && listing.imageUrl !== source.imageUrl;
        await ctx.db.patch(source._id, {
          productId,
          upc,
          lastSeenAt: now,
          active: true,
          ...(corrected || imageChanged ? { updatedAt: now } : {}),
          ...(listing.imageUrl !== undefined ? { imageUrl: listing.imageUrl } : {}),
        });
        if (corrected && source.productId !== productId) {
          const remaining = await ctx.db.query("paymoreCatalogSources")
            .withIndex("by_productId", (q) => q.eq("productId", source.productId))
            .take(1);
          if (remaining.length === 0) await ctx.db.delete(source.productId);
        }
        continue;
      }
      await ctx.db.insert("paymoreCatalogSources", {
        productId,
        upc,
        sourceUrl: listing.sourceUrl,
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        active: true,
        ...(listing.imageUrl !== undefined ? { imageUrl: listing.imageUrl } : {}),
      });
      sourcesAdded += 1;
    }
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
    qualityStatus: canonical.qualityStatus ?? "unreviewed",
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
  if (source.lastSeenAt !== undefined) listing.lastSeenAt = source.lastSeenAt;
  if (source.active !== undefined) listing.active = source.active;
  return listing;
}
