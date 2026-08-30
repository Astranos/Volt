import { normalizeUPCA } from "../aiScanner";
import {
  omitProductAttributeKeys,
  pickProductAttribute,
  splitSpecAttributes,
  type ProductAttributeKey,
} from "./attributes";
import { isAuthorizedPayMoreProductUrl } from "./hosts";
import { collapseWhitespace, parseProductIdentity } from "./parseTitle";
import type { CatalogListing, CatalogProduct } from "./types";

export type PayMoreApiMapping = {
  products: CatalogProduct[];
  skippedNoUpc: number;
  skippedNoTitle: number;
};

type SkippedItem = { skipped: "no-upc" | "no-title" };
type MappedItem = CatalogProduct | SkippedItem;

function isSkipped(item: MappedItem): item is SkippedItem {
  return "skipped" in item;
}

function objectFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = collapseWhitespace(value);
  return cleaned ? cleaned : null;
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readSpecValue(value: unknown): string | null {
  if (typeof value === "string") return readString(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function specEntries(attributes: Record<string, unknown>): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [label, rawValue] of Object.entries(attributes)) {
    const value = readSpecValue(rawValue);
    if (value) entries.push([label, value]);
  }
  return entries;
}

// Extracts trimmed, deduped collection names from item.shopify_collection
// (an array of {id, name}). Falls back to the crawl collection slug when the
// item does not carry any usable collection names.
function extractCollections(item: Record<string, unknown>, collectionSlug: string): string[] {
  const names: string[] = [];
  const raw = item.shopify_collection;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const name = readString(objectFrom(entry).name);
      if (name) names.push(name);
    }
  }
  const unique = [...new Set(names)];
  return unique.length > 0 ? unique : collectionSlug ? [collectionSlug] : [];
}

// These keys are consumed as typed fields or the catalog identity, so they
// must not leak into the spec split. splitSpecAttributes also drops them via
// SKIP_LABELS; this keeps the intent explicit at the source.
const IDENTITY_SPEC_KEYS = new Set(["upc", "game name", "platform"]);

function shopProductUrlFor(productId: string | null): string | null {
  if (!productId) return null;
  const url = `https://paymore.com/shop/product/${encodeURIComponent(productId)}`;
  return isAuthorizedPayMoreProductUrl(url) ? url : null;
}

function mapPayMoreApiItem(item: unknown, collectionSlug: string): MappedItem {
  const record = objectFrom(item);
  const filterAttributes = objectFrom(record.filter_attributes);
  const otherAttributes = objectFrom(record.other_attributes);

  const upc = normalizeUPCA(
    readString(filterAttributes.UPC) ?? readString(otherAttributes.UPC) ?? "",
  );
  if (!upc) return { skipped: "no-upc" };

  const gameName = readString(filterAttributes["Game Name"]);
  const title = readString(record.p_title) ?? gameName;
  if (!title) return { skipped: "no-title" };

  const platformField = readString(filterAttributes.Platform);
  const fromGame = gameName ? parseProductIdentity(gameName) : null;
  const fromTitle = parseProductIdentity(title);
  const platform = platformField ?? fromGame?.platform ?? fromTitle.platform ?? null;
  const edition = (fromGame ?? fromTitle)?.edition ?? null;

  const specs: Array<[string, string]> = [
    ...specEntries(filterAttributes),
    ...specEntries(otherAttributes),
  ].filter(([label]) => !IDENTITY_SPEC_KEYS.has(label.trim().toLowerCase()));

  const split = splitSpecAttributes(specs);
  const pick = (key: ProductAttributeKey) => pickProductAttribute(split.product, key);
  const sourceUrl = shopProductUrlFor(readString(record.p_id));
  const listing: CatalogListing | null = sourceUrl
    ? {
        sourceUrl,
        condition: split.listing.condition ?? null,
        attributes: split.listing,
        price: readFiniteNumber(record.v_price),
        quantity: readFiniteNumber(record.v_qty),
        storeName: readTrimmedString(record.shop_name),
        imageUrl: readTrimmedString(record.p_image),
      }
    : null;

  return {
    upc,
    title,
    platform,
    edition,
    collection: collectionSlug || null,
    brand: pick("brand"),
    model: pick("model"),
    mpn: pick("mpn"),
    color: pick("color"),
    storage: pick("storage"),
    carrier: pick("carrier"),
    publisher: pick("publisher"),
    genre: pick("genre"),
    rating: pick("rating"),
    releaseYear: pick("releaseYear"),
    attributes: omitProductAttributeKeys(split.product),
    collections: extractCollections(record, collectionSlug),
    sourceUrls: listing ? [listing.sourceUrl] : [],
    listings: listing ? [listing] : [],
  };
}

// Maps raw PayMore listing API items into catalog products. Items without a
// valid UPC are never stored: the catalog is keyed by UPC, and unit-level
// identity fields (Serial#, IMEI, ...) are stripped by the shared denylist in
// splitSpecAttributes rather than carried over here.
export function mapPayMoreApiItems(
  items: readonly unknown[],
  collectionSlug: string,
): PayMoreApiMapping {
  const products: CatalogProduct[] = [];
  let skippedNoUpc = 0;
  let skippedNoTitle = 0;
  for (const item of items) {
    const mapped = mapPayMoreApiItem(item, collectionSlug);
    if (isSkipped(mapped)) {
      if (mapped.skipped === "no-upc") skippedNoUpc += 1;
      else skippedNoTitle += 1;
      continue;
    }
    products.push(mapped);
  }
  return { products, skippedNoUpc, skippedNoTitle };
}
