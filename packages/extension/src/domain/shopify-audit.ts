export type ShopifyAuditProduct = {
  id: string;
  title: string;
  status: string;
  url: string;
};

export type ShopifyAuditResult = {
  shop: string;
  date: string;
  products: ShopifyAuditProduct[];
};

export const MAX_COMPARE_PRODUCTS = 8;

export type ShopifyProductDetails = {
  id: string;
  title: string;
  status: string;
  totalInventory: number;
  url: string;
  images: string[];
  currencyCode: string | null;
  minPrice: string | null;
  maxPrice: string | null;
  condition: string | null;
  vendor: string | null;
  productType: string | null;
  descriptionHtml: string;
  variants: Array<{ id: string; title: string; sku: string | null; price: string | null }>;
};

export type ShopifyAuditDateRange = {
  date: string;
  startUtc: string;
  endUtc: string;
};

export function yesterdayInComputerTimezone(now = new Date()): ShopifyAuditDateRange {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const start = new Date(year, month, day - 1);
  const end = new Date(year, month, day);
  const date = [start.getFullYear(), String(start.getMonth() + 1).padStart(2, "0"), String(start.getDate()).padStart(2, "0")].join("-");
  return { date, startUtc: start.toISOString(), endUtc: end.toISOString() };
}

export function validShopifyAdminProductUrl(value: string, shop: string): boolean {
  try {
    const url = new URL(value);
    const slug = shop.replace(/\.myshopify\.com$/, "");
    return url.protocol === "https:"
      && url.hostname === "admin.shopify.com"
      && new RegExp(`^/store/${encodeURIComponent(slug)}/products/\\d+$`).test(url.pathname)
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function normalizeShopifyShopInput(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) return null;
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(url.hostname) ? url.hostname : null;
  } catch {
    return null;
  }
}

/** How the new tab's Audit button presents yesterday's products. */
export type ShopifyAuditMode = "sidepanel" | "tabs";
export const SHOPIFY_AUDIT_MODE_KEY = "shopifyAuditMode";
export const parseShopifyAuditMode = (value: unknown): ShopifyAuditMode => (value === "tabs" ? "tabs" : "sidepanel");

export type ShopifyAuditMark = "done";

/** Side panel review progress, kept in chrome.storage.local so it survives restarts. */
export type ShopifyAuditReview = {
  shop: string;
  date: string;
  products: ShopifyAuditProduct[];
  marks: Record<string, ShopifyAuditMark>;
  currentId: string | null;
  /** The one tab the review navigates; null until a product is opened. */
  tabId: number | null;
};
export const SHOPIFY_AUDIT_REVIEW_KEY = "shopifyAuditReview";
/** Set by the new tab to ask the side panel to load yesterday's list. */
export const SHOPIFY_AUDIT_REVIEW_REQUEST_KEY = "shopifyAuditReviewRequest";
export type ShopifyAuditReviewRequest = { at: number; tabId: number | null };

export function parseShopifyAuditReview(value: unknown): ShopifyAuditReview | null {
  if (!value || typeof value !== "object") return null;
  const review = value as Partial<ShopifyAuditReview>;
  if (typeof review.shop !== "string" || normalizeShopifyShopInput(review.shop) !== review.shop
    || typeof review.date !== "string" || !Array.isArray(review.products)
    || !review.marks || typeof review.marks !== "object") return null;
  const shop = review.shop;
  const products = review.products.filter((product): product is ShopifyAuditProduct => !!product
    && typeof product.id === "string" && typeof product.title === "string" && typeof product.status === "string"
    && typeof product.url === "string" && validShopifyAdminProductUrl(product.url, shop));
  const ids = new Set(products.map((product) => product.id));
  const marks: Record<string, ShopifyAuditMark> = {};
  for (const [id, mark] of Object.entries(review.marks)) {
    if (ids.has(id) && mark === "done") marks[id] = mark;
  }
  return {
    shop,
    date: review.date,
    products,
    marks,
    currentId: typeof review.currentId === "string" && ids.has(review.currentId) ? review.currentId : null,
    tabId: typeof review.tabId === "number" && Number.isInteger(review.tabId) ? review.tabId : null,
  };
}

/** Starts a review of `result`, keeping progress when it is the same shop and day. */
export function startShopifyAuditReview(previous: ShopifyAuditReview | null, result: ShopifyAuditResult): ShopifyAuditReview {
  const same = previous?.shop === result.shop && previous.date === result.date ? previous : null;
  const ids = new Set(result.products.map((product) => product.id));
  const marks = Object.fromEntries(Object.entries(same?.marks ?? {}).filter(([id]) => ids.has(id)));
  const review: ShopifyAuditReview = { shop: result.shop, date: result.date, products: result.products, marks, currentId: null, tabId: same?.tabId ?? null };
  const current = same?.currentId && ids.has(same.currentId) && !marks[same.currentId] ? same.currentId : null;
  return { ...review, currentId: current ?? nextShopifyAuditProduct(review, null)?.id ?? null };
}

/** The first unmarked product after `afterId`, wrapping around; null once every product is marked. */
export function nextShopifyAuditProduct(review: ShopifyAuditReview, afterId: string | null): ShopifyAuditProduct | null {
  const start = afterId === null ? 0 : review.products.findIndex((product) => product.id === afterId) + 1;
  const count = review.products.length;
  for (let offset = 0; offset < count; offset++) {
    const product = review.products[(start + offset) % count];
    if (!review.marks[product.id]) return product;
  }
  return null;
}

/** Product pages only: the URL an audit tab may navigate to. */
export function isShopifyAdminProductUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "admin.shopify.com"
      && /^\/store\/[a-z0-9][a-z0-9-]*\/products\/\d+$/.test(url.pathname)
      && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

/**
 * The review tab is reused only while it shows one of the audit's products or
 * the new tab the audit started from; a tab the user took elsewhere (an order,
 * another product, another site) is left alone.
 */
export function isReusableShopifyAuditTab(url: string | undefined, review: Pick<ShopifyAuditReview, "products">, newTabPageUrl: string): boolean {
  if (!url) return false;
  if (url === "chrome://newtab/" || url.startsWith(newTabPageUrl)) return true;
  const page = url.split(/[?#]/)[0];
  return review.products.some((product) => product.url === page);
}
