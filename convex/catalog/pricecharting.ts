import { normalizeUPCA } from "../aiScanner";
import { isAuthorizedPriceChartingGameUrl } from "./hosts";
import { collapseWhitespace, parseProductIdentity } from "./parseTitle";
import type { CatalogListing, CatalogProduct } from "./types";

// PriceCharting game pages expose a flat details table
// (<div id="full_details"><table id="attribute">...) with one label/value
// row per spec. The parser reads that table plus the page heading and cover
// image; everything else on the page is marketplace pricing and is
// deliberately ignored.
const H1 = /<h1\b[^>]*id="product_name"[^>]*>([\s\S]*?)<\/h1>/i;
const H1_TITLE_ATTRIBUTE = /\btitle="(\d+)"/i;
const ANCHOR = /<a\b[^>]*>([\s\S]*?)<\/a>/i;
const CONSOLE_HREF = /href="(?:https:\/\/www\.pricecharting\.com)?\/console\/([a-z0-9-]+)"/i;
const FULL_DETAILS = /id="full_details"[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i;
const DETAILS_ROW = /<td\b[^>]*class="title"[^>]*>([\s\S]*?)<\/td>\s*<td\b[^>]*class="details"[^>]*>([\s\S]*?)<\/td>/gi;
const COVER_IMAGE = /id="product_details"[\s\S]{0,4000}?<img\b[^>]*src=['"]([^'"]+)['"]/i;
const YEAR = /(?:19|20)\d{2}/;

export type PriceChartingGameRecord = {
  sourceUrl: string;
  upc: string;
  title: string;
  consoleName: string | null;
  consoleSlug: string | null;
  genre: string | null;
  releaseDate: string | null;
  esrbRating: string | null;
  publisher: string | null;
  developer: string | null;
  modelNumber: string | null;
  playerCount: string | null;
  alsoCompatibleOn: string | null;
  notes: string | null;
  asin: string | null;
  epid: string | null;
  priceChartingId: string | null;
  imageUrl: string | null;
};

export type PriceChartingMapping = {
  products: CatalogProduct[];
  skippedNoUpc: number;
  skippedNoTitle: number;
  skippedInvalidSource: number;
};

function decodeHtml(value: string): string {
  return collapseWhitespace(
    value
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => entityCharacter(hex, 16))
      .replace(/&#(\d+);/g, (_match, dec: string) => entityCharacter(dec, 10))
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">"),
  );
}

// PriceCharting encodes characters like + ('&#43;') and curly apostrophes
// ('&#8217;') directly in page text, and those characters materially change
// title matching, so numeric entities are decoded alongside the named ones.
function entityCharacter(rawCode: string, radix: number): string {
  const code = Number.parseInt(rawCode, radix);
  if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return " ";
  return String.fromCodePoint(code);
}

// The attribute table is one flat label/value list, so a row scan over the
// bounded table chunk cannot pick up the price tables outside it.
export function parseGamePage(html: string, sourceUrl: string): PriceChartingGameRecord | null {
  const h1Match = html.match(H1);
  if (!h1Match) return null;
  const h1 = h1Match[1] ?? "";

  const title = decodeHtml(h1.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, " "));
  if (!title) return null;

  const consoleAnchor = h1.match(ANCHOR)?.[1];
  const consoleName = consoleAnchor ? decodeHtml(consoleAnchor) : null;
  const consoleSlug = h1.match(CONSOLE_HREF)?.[1] ?? null;

  const idAttribute = h1Match[0].match(H1_TITLE_ATTRIBUTE);

  const details = html.match(FULL_DETAILS)?.[1] ?? "";
  const specs = new Map<string, string>();
  for (const match of details.matchAll(DETAILS_ROW)) {
    const label = decodeHtml(match[1] ?? "").replace(/:$/, "");
    const value = decodeHtml(match[2] ?? "");
    if (label && value && !specs.has(label)) specs.set(label, value);
  }

  const upc = normalizeUPCA(specs.get("UPC") ?? "");
  if (!upc) return null;

  const cover = html.match(COVER_IMAGE)?.[1] ?? null;
  const imageUrl = cover === null
    ? null
    : cover.startsWith("http")
      ? cover
      : cover.startsWith("//")
        ? `https:${cover}`
        : `https://www.pricecharting.com${cover}`;

  return {
    sourceUrl,
    upc,
    title,
    consoleName,
    consoleSlug,
    genre: specs.get("Genre") ?? null,
    releaseDate: specs.get("Release Date") ?? null,
    esrbRating: specs.get("ESRB Rating") ?? null,
    publisher: specs.get("Publisher") ?? null,
    developer: specs.get("Developer") ?? null,
    modelNumber: specs.get("Model Number") ?? null,
    playerCount: specs.get("Player Count") ?? null,
    alsoCompatibleOn: specs.get("Also Compatible On") ?? null,
    notes: specs.get("Notes") ?? null,
    asin: specs.get("ASIN (Amazon)") ?? null,
    epid: specs.get("ePID (eBay)") ?? null,
    priceChartingId: idAttribute?.[1] ?? specs.get("PriceCharting ID") ?? null,
    imageUrl,
  };
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = collapseWhitespace(value);
  return cleaned.length > 0 ? cleaned : null;
}

