const DEFAULT_CONVEX_SITE_URL = "https://sincere-trout-414.convex.site";

declare global {
  interface Window {
    shopify?: { idToken: () => Promise<string> };
  }
}

export type AuditProduct = {
  id: string;
  title: string;
  status: string;
  url: string;
};

export type SearchProduct = AuditProduct & {
  totalInventory: number;
  imageUrl: string | null;
  price: string | null;
  currencyCode: string | null;
  sku: string | null;
  condition: string | null;
};

export type YesterdayRange = {
  date: string;
  startUtc: string;
  endUtc: string;
};

export function localYesterday(now = new Date()): YesterdayRange {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const date = [start.getFullYear(), start.getMonth() + 1, start.getDate()]
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, "0"))
    .join("-");
  return { date, startUtc: start.toISOString(), endUtc: end.toISOString() };
}

export async function getShopStatus(signal?: AbortSignal): Promise<{ shop: string }> {
  return postShopify("/api/shopify/admin/status", {}, isShopStatus, signal);
}

export async function getYesterday(range: YesterdayRange, signal?: AbortSignal): Promise<{
  shop: string;
  date: string;
  products: AuditProduct[];
}> {
  return postShopify("/api/shopify/admin/yesterday", range, isYesterdayResponse, signal);
}

export async function searchProducts(query: string, signal?: AbortSignal): Promise<{
  shop: string;
  products: SearchProduct[];
}> {
  return postShopify("/api/shopify/admin/search", { query }, isSearchResponse, signal);
}

async function postShopify<T>(
  path: string,
  body: object,
  isResponse: (value: unknown) => value is T,
  signal?: AbortSignal,
): Promise<T> {
  const bridge = window.shopify;
  if (typeof bridge?.idToken !== "function") {
    throw new Error("Open Volt Resale from Shopify Admin to start the product audit.");
  }
  // Production requests stay on the app origin. Vercel forwards this narrow
  // route to Convex, which still verifies the Shopify bearer token.
  const base = import.meta.env.DEV
    ? (import.meta.env.VITE_CONVEX_SITE_URL || DEFAULT_CONVEX_SITE_URL).replace(/\/$/, "")
    : "";
  for (let attempt = 0; attempt < 2; attempt++) {
    signal?.throwIfAborted();
    let response: Response;
    try {
      // Refresh the short-lived ID token on every attempt, including retries.
      const token = await bridge.idToken();
      signal?.throwIfAborted();
      response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof TypeError)) throw error;
      if (attempt === 0) continue;
      throw new Error("Could not reach your store. Check your connection and retry.");
    }
    if (attempt === 0 && [401, 409, 429, 502, 503, 504].includes(response.status)) continue;
    const payload: unknown = await response.json().catch(() => null);
    signal?.throwIfAborted();
    if (!response.ok) {
      throw new Error(isErrorPayload(payload) ? payload.error : `Shopify request failed (${response.status}). Please retry.`);
    }
    if (!isResponse(payload)) throw new Error("The Shopify response could not be read. Please retry.");
    return payload;
  }
  throw new Error("Could not reach your store. Please retry.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorPayload(value: unknown): value is { error: string } {
  return isRecord(value) && typeof value.error === "string";
}

function isShopStatus(value: unknown): value is { shop: string } {
  return isRecord(value) && typeof value.shop === "string";
}

function isAdminUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "admin.shopify.com";
  } catch {
    return false;
  }
}

function isAuditProduct(value: unknown): value is AuditProduct {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string"
    && typeof value.status === "string" && isAdminUrl(value.url);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isSearchProduct(value: unknown): value is SearchProduct {
  if (!isRecord(value)) return false;
  const { totalInventory, imageUrl, price, currencyCode, sku, condition } = value;
  return isAuditProduct(value)
    && typeof totalInventory === "number" && Number.isFinite(totalInventory)
    && isNullableString(imageUrl) && isNullableString(price)
    && isNullableString(currencyCode) && isNullableString(sku)
    && isNullableString(condition);
}

function isYesterdayResponse(value: unknown): value is {
  shop: string;
  date: string;
  products: AuditProduct[];
} {
  if (!isRecord(value)) return false;
  const { date, products } = value;
  return isShopStatus(value) && typeof date === "string"
    && Array.isArray(products) && products.every(isAuditProduct);
}

function isSearchResponse(value: unknown): value is {
  shop: string;
  products: SearchProduct[];
} {
  if (!isRecord(value)) return false;
  const { products } = value;
  return isShopStatus(value) && Array.isArray(products)
    && products.every(isSearchProduct);
}
