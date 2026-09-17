import { v } from "convex/values";

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
