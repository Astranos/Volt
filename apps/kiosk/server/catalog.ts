import { z } from 'zod';
import { getStore, readStoreMetadata } from './stores.js';
import type { CatalogResponse, Product, Category } from '../src/catalog.js';
import { parseListingContent } from './listing-content.js';

const PAGE_SIZE = 250;
const MAX_PAGES = 20;
const MAX_BYTES = 8 * 1024 * 1024;
const FRESH_MS = 60_000;
const STALE_MS = 300_000;
const MAX_CACHED_STORES = 64;
const MAX_CONCURRENT_STORES = 16;

function storeNotFound() {
  return Object.assign(new Error('Store not found.'), { statusCode: 404 });
}

function unavailable() {
  return Object.assign(new Error('Inventory is temporarily unavailable. Please ask an associate.'), { statusCode: 503 });
}

function requireValue(ok: unknown) {
  if (!ok) throw unavailable();
}

function cents(value: string) {
  const result = Math.round(Number(value) * 100);
  requireValue(Number.isSafeInteger(result));
  return result;
}

function category(text: string): Category {
  const rules: [Category, RegExp][] = [
    ['Tablets', /\b(ipad|tablets?|galaxy tab)\b/i],
    ['Phones', /\b(iphone|smartphones?|phones?|galaxy s\d+|pixel \d+)\b/i],
    ['Computers', /\b(laptops?|macbooks?|imac|computers?|chromebooks?|desktops?|monitors?|motherboards?|graphics cards?|processors?|ssd|hdd|ram|ryzen)\b/i],
    ['Audio', /\b(headphones?|headsets?|earbuds|airpods|speakers?|microphones?|soundbars?|audio)\b/i],
    ['Cameras', /\b(cameras?|lens|lenses|gopro|camcorders?)\b/i],
    ['Gaming', /\b(games?|gaming|playstation|xbox|nintendo|snes|nes|consoles?|steam deck)\b/i],
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] || 'Other';
}

const idSchema = z.union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^\d+$/)]).transform(String);
const productSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1), handle: z.string().min(1),
  body_html: z.string().nullable(),
  published_at: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  product_type: z.string().optional(),
  variants: z.array(z.object({ id: idSchema, title: z.string(), available: z.boolean(), price: z.string().regex(/^\d+(\.\d{1,2})?$/), sku: z.string().max(200).nullable().optional() })).min(1),
  images: z.array(z.object({ src: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'cdn.shopify.com' && !url.username && !url.password && !url.port;
  }) })),
});
const pageSchema = z.object({ products: z.array(productSchema).max(PAGE_SIZE) });

function parseProduct(raw: z.infer<typeof productSchema>, store: CatalogResponse['store']): Product | null {
  const id = raw.id;
  const variants = raw.variants.map((variant) => {
    return { id: variant.id, title: variant.title, priceCents: cents(variant.price), available: variant.available, sku: variant.sku?.trim() || null };
  }).filter((variant) => variant.available).map(({ available, ...variant }) => variant);
  const images = raw.images.map((image) => {
    const url = new URL(image.src);
    url.searchParams.set('width', '720');
    return url.href;
  });
  const body = raw.body_html || '';
  const details = parseListingContent(body, raw.title);
  const specifications = details.flatMap(block => block.kind === 'specifications' ? block.rows : []);
  const attribute = (label: string) => specifications.find(row => row.label.replace(/:\s*$/, '').trim().toLowerCase() === label)?.value;
  const condition = /\b(broken|for parts|not working)\b/i.test(raw.title)
    ? 'For parts / repair'
    : attribute('condition')?.slice(0, 120) || 'See item details';
  if (!variants.length) return null;
  const prices = variants.map((variant) => variant.priceCents);
  const productType = category(raw.product_type || '');
  const titleCategory = category(raw.title);
  const sourceCategory = productType !== 'Other' ? productType : titleCategory;
  return {
    id, title: raw.title, category: sourceCategory !== 'Other' ? sourceCategory : category(attribute('collection') || ''),
    condition: condition || 'See item details', priceCents: Math.min(...prices), priceMaxCents: Math.max(...prices),
    images, url: `${store.storefrontUrl}/products/${encodeURIComponent(raw.handle)}`,
    details,
    description: details.map(block => {
      switch (block.kind) {
        case 'heading': case 'paragraph': return block.text;
        case 'list': return block.items.join('\n');
        case 'specifications': return block.rows.map(row => `${row.label}: ${row.value}`).join('\n');
      }
    }).join('\n').slice(0, 12000),
    publishedAt: new Date(raw.published_at).toISOString(), variants,
  };
}

async function readBody(response: Response, maxBytes = MAX_BYTES) {
  if (!response.ok || response.redirected || !response.body) throw unavailable();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      requireValue(length <= maxBytes);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createCatalogService({ fetchImpl = fetch, now = Date.now }: { fetchImpl?: typeof fetch; now?: () => number } = {}) {
  const cache = new Map<string, CatalogResponse>();
  const pending = new Map<string, Promise<CatalogResponse>>();
  async function load(store: CatalogResponse['store']): Promise<CatalogResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const products = [];
      const ids = new Set();
      for (let page = 1; page <= MAX_PAGES; page++) {
        const response = await fetchImpl(`${store.storefrontUrl}/products.json?limit=${PAGE_SIZE}&page=${page}`, {
          signal: controller.signal, redirect: 'error', headers: { Accept: 'application/json' },
        });
        if (page === 1 && response.status === 404) throw storeNotFound();
        const data: unknown = JSON.parse(await readBody(response));
        const records = pageSchema.parse(data).products;
        for (const record of records) {
          const product = parseProduct(record, store);
          requireValue(!ids.has(String(record.id)));
          ids.add(String(record.id));
          if (product) products.push(product);
        }
        if (records.length < PAGE_SIZE) {
          // Product-feed success is sufficient. Missing marketing-page metadata
          // must not make a working franchise catalog unavailable.
          let displayStore = store;
          try {
            const metadata = await fetchImpl(store.storefrontUrl + '/', {
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]),
              redirect: 'error', headers: { Accept: 'text/html' },
            });
            displayStore = readStoreMetadata(await readBody(metadata, 1024 * 1024), store);
          } catch { /* Keep the source hostname when its metadata is unavailable. */ }
          const result: CatalogResponse = { store: displayStore, products, checkedAt: new Date(now()).toISOString(), status: 'fresh' };
          cache.delete(store.slug);
          if (cache.size >= MAX_CACHED_STORES) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
          }
          cache.set(store.slug, result);
          return result;
        }
      }
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async getCatalog(slug: string): Promise<CatalogResponse> {
      const store = getStore(slug);
      if (!store) throw storeNotFound();
      const cached = cache.get(slug);
      if (cached && now() - Date.parse(cached.checkedAt) < FRESH_MS) return cached;
      const inFlight = pending.get(slug);
      if (inFlight) return inFlight;
      if (pending.size >= MAX_CONCURRENT_STORES) throw unavailable();
      const request = load(store).catch((error: unknown): CatalogResponse => {
          if (error instanceof Error && 'statusCode' in error && error.statusCode === 404) throw error;
          if (error instanceof Error && typeof error.cause === 'object' && error.cause !== null && 'code' in error.cause && error.cause.code === 'ENOTFOUND') throw storeNotFound();
          if (cached && now() - Date.parse(cached.checkedAt) < STALE_MS) return { ...cached, status: 'stale' };
          throw unavailable();
        }).finally(() => { pending.delete(slug); });
      pending.set(slug, request);
      return request;
    },
  };
}
