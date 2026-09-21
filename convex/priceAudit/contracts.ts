import { v, type Infer } from "convex/values";

export const itemValidator = v.object({
  id: v.string(), title: v.string(), variant: v.string(), sku: v.string(),
  description: v.string(), url: v.string(), priceCents: v.number(), currency: v.literal("USD"),
});
const comparableValidator = v.object({
  id: v.string(), url: v.string(), text: v.string(), priceCents: v.number(), confidence: v.number(),
});
const candidateValidator = v.object({
  id: v.string(), url: v.string(), text: v.string(),
  prices: v.array(v.object({ id: v.string(), text: v.string(), cents: v.number() })),
});
export const requestValidator = v.union(
  v.object({ kind: v.literal("reviewItem"), item: itemValidator }),
  v.object({ kind: v.literal("chooseQuery"), item: itemValidator }),
  v.object({ kind: v.literal("selectComparables"), item: itemValidator, candidates: v.array(candidateValidator) }),
  v.object({ kind: v.literal("verifyResult"), item: itemValidator, comparables: v.array(comparableValidator) }),
  v.object({ kind: v.literal("chooseNextPage"), links: v.array(v.object({ id: v.string(), text: v.string(), url: v.string() })) }),
);
export const resultValidator = v.union(
  v.object({ kind: v.literal("reviewItem"), accepted: v.boolean() }),
  v.object({ kind: v.literal("chooseQuery"), query: v.union(v.string(), v.null()) }),
  v.object({ kind: v.literal("selectComparables"), comparables: v.array(comparableValidator) }),
  v.object({ kind: v.literal("verifyResult"), verified: v.boolean() }),
  v.object({ kind: v.literal("chooseNextPage"), url: v.union(v.string(), v.null()) }),
);
export type AuditRequest = Infer<typeof requestValidator>;
export type AuditDecisionResult = Infer<typeof resultValidator>;

export function validAuditRequest(request: AuditRequest): boolean {
  if (JSON.stringify(request).length > 60_000) return false;
  if ("item" in request) {
    const item = request.item;
    if (!item.title.trim() || item.title.length > 500 || item.variant.length > 300 ||
        item.description.length > 8000 || item.sku.length > 200 || item.id.length > 100 ||
        item.url.length > 2048 || !Number.isSafeInteger(item.priceCents) || item.priceCents < 0) return false;
    try {
      const url = new URL(item.url);
      if (url.protocol !== "https:" || url.username || url.password || !url.pathname.startsWith("/products/")) return false;
    } catch { return false; }
  }
  if (request.kind === "selectComparables" || request.kind === "verifyResult") {
    const listings = request.kind === "selectComparables" ? request.candidates : request.comparables;
    if (listings.length < 1 || listings.length > 6) return false;
    for (const listing of listings) {
      if (!/^\d{9,15}$/.test(listing.id) || listing.url !== `https://www.ebay.com/itm/${listing.id}` || listing.text.length > 4500) return false;
    }
  }
  if (request.kind === "selectComparables") {
    return request.candidates.every((candidate) => candidate.prices.length > 0 && candidate.prices.length <= 16 &&
      candidate.prices.every((price) => price.id.length <= 40 && price.text.length <= 100 && Number.isSafeInteger(price.cents) && price.cents > 0));
  }
  if (request.kind === "verifyResult") {
    return request.comparables.every((item) => Number.isSafeInteger(item.priceCents) && item.priceCents > 0 &&
      Number.isFinite(item.confidence) && item.confidence >= 0.85 && item.confidence <= 1);
  }
  if (request.kind === "chooseNextPage") {
    return request.links.length > 0 && request.links.length <= 20 && request.links.every((link) => {
      if (link.id.length > 40 || link.text.length > 200 || link.url.length > 2048) return false;
      try {
        const url = new URL(link.url);
        return url.origin === "https://www.ebay.com" && !url.username && !url.password &&
          url.pathname === "/sch/i.html" && url.searchParams.get("LH_Sold") === "1" && url.searchParams.get("LH_Complete") === "1";
      } catch { return false; }
    });
  }
  return true;
}
