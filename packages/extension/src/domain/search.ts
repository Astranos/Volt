export const SEARCH_URL_TEMPLATES = {
  google: "https://www.google.com/search?q={query}",
  volt: "https://google.com/search/?q={query}",
  amazon: "https://www.amazon.com/s?k={query}",
  bestbuy: "https://www.bestbuy.com/site/searchpage.jsp?st={query}",
  ebay:
    "https://www.ebay.com/sch/i.html?_nkw={query}&LH_Sold=1&LH_Complete=1&_dmd=2&rt=nc",
  pricecharting:
    "https://www.pricecharting.com/search-products?q={query}&type=videogames",
  barcodelookup: "https://www.barcodelookup.com/{query}",
  upcitemdb: "https://www.upcitemdb.com/upc/{query}",
  youtube: "https://www.youtube.com/results?search_query={query}",
  github: "https://github.com/search?q={query}",
  twitter: "https://twitter.com/search?q={query}",
  homedepot: "https://www.homedepot.com/s/{query}",
  lowes: "https://www.lowes.com/search?searchTerm={query}",
  menards: "https://www.menards.com/main/search.html?search={query}",
  microcenter:
    "https://www.microcenter.com/search/search_results.aspx?N=&cat=&Ntt={query}",
} as const;

export type SearchProviderId = keyof typeof SEARCH_URL_TEMPLATES;

export function getUrlFromInput(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  try {
    const hasScheme = /^[a-z][\w+.-]*:/i.test(value);
    if (hasScheme) {
      return new URL(value).href;
    }

    const looksLikeLocalhost = /^localhost(?:[:][0-9]+)?(?:\/.*)?$/i.test(
      value
    );
    const looksLikeDomain = /^[\w.-]+\.[a-z]{2,}(?::[0-9]+)?(?:\/.*)?$/i.test(
      value
    );

    if (looksLikeLocalhost || looksLikeDomain) {
      return new URL(`https://${value}`).href;
    }
  } catch (_e) {
    return null;
  }

  return null;
}

export function buildSearchUrl(
  searchUrl: string,
  query: string,
  options: { ebayCondition?: string } = {}
): string {
  let url = searchUrl.replace("{query}", encodeURIComponent(query.trim()));

  if (options.ebayCondition && isEbaySoldSearchUrl(url)) {
    url += `&LH_ItemCondition=${options.ebayCondition}`;
  }

  return url;
}

export function buildGoogleSearchUrl(query: string): string {
  return buildSearchUrl(SEARCH_URL_TEMPLATES.google, query);
}

export function extractShopifyStoreName(url: string): string | null {
  const unifiedMatch = url.match(/admin\.shopify\.com\/store\/([^/?]+)/);
  if (unifiedMatch?.[1]) {
    return unifiedMatch[1];
  }

  const legacyMatch = url.match(/([^/.]+)\.myshopify\.com/);
  return legacyMatch?.[1] || null;
}

export function buildShopifyInventoryUrl(storeName: string, query: string): string {
  return `https://admin.shopify.com/store/${storeName}/products?query=${encodeURIComponent(
    query.trim()
  )}&order=inventory_total%20desc`;
}

function isEbaySoldSearchUrl(url: string): boolean {
  return /\/\/www\.ebay\.com\/sch\/i\.html/.test(url);
}
