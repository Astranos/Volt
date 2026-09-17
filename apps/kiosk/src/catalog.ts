import { z } from 'zod';

export const categorySchema = z.enum(['Phones', 'Computers', 'Tablets', 'Gaming', 'Audio', 'Cameras', 'Other']);
export type Category = z.infer<typeof categorySchema>;

export const storeSchema = z.object({
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
  name: z.string().min(1),
  region: z.string(),
  address: z.string(),
  storefrontUrl: z.url({ protocol: /^https$/ }),
});
export type Store = z.infer<typeof storeSchema>;

const moneySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const detailBlockSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('heading'), text: z.string() }),
  z.object({ kind: z.literal('paragraph'), text: z.string() }),
  z.object({ kind: z.literal('list'), items: z.array(z.string()) }),
  z.object({ kind: z.literal('specifications'), rows: z.array(z.object({ label: z.string(), value: z.string() })) }),
]);
export type DetailBlock = z.infer<typeof detailBlockSchema>;
export const productSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: categorySchema,
  condition: z.string(),
  priceCents: moneySchema,
  priceMaxCents: moneySchema,
  images: z.array(z.url({ protocol: /^https$/ })),
  url: z.url({ protocol: /^https$/ }),
  description: z.string(),
  details: z.array(detailBlockSchema),
  publishedAt: z.iso.datetime({ offset: true }),
  variants: z.array(z.object({ id: z.string().min(1), title: z.string(), priceCents: moneySchema, sku: z.string().nullable() })).min(1),
}).refine((product) => product.priceMaxCents >= product.priceCents, 'Invalid price range');
export type Product = z.infer<typeof productSchema>;

export const catalogResponseSchema = z.object({
  store: storeSchema,
  products: z.array(productSchema),
  checkedAt: z.iso.datetime({ offset: true }),
  status: z.enum(['fresh', 'stale']),
});
export type CatalogResponse = z.infer<typeof catalogResponseSchema>;
