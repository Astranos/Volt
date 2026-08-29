import { dedupeProducts } from "./dedupe";
import { extractFromDocument } from "./extract";
import { isAuthorizedPayMoreCatalogUrl } from "./hosts";
import type { CrawlResult, PageInput, RejectedListing } from "./types";

const PAGE_DELAY_MS = 500;
const REQUEST_TIMEOUT_MS = 15_000;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_FETCH_ATTEMPTS = 3;
const USER_AGENT =
  "VoltCatalogBot/1.0 (+https://paymore.com; respectful crawler for personal price tracking)";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function crawlSavedPages(pages: PageInput[]): CrawlResult {
  const rejected: RejectedListing[] = [];
  const extracted: CrawlResult["products"] = [];
  for (const page of pages) {
    const result = extractFromDocument(page.body, page.sourceUrl);
    extracted.push(...result.products);
    rejected.push(...result.rejected);
  }
  return { products: dedupeProducts(extracted), rejected, fetched: pages.length };
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function fetchWithRetry(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<{ ok: true; body: string } | { ok: false; detail: string }> {
  let lastDetail = "unknown error";
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT, ...headers },
        signal: timeoutSignal(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return { ok: true, body: await response.text() };
      lastDetail = `HTTP ${response.status}`;
      if (!isRetryableStatus(response.status)) return { ok: false, detail: lastDetail };
    } catch (error) {
      lastDetail =
        error instanceof Error && error.name === "TimeoutError"
          ? `timeout after ${REQUEST_TIMEOUT_MS}ms`
          : error instanceof Error
            ? error.message
            : "network error";
    }
    if (attempt < MAX_FETCH_ATTEMPTS) await sleep(PAGE_DELAY_MS * attempt);
  }
  return { ok: false, detail: lastDetail };
}

export async function crawlAuthorizedUrls(
  urls: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<CrawlResult> {
  const pages: PageInput[] = [];
  const rejected: RejectedListing[] = [];
  let fetchedCount = 0;
  for (const url of urls) {
    if (!isAuthorizedPayMoreCatalogUrl(url)) {
      rejected.push({ sourceUrl: url, reason: "unauthorized-host" });
      continue;
    }
    if (fetchedCount > 0) await sleep(PAGE_DELAY_MS);
    const response = await fetchWithRetry(url, { Accept: "text/html, application/json" }, fetchImpl);
    if (!response.ok) {
      rejected.push({ sourceUrl: url, reason: "fetch-failed", detail: response.detail });
      continue;
    }
    pages.push({ sourceUrl: url, body: response.body });
    fetchedCount += 1;
  }
  const crawled = crawlSavedPages(pages);
  return {
    products: crawled.products,
    rejected: [...rejected, ...crawled.rejected],
    fetched: crawled.fetched,
  };
}

function collectionPageHasProducts(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const products = (parsed as { products?: unknown }).products;
    return Array.isArray(products) && products.length > 0;
  } catch {
    return true;
  }
}

export async function crawlAuthorizedCollectionPages(
  collectionJsonUrl: string,
  pageCount: number,
  fetchImpl: typeof fetch = fetch,
): Promise<CrawlResult> {
  if (!isAuthorizedPayMoreCatalogUrl(collectionJsonUrl)) {
    return {
      products: [],
      rejected: [{ sourceUrl: collectionJsonUrl, reason: "unauthorized-host" }],
      fetched: 0,
    };
  }

  const pages: PageInput[] = [];
  const rejected: RejectedListing[] = [];
  const limit = Math.max(1, Math.min(pageCount, 5));
  for (let page = 1; page <= limit; page += 1) {
    if (page > 1) await sleep(PAGE_DELAY_MS);
    const url = new URL(collectionJsonUrl);
    url.searchParams.set("limit", "30");
    url.searchParams.set("page", String(page));
    const pageUrl = url.toString();
    const response = await fetchWithRetry(pageUrl, { Accept: "application/json" }, fetchImpl);
    if (!response.ok) {
      rejected.push({ sourceUrl: pageUrl, reason: "fetch-failed", detail: response.detail });
      break;
    }
    pages.push({ sourceUrl: pageUrl, body: response.body });
    if (!collectionPageHasProducts(response.body)) break;
  }
  const crawled = crawlSavedPages(pages);
  return {
    products: crawled.products,
    rejected: [...rejected, ...crawled.rejected],
    fetched: crawled.fetched,
  };
}