function attributesFrom(record: Record<string, unknown>): Record<string, string> {
  const attributes: Record<string, string> = {};
  const candidates: Array<[string, unknown]> = [
    ["asin", record.asin],
    ["epid", record.epid],
    ["developer", record.developer],
    ["playerCount", record.playerCount],
    ["alsoCompatibleOn", record.alsoCompatibleOn],
    ["notes", record.notes],
    ["priceChartingId", record.priceChartingId],
    ["releaseDate", record.releaseDate],
  ];
  for (const [key, value] of candidates) {
    const text = readString(value);
    if (text) attributes[key] = text;
  }
  return attributes;
}

export function mapPriceChartingGameRecord(record: unknown): MappedRecord {
  const item = record && typeof record === "object" && !Array.isArray(record)
    ? (record as Record<string, unknown>)
    : {};

  const sourceUrl = readString(item.sourceUrl);
  if (!sourceUrl || !isAuthorizedPriceChartingGameUrl(sourceUrl)) return { skipped: "invalid-source" };

  const title = readString(item.title);
  if (!title) return { skipped: "no-title" };

  const upc = normalizeUPCA(readString(item.upc) ?? "");
  if (!upc) return { skipped: "no-upc" };

  const consoleName = readString(item.consoleName);
  const consoleSlug = readString(item.consoleSlug);
  const edition = parseProductIdentity(title).edition;

  const listing: CatalogListing = { sourceUrl };
  const imageUrl = readString(item.imageUrl);
  if (imageUrl) listing.imageUrl = imageUrl;

  const product: CatalogProduct = {
    upc,
    title,
    platform: consoleName,
    edition: edition ?? null,
    collection: consoleSlug,
    brand: readString(item.publisher),
    model: readString(item.modelNumber),
    mpn: readString(item.modelNumber),
    color: null,
    storage: null,
    carrier: null,
    publisher: readString(item.publisher),
    genre: readString(item.genre),
    rating: readString(item.esrbRating),
    releaseYear: readString(item.releaseDate)?.match(YEAR)?.[0] ?? null,
    attributes: attributesFrom(item),
    collections: consoleName ? [consoleName] : [],
    sourceUrls: [sourceUrl],
    listings: [listing],
  };
  return { product };
}

type MappedRecord = { product: CatalogProduct } | { skipped: "no-upc" | "no-title" | "invalid-source" };

export function mapPriceChartingGameDetails(items: unknown[]): PriceChartingMapping {
  const products: CatalogProduct[] = [];
  let skippedNoUpc = 0;
  let skippedNoTitle = 0;
  let skippedInvalidSource = 0;
  for (const item of items) {
    const mapped = mapPriceChartingGameRecord(item);
    if ("product" in mapped) products.push(mapped.product);
    else if (mapped.skipped === "no-upc") skippedNoUpc += 1;
    else if (mapped.skipped === "no-title") skippedNoTitle += 1;
    else skippedInvalidSource += 1;
  }
  return { products, skippedNoUpc, skippedNoTitle, skippedInvalidSource };
}
