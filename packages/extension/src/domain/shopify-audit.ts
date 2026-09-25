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
