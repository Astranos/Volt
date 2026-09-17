import { useEffect, useState } from 'react';
import { z } from 'zod';
import { storeSchema, type Store } from '../catalog';

const responseSchema = z.object({ store: storeSchema });
export async function fetchStore(slug: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Store | null> {
  try {
    const response = await fetchImpl(`/api/catalog?store=${encodeURIComponent(slug)}`, { signal });
    if (!response.ok) return null;
    const result = responseSchema.safeParse(await response.json());
    return result.success && result.data.store.slug === slug ? result.data.store : null;
  } catch { return null; }
}

// Staff needs the store label once, not the catalog's minute-by-minute refresh.
export function useStore(slug: string): Store | null {
  const [store, setStore] = useState<Store | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    void fetchStore(slug, controller.signal).then(value => {
      if (!controller.signal.aborted) setStore(value);
      clearTimeout(timeout);
    });
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [slug]);
  return store?.slug === slug ? store : null;
}
