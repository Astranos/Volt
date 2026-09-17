import { z } from 'zod';
import { storeSchema } from './catalog.js';

export const requestStatusSchema = z.enum(['waiting', 'found', 'shown', 'given', 'cleared']);
export const requestUpdateStatusSchema = z.enum(['found', 'shown', 'given', 'cleared']);
export const productRequestSchema = z.object({
  id: z.string().min(1),
  storeSlug: storeSchema.shape.slug,
  productId: z.string().regex(/^\d+$/),
  variantId: z.string().regex(/^\d+$/),
  title: z.string().min(1).max(500),
  variantTitle: z.string().max(300),
  sku: z.string().max(200).nullable(),
  imageUrl: z.url({ protocol: /^https$/ }).nullable(),
  priceCents: z.number().int().nonnegative(),
  productUrl: z.url({ protocol: /^https$/ }),
  status: requestStatusSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  expiresAt: z.number(),
});
export const requestReceiptSchema = productRequestSchema.pick({ id: true, status: true, createdAt: true, expiresAt: true });
export const queueResponseSchema = z.object({ requests: z.array(productRequestSchema).max(100), serverNow: z.number() });
export const createRequestInputSchema = z.object({
  storeSlug: storeSchema.shape.slug,
  productId: productRequestSchema.shape.productId,
  variantId: productRequestSchema.shape.variantId,
  requestKey: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d+$/i),
});
export const updateRequestInputSchema = z.object({
  storeSlug: storeSchema.shape.slug,
  id: z.string().min(1).max(100),
  status: requestUpdateStatusSchema,
});
export type RequestStatus = z.infer<typeof requestStatusSchema>;
export type RequestUpdateStatus = z.infer<typeof requestUpdateStatusSchema>;
export type ProductRequest = z.infer<typeof productRequestSchema>;
export type RequestReceipt = z.infer<typeof requestReceiptSchema>;
export type QueueResponse = z.infer<typeof queueResponseSchema>;
export type CreateRequestInput = z.infer<typeof createRequestInputSchema>;
export type UpdateRequestInput = z.infer<typeof updateRequestInputSchema>;
