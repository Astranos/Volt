import type { ShopifySearchProduct } from "../../shopify-audit/client";

export type ShopifyResultSort = "relevance" | "price-asc" | "price-desc";
export type ShopifyResultFilters = { inStockOnly: boolean; condition: string | null; sort: ShopifyResultSort };
export const DEFAULT_SHOPIFY_RESULT_FILTERS: ShopifyResultFilters = { inStockOnly: false, condition: null, sort: "relevance" };

// "Used - Excellent", "Used: Good", and "used (fair)" are all "Used".
export function conditionGroup(condition: string | null): string | null {
  const head = condition?.split(/\s+[-–—|]\s+|\s*[:(]/)[0]?.trim();
  if (!head) return null;
  return head.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Condition groups present in these results, most common first. */
export function conditionOptions(products: readonly ShopifySearchProduct[]): string[] {
  const counts = new Map<string, number>();
  for (const product of products) {
    const group = conditionGroup(product.condition);
    if (group) counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([group]) => group);
}

/** Filters and sorts the products Shopify returned; relevance keeps Shopify's in-stock-first order. */
export function applyShopifyResultFilters(products: readonly ShopifySearchProduct[], filters: ShopifyResultFilters): ShopifySearchProduct[] {
  const shown = products.filter((product) => (!filters.inStockOnly || product.totalInventory > 0)
    && (!filters.condition || conditionGroup(product.condition) === filters.condition));
  if (filters.sort === "relevance") return shown;
  const direction = filters.sort === "price-asc" ? 1 : -1;
  // Products without a price go last either way.
  const price = (product: ShopifySearchProduct) => (product.price === null ? null : Number(product.price));
  return [...shown].sort((a, b) => {
    const left = price(a);
    const right = price(b);
    if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
    return (left - right) * direction;
  });
}
