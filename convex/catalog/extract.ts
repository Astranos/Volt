import { normalizeUPCA } from "../aiScanner";
import {
  omitProductAttributeKeys,
  pickProductAttribute,
  splitSpecAttributes,
  type ProductAttributeKey,
} from "./attributes";
import { isAuthorizedPayMoreProductUrl, productPageUrl } from "./hosts";
import { collapseWhitespace, parseProductIdentity } from "./parseTitle";
import type { CatalogListing, CatalogProduct, ExtractResult, RejectedListing } from "./types";

const SPEC_ROW =
  /<tr\b[^>]*>\s*<td\b[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi;
const JSON_LD_SCRIPT = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const H1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i;
const TITLE_TAG = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
const SKU_TEXT = /\bSKU:\s*([A-Z0-9][A-Z0-9-]*)/i;

function decodeHtml(value: string): string {
  return collapseWhitespace(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">"),
  );
}

function objectFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = collapseWhitespace(value);
  return cleaned ? cleaned : null;
}

function specEntries(html: string): Array<[string, string]> {
  const specs: Array<[string, string]> = [];
  for (const match of html.matchAll(SPEC_ROW)) {
    const label = decodeHtml(match[1] ?? "");
    const value = decodeHtml(match[2] ?? "");
    if (label && value) specs.push([label, value]);
  }
  return specs;
}

function jsonLdProducts(html: string): Array<Record<string, unknown>> {
  const products: Array<Record<string, unknown>> = [];
  for (const match of html.matchAll(JSON_LD_SCRIPT)) {
    try {
      const parsed: unknown = JSON.parse(match[1] ?? "");
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const record = objectFrom(node);
        const graph = record["@graph"];
        if (Array.isArray(graph)) {
          for (const item of graph) {
            const nested = objectFrom(item);
            if (String(nested["@type"] ?? "").toLowerCase() === "product") products.push(nested);
          }
          continue;
        }
        if (String(record["@type"] ?? "").toLowerCase() === "product") products.push(record);
      }
    } catch {
      // Ignore malformed JSON-LD blocks and keep scanning the rest of the page.
    }
  }
  return products;
}

function jsonLdSpecEntries(jsonLd: Record<string, unknown>): Array<[string, string]> {
  const raw = jsonLd.additionalProperty;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const specs: Array<[string, string]> = [];
  for (const item of items) {
    const property = objectFrom(item);
    const label = readString(property.name);
    const value = readString(property.value);
    if (label && value) specs.push([label, value]);
  }
  const brand = objectFrom(jsonLd.brand);
  const brandName = readString(brand.name) ?? readString(jsonLd.brand);
  if (brandName) specs.push(["Brand", brandName]);
  const model = readString(jsonLd.model);
  if (model) specs.push(["Model", model]);
  const color = readString(jsonLd.color);
  if (color) specs.push(["Color", color]);
  const mpn = readString(jsonLd.mpn);
  if (mpn) specs.push(["MPN", mpn]);
  return specs;
}

function firstUpc(values: Array<string | null | undefined>): { upc: string | null; sawCandidate: boolean } {
  let sawCandidate = false;
  for (const value of values) {
    if (!value) continue;
    sawCandidate = true;
    const upc = normalizeUPCA(value);
    if (upc) return { upc, sawCandidate };
  }
  return { upc: null, sawCandidate };
}

function headingTitle(html: string): string | null {
  const heading = html.match(H1)?.[1];
  if (heading) {
    const title = decodeHtml(heading);
    if (title) return title;
  }
  const documentTitle = html.match(TITLE_TAG)?.[1];
  if (!documentTitle) return null;
  return decodeHtml(documentTitle.replace(/\s+[–-]\s+PayMore.*$/i, ""));
}

function productFieldsFromAttributes(attributes: Record<string, string>) {
  const pick = (key: ProductAttributeKey) => pickProductAttribute(attributes, key);
  return {
    collection: pick("collection"),
    brand: pick("brand"),
    model: pick("model"),
    mpn: pick("mpn"),
    color: pick("color"),
    storage: pick("storage"),
    carrier: pick("carrier"),
    publisher: pick("publisher"),
    genre: pick("genre"),
    rating: pick("rating"),
    releaseYear: pick("releaseYear"),
    attributes: omitProductAttributeKeys(attributes),
  };
}

function listingFromFields(
  sourceUrl: string,
  fields: {
    title?: string | null;
    gameName?: string | null;
    platform?: string | null;
    upcValues: Array<string | null | undefined>;
    specs?: Iterable<[string, string]>;
  },
): CatalogProduct | RejectedListing {
  const parsedGame = fields.gameName ? parseProductIdentity(fields.gameName) : null;
  const parsedTitle = fields.title ? parseProductIdentity(fields.title) : null;
  const title = parsedGame?.title || parsedTitle?.title || "";
  const platform = fields.platform || parsedGame?.platform || parsedTitle?.platform || null;
  const edition = parsedGame?.edition || parsedTitle?.edition || null;
  const { upc, sawCandidate } = firstUpc(fields.upcValues);
  const split = splitSpecAttributes(fields.specs ?? []);
  const listing: CatalogListing = { sourceUrl };

  if (!title) return { sourceUrl, reason: "missing-title" };
  if (!upc) return { sourceUrl, reason: sawCandidate ? "invalid-upc" : "missing-upc" };
  return {
    upc,
    title,
    platform,
    edition,
    ...productFieldsFromAttributes(split.product),
    sourceUrls: [sourceUrl],
    listings: [listing],
  };
}

