import {
  buildSearchUrl,
  buildShopifyInventoryUrl,
} from "./search.ts";

export type NewTabSearchMode =
  | "closed-tabs"
  | "ebay"
  | "pricecharting"
  | "barcodelookup"
  | "shopify";

export interface SearchIntentProvider {
  id: string;
  searchUrl: string;
}

export const NEW_TAB_SEARCH_PROVIDERS = [
  {
    id: "pricecharting",
    name: "Price Charting",
    searchUrl:
      "https://www.pricecharting.com/search-products?q={query}&type=videogames",
  },
  {
    id: "barcodelookup",
    name: "BarcodeLookup (UPC)",
    searchUrl: "https://www.barcodelookup.com/{query}",
  },
  {
    id: "ebay",
    name: "eBay (Sold Prices)",
    searchUrl:
      "https://www.ebay.com/sch/i.html?_nkw={query}&LH_Sold=1&LH_Complete=1&_dmd=2&rt=nc",
  },
  {
    id: "shopify",
    name: "Shopify (Available Inventory)",
    searchUrl:
      "https://admin.shopify.com/store/{store}/products?query={query}",
  },
] as const satisfies readonly (SearchIntentProvider & { name: string })[];

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
    providers: readonly SearchIntentProvider[];
    shopifyStoreName?: string | null;
  }
): SearchIntent | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const prefixed = parseSearchPrefix(trimmed);
  const mode = prefixed.mode ?? options.activeMode;
  const query = prefixed.query.trim();
  if (!query) return null;

  if (mode === "closed-tabs") return null;

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
