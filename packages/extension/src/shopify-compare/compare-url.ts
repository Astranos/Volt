import { MAX_COMPARE_PRODUCTS } from "../domain/shopify-audit";

const PRODUCT_GID = /^gid:\/\/shopify\/Product\/(\d+)$/;

/** Compare page path for the picked products, e.g. `/shopify-compare.html?ids=12,34`. */
export function shopifyComparePath(productIds: readonly string[]): `/shopify-compare.html?ids=${string}` {
  const ids = productIds.flatMap((id) => PRODUCT_GID.exec(id)?.[1] ?? []);
  return `/shopify-compare.html?ids=${ids.join(",")}`;
}

/** Product GIDs from the compare page's `ids` param, deduped and capped. */
export function compareProductIds(search: string): string[] {
  const raw = new URLSearchParams(search).get("ids") ?? "";
  const ids = raw.split(",").map((id) => id.trim()).filter((id) => /^\d{1,20}$/.test(id));
  return [...new Set(ids)].slice(0, MAX_COMPARE_PRODUCTS).map((id) => `gid://shopify/Product/${id}`);
}
