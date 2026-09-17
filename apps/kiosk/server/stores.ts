import { load } from 'cheerio';
import { z } from 'zod';
import type { Store } from '../src/catalog.js';

const reservedSlugs = new Set(['www', 'api', 'admin', 'mail', 'shop', 'localhost']);

export function isStoreSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)
    && !reservedSlugs.has(value)
    && !/^[a-z]{2}\d+$/.test(value);
}

export function getStore(slug: string): Store | null {
  if (!isStoreSlug(slug)) return null;
  return { slug, name: slug, region: '', address: '', storefrontUrl: `https://${slug}.paymore.com` };
}

const textSchema = z.string().max(300).transform((value) => value.replace(/\s+/g, ' ').trim());
const businessSchema = z.object({
  '@type': z.union([z.string(), z.array(z.string()).max(20)]),
  url: z.string().max(2048).optional(),
  name: textSchema.optional(),
  address: z.object({
    addressLocality: textSchema.optional(),
    addressRegion: textSchema.optional(),
    streetAddress: textSchema.optional(),
  }).optional(),
});

function readableName(value: string | undefined): string | undefined {
  const parsed = textSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const name = parsed.data.replace(/^paymore(?:\s+stores?)?(?:\s*[-–—|:]\s*|\s+)/i, '').trim();
  return name && !/^paymore(?:\s+stores?)?$/i.test(name) ? name : undefined;
}

function matchesOrigin(url: string | undefined, store: Store): boolean {
  if (!url) return true;
  try { return new URL(url).origin === store.storefrontUrl; } catch { return false; }
}

/** Metadata enriches presentation without changing the approved target host. */
export function readStoreMetadata(html: string, store: Store): Store {
  if (html.length > 1_000_000) return store;
  const $ = load(html);
  const fallbackName = readableName($('meta[property="og:site_name"]').first().attr('content'))
    ?? readableName($('title').first().text());
  const fallback = { ...store, name: fallbackName ?? store.name };
  for (const script of $('script[type="application/ld+json"]').slice(0, 20).toArray()) {
    const raw = $(script).text();
    if (raw.length > 100_000) continue;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { continue; }
    const queue: unknown[] = [value];
    for (let visited = 0; queue.length && visited < 200; visited += 1) {
      const node = queue.shift();
      if (Array.isArray(node)) { queue.push(...node.slice(0, 200)); continue; }
      const graph = z.object({ '@graph': z.array(z.unknown()).max(200) }).safeParse(node);
      if (graph.success) queue.push(...graph.data['@graph']);
      const result = businessSchema.safeParse(node);
      if (!result.success) continue;
      const business = result.data;
      const types = Array.isArray(business['@type']) ? business['@type'] : [business['@type']];
      if (!types.some((type) => type === 'ElectronicsStore' || type === 'LocalBusiness')) continue;
      if (!matchesOrigin(business.url, store)) continue;
      return {
        ...store,
        name: business.address?.addressLocality || readableName(business.name) || fallback.name,
        region: business.address?.addressRegion || store.region,
        address: business.address?.streetAddress || store.address,
      };
    }
  }
  return fallback;
}
