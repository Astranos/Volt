import { z } from 'zod';
import type { Store } from '../src/catalog.js';
import { canonicalStoreSlug, isStoreSlug } from '../src/store-address.js';

export { isStoreSlug } from '../src/store-address.js';

export function getStore(value: string): Store | null {
  if (!isStoreSlug(value)) return null;
  const slug = canonicalStoreSlug(value);
  return { slug, name: slug, region: '', address: '', storefrontUrl: `https://${slug}.myshopify.com` };
}

const textSchema = z.string().max(300).transform(value => value.replace(/\s+/g, ' ').trim());
const metadataSchema = z.object({
  name: textSchema.nullish(),
  city: textSchema.nullish(),
  province: textSchema.nullish(),
  country: textSchema.nullish(),
});

/** Shopify metadata supplies display text only, never the fetch origin. */
export function readStoreMetadata(value: unknown, store: Store): Store {
  const parsed = metadataSchema.safeParse(value);
  if (!parsed.success) return store;
  const metadata = parsed.data;
  return {
    ...store,
    name: metadata.name || store.name,
    region: [metadata.city, metadata.province, metadata.country].filter(Boolean).join(', '),
    address: '',
  };
}
