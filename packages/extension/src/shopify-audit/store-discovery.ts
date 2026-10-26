import { normalizeShopifyShopInput } from "../domain/shopify-audit.ts";

/** A store someone typed: its admin URL, its myshopify domain, or the bare name from /store/<name>. */
export function shopDomainFromTypedStore(value: string): string | null {
  const trimmed = value.trim();
  if (/^[a-z0-9-]+$/i.test(trimmed)) return normalizeShopifyShopInput(`${trimmed}.myshopify.com`);
  const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return shopDomainFromAdminUrl(url) ?? normalizeShopifyShopInput(trimmed);
}

export function shopDomainFromAdminUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (url.hostname === "admin.shopify.com") {
      const match = /^\/store\/([a-z0-9-]+)(?:\/|$)/i.exec(url.pathname);
      return match ? normalizeShopifyShopInput(`${match[1]}.myshopify.com`) : null;
    }
    if (!url.pathname.startsWith("/admin")) return null;
    return normalizeShopifyShopInput(url.hostname);
  } catch {
    return null;
  }
}

export async function findOpenShopifyAdminShops(): Promise<string[]> {
  const tabs = await chrome.tabs.query({});
  return [...new Set(tabs.map((tab) => shopDomainFromAdminUrl(tab.url)).filter((shop): shop is string => shop !== null))];
}
