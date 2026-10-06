export type CatalogListing = {
  sourceUrl: string;
  // The catalog is spec-only: per-unit listing facts (condition, sku,
  // graded, case/manual/inserts/DLC) and marketplace metrics are never
  // captured. Photos are kept.
  imageUrl?: string;
  // Freshness of the stored source row; set when a listing is loaded back
  // from the database.
  updatedAt?: number;
  lastSeenAt?: number;
  active?: boolean;
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
  // Source collection names; the canonical collection field above keeps
  // the import group slug.
  collections?: string[];
  sourceUrls: string[];
  listings: CatalogListing[];
};
