import { v } from "convex/values";

const nullableString = v.union(v.string(), v.null());
const stringRecord = v.record(v.string(), v.string());

export const catalogListingValidator = v.object({
  sourceUrl: v.string(),
  condition: nullableString,
  attributes: stringRecord,
  imageUrl: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
});

export const catalogProductValidator = v.object({
  upc: v.string(),
  title: v.string(),
  platform: nullableString,
  edition: nullableString,
  collection: nullableString,
  brand: nullableString,
  model: nullableString,
  mpn: nullableString,
  color: nullableString,
  storage: nullableString,
  carrier: nullableString,
  publisher: nullableString,
  genre: nullableString,
  rating: nullableString,
  releaseYear: nullableString,
  attributes: stringRecord,
  collections: v.optional(v.array(v.string())),
  sourceUrls: v.array(v.string()),
  listings: v.array(catalogListingValidator),
});

export const rejectedListingValidator = v.object({
  sourceUrl: v.string(),
  reason: v.union(
    v.literal("unauthorized-host"),
    v.literal("missing-title"),
    v.literal("missing-upc"),
    v.literal("invalid-upc"),
    v.literal("invalid-json"),
    v.literal("fetch-failed"),
  ),
  detail: v.optional(v.string()),
});

export const crawlResultValidator = v.object({
  products: v.array(catalogProductValidator),
  rejected: v.array(rejectedListingValidator),
  fetched: v.number(),
});

export const upsertStatsValidator = v.object({
  inserted: v.number(),
  updated: v.number(),
  sourcesAdded: v.number(),
});

export const storedCatalogProductValidator = v.object({
  upc: v.string(),
  title: v.string(),
  platform: nullableString,
  edition: nullableString,
  collection: nullableString,
  brand: nullableString,
  model: nullableString,
  mpn: nullableString,
  color: nullableString,
  storage: nullableString,
  carrier: nullableString,
  publisher: nullableString,
  genre: nullableString,
  rating: nullableString,
  releaseYear: nullableString,
  attributes: stringRecord,
  collections: v.optional(v.array(v.string())),
  upcs: v.array(v.string()),
  sourceUrls: v.array(v.string()),
  listings: v.array(catalogListingValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const catalogSummaryValidator = v.object({
  upc: v.string(),
  title: v.string(),
  platform: nullableString,
  edition: nullableString,
  mpn: nullableString,
  brand: nullableString,
  model: nullableString,
  color: nullableString,
  storage: nullableString,
  carrier: nullableString,
  updatedAt: v.number(),
});
