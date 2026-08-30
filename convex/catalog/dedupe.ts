import { mergeAttributeRecords } from "./attributes";
import type { CatalogListing, CatalogProduct } from "./types";

function preferText(current: string | null, incoming: string | null): string | null {
  if (!incoming) return current;
  if (!current) return incoming;
  return incoming.length > current.length ? incoming : current;
}

// Collection tags union across merges so a product accumulates every
// collection it has appeared in instead of flipping to the latest one.
function unionCollections(
  current: string[] | undefined,
  incoming: string[] | undefined,
): string[] | undefined {
  if (!current && !incoming) return undefined;
  return [...new Set([...(current ?? []), ...(incoming ?? [])])].sort();
}

export function mergeProductFields(
  current: Omit<CatalogProduct, "sourceUrls" | "listings">,
  incoming: Omit<CatalogProduct, "sourceUrls" | "listings">,
): Omit<CatalogProduct, "sourceUrls" | "listings"> {
  return {
    upc: current.upc,
    title: preferText(current.title, incoming.title) ?? current.title,
    platform: preferText(current.platform, incoming.platform),
    edition: preferText(current.edition, incoming.edition),
    collection: preferText(current.collection, incoming.collection),
    brand: preferText(current.brand, incoming.brand),
    model: preferText(current.model, incoming.model),
    mpn: preferText(current.mpn, incoming.mpn),
    color: preferText(current.color, incoming.color),
    storage: preferText(current.storage, incoming.storage),
    carrier: preferText(current.carrier, incoming.carrier),
    publisher: preferText(current.publisher, incoming.publisher),
    genre: preferText(current.genre, incoming.genre),
    rating: preferText(current.rating, incoming.rating),
    releaseYear: preferText(current.releaseYear, incoming.releaseYear),
    attributes: mergeAttributeRecords(current.attributes, incoming.attributes),
    collections: unionCollections(current.collections, incoming.collections),
  };
}

function mergeListings(current: CatalogListing[], incoming: CatalogListing[]): CatalogListing[] {
  const listings = [...current];
  for (const listing of incoming) {
    const existing = listings.find((item) => item.sourceUrl === listing.sourceUrl);
    if (existing) {
      existing.condition = preferText(existing.condition, listing.condition);
      existing.attributes = mergeAttributeRecords(existing.attributes, listing.attributes);
      continue;
    }
    listings.push({ ...listing, attributes: { ...listing.attributes } });
  }
  return listings;
}

function mergeProduct(current: CatalogProduct, incoming: CatalogProduct): CatalogProduct {
  const listings = mergeListings(current.listings, incoming.listings);
  return {
    ...mergeProductFields(current, incoming),
    listings,
    sourceUrls: listings.map((listing) => listing.sourceUrl),
  };
}

export function dedupeProducts(products: CatalogProduct[]): CatalogProduct[] {
  const byUpc = new Map<string, CatalogProduct>();
  for (const product of products) {
    const existing = byUpc.get(product.upc);
    byUpc.set(
      product.upc,
      existing
        ? mergeProduct(existing, product)
        : {
            ...product,
            attributes: { ...product.attributes },
            sourceUrls: [...product.sourceUrls],
            listings: product.listings.map((listing) => ({ ...listing, attributes: { ...listing.attributes } })),
          },
    );
  }
  return [...byUpc.values()];
}
