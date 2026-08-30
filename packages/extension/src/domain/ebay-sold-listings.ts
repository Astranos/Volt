export type EbayListingState = "sold" | "completed" | "active" | "unknown";

export function isEbaySearchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "www.ebay.com" && url.pathname.startsWith("/sch/");
  } catch {
    return false;
  }
}

export function getEbayListingState(value: string): EbayListingState {
  if (!isEbaySearchUrl(value)) return "unknown";

  const url = new URL(value);
  const sold = url.searchParams.get("LH_Sold");
  const completed = url.searchParams.get("LH_Complete");

  if (sold === "1" || sold === "true") return "sold";
  if (completed === "1" || completed === "true") return "completed";
  return "active";
}

export function buildEbaySoldListingsUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.set("LH_Sold", "1");
  url.searchParams.set("LH_Complete", "1");
  return url.toString();
}

export function getPrimaryEbayPriceElements(
  prices: readonly HTMLElement[]
): HTMLElement[] {
  const primaryRow = prices[0]?.parentElement;
  if (!primaryRow) return [];

  return prices.filter((price) => price.parentElement === primaryRow);
}
