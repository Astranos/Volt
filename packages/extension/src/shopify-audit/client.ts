import { normalizeShopifyShopInput, validShopifyAdminProductUrl, MAX_COMPARE_PRODUCTS, SHOPIFY_ACTIVE_SHOP_KEY, type ShopifyAuditDays, type ShopifyAuditResult, type ShopifyProductDetails } from "../domain/shopify-audit";

export type { ShopifyProductDetails };

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

/** Without a shop, the background uses the active store. */
const forShop = (shop: string | undefined) => (shop ? { shop } : {});

/** `shop` is the active store; `shops` is every store connected to the account. */
export type ShopifyConnection = { shop: string; shops: string[] };

export async function getShopifyAuditConnection(): Promise<ShopifyConnection | null> {
  const value = await send("shopifyAuditStatus");
  if (value === null) return null;
  if (!value || typeof value !== "object") throw new Error("Shopify connection status was invalid.");
  const { shop, shops } = value as { shop?: unknown; shops?: unknown };
  const valid = (item: unknown): item is string => typeof item === "string" && normalizeShopifyShopInput(item) === item;
  if (!valid(shop) || !Array.isArray(shops) || !shops.every(valid) || !shops.includes(shop)) throw new Error("Shopify connection status was invalid.");
  return { shop, shops };
}

/** Picks which connected store search, audits, and hidden products use on this computer. */
export async function setActiveShopifyStore(shop: string): Promise<void> {
  await chrome.storage.local.set({ [SHOPIFY_ACTIVE_SHOP_KEY]: shop });
}

export async function connectShopifyAudit(shop: string): Promise<void> {
  await send("shopifyAuditConnect", { shop });
}

export async function disconnectShopifyAudit(shop: string): Promise<void> {
  await send("shopifyAuditDisconnect", { shop });
}

export type ShopifyAuditTabsResult = { shop: string; date: string; count: number; opened: number; resumed: boolean };

export async function openShopifyAudit(): Promise<ShopifyAuditTabsResult> {
  const value = await send("shopifyAuditOpenYesterday");
  if (!value || typeof value !== "object") throw new Error("Shopify audit result was invalid.");
  const result = value as Partial<ShopifyAuditTabsResult>;
  if (typeof result.shop !== "string" || typeof result.date !== "string" || typeof result.count !== "number"
    || typeof result.opened !== "number" || typeof result.resumed !== "boolean") {
    throw new Error("Shopify audit result was invalid.");
  }
  return { shop: result.shop, date: result.date, count: result.count, opened: result.opened, resumed: result.resumed };
}

export async function listShopifyAuditYesterday(days: ShopifyAuditDays = 1, requestedShop?: string): Promise<ShopifyAuditResult> {
  const value = await send("shopifyAuditListYesterday", { days, ...forShop(requestedShop) });
  if (!value || typeof value !== "object") throw new Error("Shopify audit result was invalid.");
  const result = value as Partial<ShopifyAuditResult>;
  const shop = result.shop;
  if (typeof shop !== "string" || normalizeShopifyShopInput(shop) !== shop || typeof result.date !== "string"
    || !Array.isArray(result.products) || !result.products.every((product) => product && typeof product.id === "string"
      && typeof product.title === "string" && typeof product.status === "string" && validShopifyAdminProductUrl(product.url, shop))) {
    throw new Error("Shopify audit result was invalid.");
  }
  return { shop, date: result.date, products: result.products.map(({ id, title, status, url }) => ({ id, title, status, url })) };
}

const optionalText = (value: unknown, max: number) => value === null || (typeof value === "string" && value.length <= max);
const optionalAmount = (value: unknown) => value === null || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value));

export async function getShopifyProductDetails(productIds: string[], requestedShop?: string): Promise<{ shop: string; products: ShopifyProductDetails[] }> {
  const value = await send("shopifyAuditProductDetails", { productIds, ...forShop(requestedShop) });
  if (!value || typeof value !== "object") throw new Error("Shopify returned invalid product details.");
  const result = value as { shop?: unknown; products?: unknown };
  if (typeof result.shop !== "string" || normalizeShopifyShopInput(result.shop) !== result.shop
    || !Array.isArray(result.products) || result.products.length > MAX_COMPARE_PRODUCTS) {
    throw new Error("Shopify returned invalid product details.");
  }
  const shop = result.shop;
  const products = result.products.map((item: unknown): ShopifyProductDetails => {
    const product = (item && typeof item === "object" ? item : {}) as Partial<ShopifyProductDetails>;
    if (typeof product.id !== "string" || !productIds.includes(product.id) || typeof product.title !== "string"
      || typeof product.status !== "string" || typeof product.totalInventory !== "number" || !Number.isInteger(product.totalInventory)
      || typeof product.url !== "string" || !validShopifyAdminProductUrl(product.url, shop)
      || !Array.isArray(product.images) || !product.images.every((url) => typeof url === "string" && validImageUrl(url))
      || (product.currencyCode !== null && (typeof product.currencyCode !== "string" || !/^[A-Z]{3}$/.test(product.currencyCode)))
      || !optionalAmount(product.minPrice) || !optionalAmount(product.maxPrice)
      || !optionalText(product.condition, 200) || !optionalText(product.vendor, 255) || !optionalText(product.productType, 255)
      || typeof product.descriptionHtml !== "string" || !Array.isArray(product.variants)
      || !product.variants.every((variant) => variant && typeof variant.id === "string" && typeof variant.title === "string"
        && optionalText(variant.sku, 255) && optionalAmount(variant.price))) {
      throw new Error("Shopify returned an invalid product.");
    }
    return product as ShopifyProductDetails;
  });
  return { shop, products };
}

export async function searchShopifyProducts(query: string, shop?: string): Promise<ShopifySearchResult> {
  const value = await send("shopifyAuditSearchProducts", { query, ...forShop(shop) });
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

export type ShopifyHiddenProduct = { id: string; title: string };

export async function listHiddenShopifyProducts(shop?: string): Promise<ShopifyHiddenProduct[]> {
  const value = await send("shopifyAuditHiddenProducts", forShop(shop));
  if (!Array.isArray(value)) throw new Error("Shopify returned an invalid hidden product list.");
  return value.map((item: unknown) => {
    const product = (item ?? {}) as Partial<ShopifyHiddenProduct>;
    if (typeof product.id !== "string" || typeof product.title !== "string") throw new Error("Shopify returned an invalid hidden product.");
    return { id: product.id, title: product.title };
  });
}

export async function setShopifyProductHidden(product: ShopifyHiddenProduct, hidden: boolean, shop?: string): Promise<void> {
  await send("shopifyAuditSetProductHidden", { productId: product.id, title: product.title, hidden, ...forShop(shop) });
}
