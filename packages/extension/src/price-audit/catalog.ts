import type { AuditItem } from "./types.ts";

export const CATALOG_PAGE_SIZE = 250;
export const MAX_CATALOG_PAGES = 20;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): string {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  throw new Error("Shopify returned an invalid product or variant ID.");
}

export function storeOrigin(value: string): string {
  const input = value.trim();
  const address = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    if (input.startsWith("/") || input.includes("\\")) throw new Error();
    url = new URL(address);
  } catch { throw new Error("Enter a public storefront domain or HTTPS address."); }
  // This is a public-storefront reader, never an admin or local-network reader.
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/i.test(url.hostname) ||
      url.hostname === "admin.shopify.com" || /^\/admin(?:\/|$)/.test(url.pathname)) {
    throw new Error("Use a public HTTPS Shopify storefront, not an admin or local address.");
  }
  return url.origin;
}

export function decimalCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

export function parseCatalogPage(text: string, origin: string): { productIds: string[]; items: AuditItem[] } {
  if (text.length > 8 * 1024 * 1024) throw new Error("The Shopify catalog page is too large.");
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error("This storefront did not expose a readable Shopify products.json catalog."); }
  if (!record(data) || !Array.isArray(data.products) || data.products.length > CATALOG_PAGE_SIZE) {
    throw new Error("Shopify returned an unexpected catalog format.");
  }
  const items: AuditItem[] = [];
  const productIds: string[] = [];
  const variantIds = new Set<string>();
  for (const product of data.products) {
    if (!record(product) || typeof product.title !== "string" || !product.title.trim() ||
        typeof product.handle !== "string" || !product.handle ||
        !Array.isArray(product.variants) || !product.variants.length ||
        (product.body_html !== null && typeof product.body_html !== "string")) {
      throw new Error("A Shopify product is missing required fields. The catalog is incomplete.");
    }
    const productId = identifier(product.id);
    productIds.push(productId);
    for (const variant of product.variants) {
      if (!record(variant) || typeof variant.available !== "boolean" ||
          typeof variant.title !== "string" || typeof variant.price !== "string" ||
          (variant.sku !== undefined && variant.sku !== null && typeof variant.sku !== "string")) {
        throw new Error("A Shopify variant is missing availability or price information.");
      }
      const id = identifier(variant.id);
      if (variantIds.has(id)) throw new Error("Shopify returned duplicate variants.");
      variantIds.add(id);
      const priceCents = decimalCents(variant.price);
      if (priceCents === null) throw new Error("Shopify returned an invalid price.");
      if (!variant.available) continue;
      items.push({
        id: `${productId}:${id}`,
        title: product.title.trim().slice(0, 500),
        variant: variant.title === "Default Title" ? "" : variant.title.slice(0, 300),
        sku: typeof variant.sku === "string" ? variant.sku.slice(0, 200) : "",
        // Kept as inert source text, never inserted into the DOM as HTML.
        description: typeof product.body_html === "string" ? product.body_html.slice(0, 8000) : "",
        url: `${origin}/products/${encodeURIComponent(product.handle)}?variant=${id}`,
        priceCents,
        currency: "USD",
      });
    }
  }
  return { productIds, items };
}

export async function collectCatalog(
  origin: string,
  readPage: (url: string) => Promise<string>,
  onPage: (page: number, items: number) => void,
): Promise<AuditItem[]> {
  const seen = new Set<string>();
  const items: AuditItem[] = [];
  for (let page = 1; page <= MAX_CATALOG_PAGES; page++) {
    const text = await readPage(`${origin}/products.json?limit=${CATALOG_PAGE_SIZE}&page=${page}`);
    const parsed = parseCatalogPage(text, origin);
    for (const id of parsed.productIds) {
      if (seen.has(id)) throw new Error("Shopify repeated a catalog page. Stopped to avoid reporting an incomplete scan.");
      seen.add(id);
    }
    items.push(...parsed.items);
    onPage(page, items.length);
    if (parsed.productIds.length < CATALOG_PAGE_SIZE) return items;
  }
  throw new Error("The catalog exceeded 5,000 products. No complete catalog was established.");
}
