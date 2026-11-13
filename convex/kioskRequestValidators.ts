import { ConvexError, v } from "convex/values";
import { canonicalStoreSlug, isStoreSlug, storeSlugAliases } from "../apps/kiosk/src/store-address";

export { canonicalStoreSlug, storeSlugAliases };

export function requestStoreSlug(value: string): string {
  if (!isStoreSlug(value)) throw new ConvexError({ code: "INVALID_INPUT" });
  return canonicalStoreSlug(value);
}

export const requestStatus = v.union(v.literal("waiting"), v.literal("found"), v.literal("shown"), v.literal("given"), v.literal("cleared"));
export const staffStatus = v.union(v.literal("found"), v.literal("shown"), v.literal("given"), v.literal("cleared"));
export const productFields = {
  productId: v.string(), variantId: v.string(), title: v.string(), variantTitle: v.string(),
  sku: v.union(v.string(), v.null()), imageUrl: v.union(v.string(), v.null()),
  priceCents: v.number(), productUrl: v.string(),
};
export const requestFields = {
  ...productFields, storeSlug: v.string(), status: requestStatus,
  createdAt: v.number(), updatedAt: v.number(), expiresAt: v.number(),
};
export const publicRequest = v.object({ id: v.id("kioskRequests"), ...requestFields });
export const receipt = v.object({ id: v.id("kioskRequests"), status: requestStatus, createdAt: v.number(), expiresAt: v.number() });
