import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeRequests, requestJson } from './useRequests';
import type { ProductRequest } from '../requests';

function request(patch: Partial<ProductRequest> = {}): ProductRequest {
  return { id: 'request', storeSlug: 'taylormi', productId: '1', variantId: '2', title: 'Camera', variantTitle: '', sku: 'MI01-123', imageUrl: null, priceCents: 100, productUrl: 'https://taylormi.paymore.com/products/camera', status: 'waiting', createdAt: 100, updatedAt: 100, expiresAt: 3600100, ...patch };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('staff request list', () => {
  it('keeps found requests, removes terminal and expired requests even offline', () => {
    const rows = [request({ id: 'found', status: 'found' }), request({ id: 'shown', status: 'shown' }), request({ id: 'given', status: 'given' }), request({ id: 'cleared', status: 'cleared' }), request({ id: 'expired', expiresAt: 200 })];
    expect(activeRequests(rows, 200).map(row => row.id)).toEqual(['found']);
    expect(activeRequests(rows, 3600100)).toEqual([]);
  });
  it('sorts oldest first without changing source order', () => {
    const rows = [request({ id: 'new', createdAt: 200 }), request({ id: 'old', createdAt: 100 })];
    expect(activeRequests(rows, 300).map(row => row.id)).toEqual(['old', 'new']);
    expect(rows[0]?.id).toBe('new');
  });
});
describe('request transport', () => {
  it('does not report error responses as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Item unavailable' }), { status: 409 })));
    await expect(requestJson('/api/requests', {})).rejects.toThrow('Item unavailable');
  });
  it('rejects malformed responses instead of confirming a request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json')));
    await expect(requestJson('/api/requests', {})).rejects.toThrow();
  });
  it('aborts the underlying fetch when its owner unmounts', async () => {
    const owner = new AbortController();
    let fetchSignal: AbortSignal | null | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      fetchSignal = init.signal;
      return new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }));
    const pending = requestJson('/api/requests', { signal: owner.signal });
    owner.abort();
    await expect(pending).rejects.toThrow();
    expect(fetchSignal?.aborted).toBe(true);
  });
});
