import { describe, expect, it, vi } from 'vitest';
import { fetchStore } from './useStore';

const store = { slug: 'northcentraltx', name: 'North Central', region: '', address: '', storefrontUrl: 'https://northcentraltx.paymore.com' };
describe('staff header store metadata', () => {
  it('loads the source store name independently of request data', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ store, products: [] }));
    expect(await fetchStore('northcentraltx', new AbortController().signal, fetcher)).toEqual(store);
  });
  it('never shows another store name from a mismatched response', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ store }));
    expect(await fetchStore('taylormi', new AbortController().signal, fetcher)).toBeNull();
  });
  it('allows the board to work when catalog metadata is unavailable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    expect(await fetchStore('northcentraltx', new AbortController().signal, fetcher)).toBeNull();
  });
});
