export type RejectReason =
  | "unauthorized-host"
  | "missing-title"
  | "missing-upc"
  | "invalid-upc"
  | "invalid-json"
  | "fetch-failed";

export type CatalogListing = {
  sourceUrl: string;
  condition: string | null;
  attributes: Record<string, string>;
  // The catalog is spec-only: per-listing marketplace metrics (price,
  // quantity, store name) are no longer captured. Photos are kept.
  imageUrl?: string;
  // Freshness of the stored source row; set when a listing is loaded back
  // from the database.
  updatedAt?: number;
};

export type CatalogProduct = {
  upc: string;
  title: string;
  platform: string | null;
  edition: string | null;
  collection: string | null;
  brand: string | null;
  model: string | null;
  mpn: string | null;
  color: string | null;
  storage: string | null;
  carrier: string | null;
  publisher: string | null;
  genre: string | null;
  rating: string | null;
  releaseYear: string | null;
  attributes: Record<string, string>;
  // PayMore collection names carried by the listing; the canonical
  // collection field above keeps the crawl-time collection slug.
  collections?: string[];
  sourceUrls: string[];
  listings: CatalogListing[];
};

export type RejectedListing = {
  sourceUrl: string;
  reason: RejectReason;
  detail?: string;
};

export type ExtractResult = {
  products: CatalogProduct[];
  rejected: RejectedListing[];
};

export type CrawlResult = ExtractResult & {
  fetched: number;
};

export type PageInput = {
  sourceUrl: string;
  body: string;
};
