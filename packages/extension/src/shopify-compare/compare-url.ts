import { MAX_COMPARE_PRODUCTS, normalizeShopifyShopInput } from "../domain/shopify-audit";

const PRODUCT_GID = /^gid:\/\/shopify\/Product\/(\d+)$/;

/** Compare page path for the picked products, e.g. `/shopify-compare.html?ids=12,34&shop=store.myshopify.com`. */
export function shopifyComparePath(productIds: readonly string[], shop?: string | null): `/shopify-compare.html?ids=${string}` {
  const ids = productIds.flatMap((id) => PRODUCT_GID.exec(id)?.[1] ?? []);
  return `/shopify-compare.html?ids=${ids.join(",")}${shop ? `&shop=${encodeURIComponent(shop)}` : ""}`;
}

/** The store the compared products belong to; absent on links from before multiple stores. */
export function compareShop(search: string): string | undefined {
  const shop = new URLSearchParams(search).get("shop");
  return (shop && normalizeShopifyShopInput(shop)) || undefined;
}

/** Product GIDs from the compare page's `ids` param, deduped and capped. */
export function compareProductIds(search: string): string[] {
  const raw = new URLSearchParams(search).get("ids") ?? "";
  const ids = raw.split(",").map((id) => id.trim()).filter((id) => /^\d{1,20}$/.test(id));
  return [...new Set(ids)].slice(0, MAX_COMPARE_PRODUCTS).map((id) => `gid://shopify/Product/${id}`);
}
