import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeUPCA } from "../aiScanner";
import { mergeProductFields } from "./dedupe";
import { isAuthorizedPayMoreProductUrl } from "./hosts";
import type { CatalogProduct } from "./types";

export type UpsertStats = {
  inserted: number;
  updated: number;
  sourcesAdded: number;
};

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
    const listings = product.listings.filter((listing) => isAuthorizedPayMoreProductUrl(listing.sourceUrl));
    if (!upc || !title || listings.length === 0) continue;

    const fields = {
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
    };

    const existing = await ctx.db
      .query("paymoreCatalogProducts")
      .withIndex("by_upc", (q) => q.eq("upc", upc))
      .unique();

    let productId = existing?._id;
    if (!existing) {
      productId = await ctx.db.insert("paymoreCatalogProducts", {
        ...fields,
        createdAt: now,
        updatedAt: now,
      });
      inserted += 1;
    } else {
      const merged = mergeProductFields(existing, fields);
      await ctx.db.patch(existing._id, {
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
        updatedAt: now,
      });
      updated += 1;
    }

    for (const listing of listings) {
      const existingSource = await ctx.db
        .query("paymoreCatalogSources")
        .withIndex("by_sourceUrl", (q) => q.eq("sourceUrl", listing.sourceUrl))
        .unique();
      if (existingSource) {
        // A corrected UPC on re-crawl must move the source row to the new
        // product; otherwise it stays linked to a stale product/upc pair.
        if (existingSource.upc !== upc) {
          const remaining = await ctx.db
            .query("paymoreCatalogSources")
            .withIndex("by_upc", (q) => q.eq("upc", existingSource.upc))
            .collect();
          if (remaining.length === 1) await ctx.db.delete(existingSource.productId);
        }
        await ctx.db.patch(existingSource._id, {
          productId: productId!,
          upc,
          condition: listing.condition,
          listingAttributes: listing.attributes,
        });
        continue;
      }
      await ctx.db.insert("paymoreCatalogSources", {
        productId: productId!,
        upc,
        sourceUrl: listing.sourceUrl,
        condition: listing.condition,
        listingAttributes: listing.attributes,
        createdAt: now,
      });
      sourcesAdded += 1;
    }
  }

  return { inserted, updated, sourcesAdded };
}

export async function loadCatalogProductByUpc(ctx: QueryCtx, upc: string) {
  const product = await ctx.db
    .query("paymoreCatalogProducts")
    .withIndex("by_upc", (q) => q.eq("upc", upc))
    .unique();
  if (!product) return null;

  const sources = await ctx.db
    .query("paymoreCatalogSources")
    .withIndex("by_upc", (q) => q.eq("upc", upc))
    .collect();

  return {
    upc: product.upc,
    title: product.title,
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
    sourceUrls: sources.map((source) => source.sourceUrl),
    listings: sources.map((source) => ({
      sourceUrl: source.sourceUrl,
      condition: source.condition,
      attributes: source.listingAttributes,
    })),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}
