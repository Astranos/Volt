import { decimalCents } from "./catalog.ts";
import type { ListingCandidate, PriceCandidate } from "./types.ts";

export type SearchPage = {
  url: string;
  candidates: ListingCandidate[];
  nextLinks: { id: string; text: string; url: string }[];
  noResults: boolean;
  truncated: boolean;
};

export function soldSearchUrl(query: string): string {
  const url = new URL("https://www.ebay.com/sch/i.html");
  url.search = new URLSearchParams({ _nkw: query, LH_Sold: "1", LH_Complete: "1", _ipg: "60", _sop: "13", _pgn: "1" }).toString();
  return url.href;
}

export function isSoldSearch(value: string): boolean {
  try {
    const url = new URL(value);
    return url.origin === "https://www.ebay.com" && !url.username && !url.password &&
      url.pathname === "/sch/i.html" && url.searchParams.get("LH_Sold") === "1" &&
      url.searchParams.get("LH_Complete") === "1";
  } catch { return false; }
}

export function sameSearch(expected: string, actual: string): boolean {
  if (!isSoldSearch(expected) || !isSoldSearch(actual)) return false;
  const a = new URL(expected), b = new URL(actual);
  for (const url of [a, b]) {
    if (!url.searchParams.has("_pgn")) url.searchParams.set("_pgn", "1");
    url.searchParams.sort();
  }
  // Full query equality protects user changes to category, condition, sort and currency too.
  return a.searchParams.toString() === b.searchParams.toString();
}

export function validNextPage(current: string, next: string): boolean {
  if (!isSoldSearch(current) || !isSoldSearch(next)) return false;
  const a = new URL(current), b = new URL(next);
  return a.searchParams.get("_nkw") === b.searchParams.get("_nkw") &&
    Number(b.searchParams.get("_pgn")) === Number(a.searchParams.get("_pgn") ?? "1") + 1;
}

export function ebayItemUrl(value: string): { id: string; url: string } | null {
  try {
    const url = new URL(value);
    if (url.origin !== "https://www.ebay.com" || url.username || url.password) return null;
    const match = url.pathname.match(/^\/itm\/(?:[^/]+\/)?(\d{9,15})\/?$/);
    return match?.[1] ? { id: match[1], url: `https://www.ebay.com/itm/${match[1]}` } : null;
  } catch { return null; }
}

export function usdPriceCandidates(texts: string[]): PriceCandidate[] {
  const result: PriceCandidate[] = [];
  for (const text of texts) {
    const value = text.trim();
    // Accept one exact item price, not ranges, financing, discounts, shipping or converted currencies.
    const match = value.match(/^(?:US\s*\$|USD\s*\$?|\$)\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)$/);
    if (!match?.[1]) continue;
    const cents = decimalCents(match[1].replaceAll(",", ""));
    if (cents === null || cents <= 0 || result.some((p) => p.cents === cents)) continue;
    result.push({ id: `price_${result.length}`, text: value, cents });
  }
  return result;
}

export function eligibleSoldText(text: string): boolean {
  return /\bSold\s+(?:[A-Za-z]{3,9}\s+\d{1,2}|\d{1,2}\s+[A-Za-z]{3,9})[,]?\s+\d{4}\b/.test(text) &&
    !/best offer accepted|price not available|sold price unavailable|(?:C|AU|CA|NZ|HK)\s*\$|\b(?:CAD|AUD|GBP|EUR|JPY)\b|[£€¥]/i.test(text);
}
