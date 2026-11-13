/** Compatibility aliases for the two stores configured before Shopify handles. */
const legacyStores: Readonly<Record<string, string>> = {
  taylormi: 'paymore-taylor',
  southfieldmi: 'paymore-southfield',
};

export function canonicalStoreSlug(slug: string): string {
  return Object.hasOwn(legacyStores, slug) ? legacyStores[slug] : slug;
}

/** The canonical handle plus any legacy IDs that rows may still be stored under. */
export function storeSlugAliases(canonical: string): string[] {
  return [canonical, ...Object.keys(legacyStores).filter((legacy) => legacyStores[legacy] === canonical)];
}

const reservedSlugs = new Set(['www', 'api', 'admin', 'mail', 'shop', 'localhost']);

export function isStoreSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)
    && !reservedSlugs.has(value)
    && !/^[a-z]{2}\d+$/.test(value);
}

export function storeSlugFromInput(value: string): string | null {
  const input = value.trim().toLowerCase();
  if (isStoreSlug(input)) return canonicalStoreSlug(input);
  try {
    const url = new URL(input.includes('://') ? input : `https://${input}`);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
    const shop = /^([a-z0-9-]+)\.myshopify\.com$/.exec(url.hostname)?.[1];
    const kiosk = url.hostname === 'pm.voltresale.app'
      ? /^\/([a-z0-9-]+)(?:\/requests)?\/?$/.exec(url.pathname)?.[1]
      : undefined;
    const slug = shop && url.pathname === '/' ? shop : kiosk;
    return slug && isStoreSlug(slug) ? canonicalStoreSlug(slug) : null;
  } catch { return null; }
}
