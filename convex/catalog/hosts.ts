const PAYMORE_HOST = /^(?:[a-z0-9-]+\.)?paymore\.com$/i;
const PRODUCT_PATH = /^\/products\/[a-z0-9][a-z0-9_-]*(?:\.json)?$/i;
const SHOP_PRODUCT_PATH = /^\/shop\/product\/[A-Za-z0-9._~-]+$/;
const COLLECTION_PRODUCTS_JSON = /^\/collections\/[a-z0-9][a-z0-9_-]*\/products\.json$/i;
const API_HOST = "pm.paymore.tech";
const API_PATH_PREFIX = "/api/user/shop/";

function parseHttpsPayMoreUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !PAYMORE_HOST.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function isAuthorizedPayMoreProductUrl(value: string): boolean {
  const url = parseHttpsPayMoreUrl(value);
  if (!url) return false;
  return PRODUCT_PATH.test(url.pathname) || SHOP_PRODUCT_PATH.test(url.pathname);
}

// Listing API responses are only trusted from the exact PayMore API host.
export function isAuthorizedPayMoreApiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === API_HOST &&
      url.pathname.startsWith(API_PATH_PREFIX)
    );
  } catch {
    return false;
  }
}

export function isAuthorizedPayMoreCatalogUrl(value: string): boolean {
  const url = parseHttpsPayMoreUrl(value);
  if (!url) return false;
  return PRODUCT_PATH.test(url.pathname) || COLLECTION_PRODUCTS_JSON.test(url.pathname);
}

export function productPageUrl(sourceUrl: string, handle: string): string | null {
  try {
    const origin = new URL(sourceUrl).origin;
    const url = `${origin}/products/${handle}`;
    return isAuthorizedPayMoreProductUrl(url) ? url : null;
  } catch {
    return null;
  }
}
