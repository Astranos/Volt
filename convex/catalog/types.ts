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
