import {
  buildGoogleSearchUrl,
  buildSearchUrl,
  buildShopifyInventoryUrl,
  getUrlFromInput,
} from "./search.ts";

export type NewTabSearchMode =
  | "google"
  | "ebay"
  | "pricecharting"
  | "barcodelookup"
  | "shopify";

export interface SearchIntentProvider {
  id: string;
  searchUrl: string;
}

export type SearchIntent =
  | { kind: "navigate"; url: string }
  | { kind: "search-provider"; providerId: string; query: string; url: string }
  | { kind: "shopify-inventory"; query: string; storeName: string; url: string }
  | { kind: "missing-shopify-store"; query: string };

export interface ParsedSearchInput {
  mode: NewTabSearchMode | null;
  query: string;
}

const SEARCH_PREFIXES: Record<string, NewTabSearchMode> = {
  g: "google",
  p: "pricecharting",
  u: "barcodelookup",
  e: "ebay",
  s: "shopify",
};

export function getSearchPrefixMode(input: string): NewTabSearchMode | null {
  const normalized = input.trim().toLowerCase();
  if (!/^[a-z]$/.test(normalized)) {
    return null;
  }

  return SEARCH_PREFIXES[normalized] ?? null;
}

export function parseSearchPrefix(input: string): ParsedSearchInput {
  const match = input.match(/^([a-z])\s+(.+)$/i);
  if (!match) {
    return { mode: null, query: input };
  }

  const mode = SEARCH_PREFIXES[match[1].toLowerCase()];
  if (!mode) {
    return { mode: null, query: input };
  }

  return { mode, query: match[2].trim() };
}

export function resolveNewTabSearchIntent(
  input: string,
  options: {
    activeMode: NewTabSearchMode;
    providers: SearchIntentProvider[];
    shopifyStoreName?: string | null;
  }
): SearchIntent | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const prefixed = parseSearchPrefix(trimmed);
  const mode = prefixed.mode ?? options.activeMode;
  const query = prefixed.query.trim();
  if (!query) return null;

  if (mode === "google") {
    return {
      kind: "navigate",
      url: getUrlFromInput(query) || buildGoogleSearchUrl(query),
    };
  }

  if (mode === "shopify") {
    const storeName = options.shopifyStoreName;
    if (!storeName) {
      return { kind: "missing-shopify-store", query };
    }

    return {
      kind: "shopify-inventory",
      query,
      storeName,
      url: buildShopifyInventoryUrl(storeName, query),
    };
  }

  const provider = options.providers.find((candidate) => candidate.id === mode);
  if (!provider) return null;

  return {
    kind: "search-provider",
    providerId: provider.id,
    query,
    url: buildSearchUrl(provider.searchUrl, query),
  };
}

export function resolveProviderSearchIntent(
  provider: SearchIntentProvider,
  query: string,
  options: { ebayCondition?: string } = {}
): SearchIntent | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  return {
    kind: "search-provider",
    providerId: provider.id,
    query: trimmed,
    url: buildSearchUrl(provider.searchUrl, trimmed, {
      ebayCondition: provider.id === "ebay" ? options.ebayCondition : undefined,
    }),
  };
}