function isRejected(value: CatalogProduct | RejectedListing): value is RejectedListing {
  return "reason" in value;
}

export function extractFromHtml(html: string, sourceUrl: string): ExtractResult {
  if (!isAuthorizedPayMoreProductUrl(sourceUrl)) {
    return { products: [], rejected: [{ sourceUrl, reason: "unauthorized-host" }] };
  }

  const specs = specEntries(html);
  const specMap = new Map(specs.map(([label, value]) => [label.toLowerCase(), value]));
  const jsonLd = jsonLdProducts(html)[0] ?? {};
  const sku = html.match(SKU_TEXT)?.[1];
  if (sku) specs.push(["SKU", sku]);
  specs.push(...jsonLdSpecEntries(jsonLd));

  const listing = listingFromFields(sourceUrl, {
    title: headingTitle(html) ?? readString(jsonLd.name),
    gameName: specMap.get("game name"),
    platform: specMap.get("platform"),
    upcValues: [
      specMap.get("upc"),
      specMap.get("upc/barcode"),
      specMap.get("barcode"),
      specMap.get("gtin"),
      specMap.get("gtin-12"),
      specMap.get("gtin12"),
      readString(jsonLd.gtin12),
      readString(jsonLd.gtin13),
      readString(jsonLd.gtin),
    ],
    specs,
  });

  if (isRejected(listing)) return { products: [], rejected: [listing] };
  return { products: [listing], rejected: [] };
}

type ShopifyProduct = {
  title?: unknown;
  handle?: unknown;
  vendor?: unknown;
  product_type?: unknown;
  body_html?: unknown;
  variants?: unknown;
};

function shopifyBarcode(variants: unknown): string | null {
  if (!Array.isArray(variants)) return null;
  for (const variant of variants) {
    const barcode = readString(objectFrom(variant).barcode);
    if (barcode) return barcode;
  }
  return null;
}

function shopifySku(variants: unknown): string | null {
  if (!Array.isArray(variants)) return null;
  for (const variant of variants) {
    const sku = readString(objectFrom(variant).sku);
    if (sku) return sku;
  }
  return null;
}

function enrichWithSpecs(product: CatalogProduct, extraSpecs: Array<[string, string]>): CatalogProduct {
  if (extraSpecs.length === 0) return product;
  const split = splitSpecAttributes(extraSpecs);
  const extraFields = productFieldsFromAttributes(split.product);
  return {
    ...product,
    collection: product.collection ?? extraFields.collection,
    brand: product.brand ?? extraFields.brand,
    model: product.model ?? extraFields.model,
    mpn: product.mpn ?? extraFields.mpn,
    color: product.color ?? extraFields.color,
    storage: product.storage ?? extraFields.storage,
    carrier: product.carrier ?? extraFields.carrier,
    publisher: product.publisher ?? extraFields.publisher,
    genre: product.genre ?? extraFields.genre,
    rating: product.rating ?? extraFields.rating,
    releaseYear: product.releaseYear ?? extraFields.releaseYear,
    attributes: { ...extraFields.attributes, ...product.attributes },
  };
}
function extractShopifyProduct(product: ShopifyProduct, sourceUrl: string): ExtractResult {
  const handle = readString(product.handle);
  const pageUrl = handle ? productPageUrl(sourceUrl, handle) : sourceUrl;
  if (!pageUrl || !isAuthorizedPayMoreProductUrl(pageUrl)) {
    return { products: [], rejected: [{ sourceUrl, reason: "unauthorized-host" }] };
  }

  const body = typeof product.body_html === "string" ? product.body_html : "";
  const extraSpecs: Array<[string, string]> = [];
  const vendor = readString(product.vendor);
  if (vendor && !/^paymore\b/i.test(vendor)) extraSpecs.push(["Brand", vendor]);
  const productType = readString(product.product_type);
  if (productType) extraSpecs.push(["Collection", productType]);
  const sku = shopifySku(product.variants);
  if (sku) extraSpecs.push(["SKU", sku]);

  const fromBody = body
    ? extractFromHtml(body, pageUrl)
    : { products: [] as CatalogProduct[], rejected: [] as RejectedListing[] };
  if (fromBody.products[0]) {
    return { products: [enrichWithSpecs(fromBody.products[0], extraSpecs)], rejected: [] };
  }

  const listing = listingFromFields(pageUrl, {
    title: readString(product.title),
    upcValues: [shopifyBarcode(product.variants)],
    specs: extraSpecs,
  });
  if (isRejected(listing)) {
    const rejected = fromBody.rejected[0] && fromBody.rejected[0].reason !== "missing-title"
      ? fromBody.rejected[0]
      : listing;
    return { products: [], rejected: [rejected] };
  }
  return { products: [listing], rejected: [] };
}

export function extractFromShopifyJson(raw: string, sourceUrl: string): ExtractResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 200) : "malformed JSON";
    return { products: [], rejected: [{ sourceUrl, reason: "invalid-json", detail }] };
  }

  const root = objectFrom(parsed);
  const products = Array.isArray(root.products)
    ? root.products
    : root.product
      ? [root.product]
      : [parsed];

  const extracted: CatalogProduct[] = [];
  const rejected: RejectedListing[] = [];
  for (const product of products) {
    const result = extractShopifyProduct(objectFrom(product), sourceUrl);
    extracted.push(...result.products);
    rejected.push(...result.rejected);
  }
  return { products: extracted, rejected };
}

export function extractFromDocument(body: string, sourceUrl: string): ExtractResult {
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return extractFromShopifyJson(trimmed, sourceUrl);
  }
  return extractFromHtml(body, sourceUrl);
}
