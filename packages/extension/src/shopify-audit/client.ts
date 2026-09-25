import { normalizeShopifyShopInput, validShopifyAdminProductUrl } from "../domain/shopify-audit";

export type ShopifySearchProduct = {
  id: string;
  title: string;
  status: string;
  totalInventory: number;
  url: string;
  imageUrl: string | null;
  price: string | null;
  currencyCode: string | null;
  condition: string | null;
  sku: string | null;
};

export type ShopifySearchResult = { shop: string; products: ShopifySearchProduct[] };

async function send(action: string, extra: Record<string, unknown> = {}): Promise<unknown> {
  const response: unknown = await chrome.runtime.sendMessage({ action, ...extra });
  if (!response || typeof response !== "object") throw new Error("Shopify audit did not respond.");
  const result = response as { success?: unknown; value?: unknown; error?: unknown };
  if (result.success !== true) throw new Error(typeof result.error === "string" ? result.error : "Shopify audit failed.");
  return result.value;
}

export async function getShopifyAuditConnection(): Promise<{ shop: string } | null> {
  const value = await send("shopifyAuditStatus");
  if (value === null) return null;
  if (!value || typeof value !== "object") throw new Error("Shopify connection status was invalid.");
  const shop = (value as { shop?: unknown }).shop;
  if (typeof shop !== "string" || normalizeShopifyShopInput(shop) !== shop) throw new Error("Shopify connection status was invalid.");
  return { shop };
}

export async function connectShopifyAudit(shop: string): Promise<void> {
  await send("shopifyAuditConnect", { shop });
}

export async function disconnectShopifyAudit(): Promise<void> {
  await send("shopifyAuditDisconnect");
}

export async function openShopifyAudit(): Promise<{ shop: string; date: string; count: number }> {
  const value = await send("shopifyAuditOpenYesterday");
  if (!value || typeof value !== "object") throw new Error("Shopify audit result was invalid.");
  const result = value as { shop?: unknown; date?: unknown; count?: unknown };
  if (typeof result.shop !== "string" || typeof result.date !== "string" || typeof result.count !== "number") {
    throw new Error("Shopify audit result was invalid.");
  }
  return { shop: result.shop, date: result.date, count: result.count };
}

export async function searchShopifyProducts(query: string): Promise<ShopifySearchResult> {
  const value = await send("shopifyAuditSearchProducts", { query });
  if (!value || typeof value !== "object") throw new Error("Shopify returned an invalid search result.");
  const result = value as { shop?: unknown; products?: unknown };
  if (typeof result.shop !== "string" || normalizeShopifyShopInput(result.shop) !== result.shop
    || !Array.isArray(result.products) || result.products.length > 30) {
    throw new Error("Shopify returned an invalid search result.");
  }
  const products: ShopifySearchProduct[] = [];
  for (const value of result.products) {
    if (!value || typeof value !== "object") throw new Error("Shopify returned an invalid product.");
    const product = value as Partial<ShopifySearchProduct>;
    if (typeof product.id !== "string" || typeof product.title !== "string"
      || typeof product.status !== "string" || typeof product.totalInventory !== "number"
      || !Number.isInteger(product.totalInventory) || typeof product.url !== "string"
      || !validShopifyAdminProductUrl(product.url, result.shop)
      || (product.imageUrl !== null && (typeof product.imageUrl !== "string" || !validImageUrl(product.imageUrl)))
      || (product.price !== null && (typeof product.price !== "string" || !/^\d+(?:\.\d+)?$/.test(product.price)))
      || (product.currencyCode !== null && (typeof product.currencyCode !== "string" || !/^[A-Z]{3}$/.test(product.currencyCode)))
      || (product.condition !== null && (typeof product.condition !== "string" || product.condition.length > 200))
      || (product.sku !== null && (typeof product.sku !== "string" || product.sku.length > 255))) {
      throw new Error("Shopify returned an invalid product.");
    }
    products.push({ id: product.id, title: product.title, status: product.status, totalInventory: product.totalInventory, url: product.url, imageUrl: product.imageUrl, price: product.price, currencyCode: product.currencyCode, condition: product.condition, sku: product.sku });
  }
  return { shop: result.shop, products };
}

function validImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}
