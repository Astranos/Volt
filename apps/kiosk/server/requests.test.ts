import { describe, expect, it, vi } from 'vitest';
import { ConvexError } from 'convex/values';
import { createRequestHandlers, type RequestBackend } from './requests.js';
import type { CatalogResponse } from '../src/catalog.js';

const time = 1_800_000_000_000;
const input = { storeSlug: 'taylormi', productId: '12', variantId: '34', requestKey: '12345678-1234-4234-8234-123456789abc:34' };
const receipt = { id: 'request1', status: 'waiting' as const, createdAt: time, expiresAt: time + 3600000 };
const catalog: CatalogResponse = {
  store: { slug: 'taylormi', name: 'Taylor', region: '', address: '', storefrontUrl: 'https://taylormi.paymore.com' },
  checkedAt: new Date(time).toISOString(), status: 'fresh',
  products: [{ id: '12', title: 'Camera', category: 'Cameras', condition: 'Good', priceCents: 2000, priceMaxCents: 2000, images: ['https://cdn.shopify.com/a.jpg'], url: 'https://taylormi.paymore.com/products/camera', description: '', details: [], publishedAt: new Date(time).toISOString(), variants: [{ id: '34', title: 'Default Title', priceCents: 2000, sku: 'MI01-8773A-E9' }] }],
};
function setup() {
  const db = {
    enqueue: vi.fn<RequestBackend['enqueue']>().mockResolvedValue(receipt),
    list: vi.fn<RequestBackend['list']>().mockResolvedValue({ requests: [], serverNow: time }),
    setStatus: vi.fn<RequestBackend['setStatus']>().mockResolvedValue(null),
  };
  const getCatalog = vi.fn().mockResolvedValue(catalog);
  const api = createRequestHandlers({ getCatalog, getConfig: () => ({ url: 'https://test.convex.cloud', secret: 's'.repeat(32) }), createBackend: () => db, now: () => time });
  return { api, db, getCatalog };
}
function post(body: unknown = input, headers: Record<string, string> = {}) {
  return new Request('https://pm.juanquenga.com/api/requests', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

describe('item request HTTP boundary', () => {
  it('takes product metadata only from fresh inventory and hashes the visitor', async () => {
    const { api, db } = setup();
    const response = await api.POST(post({ ...input, title: 'Forged', priceCents: 1 }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(receipt);
    expect(db.enqueue).toHaveBeenCalledWith(expect.objectContaining({ requestKey: input.requestKey, clientHash: expect.stringMatching(/^[a-f0-9]{64}$/), product: expect.objectContaining({ title: 'Camera', sku: 'MI01-8773A-E9', priceCents: 2000 }) }));
    expect(db.enqueue.mock.calls[0]?.[0].clientHash).not.toContain('12345678');
  });
  it('forwards retries with the same idempotency key', async () => {
    const { api, db } = setup();
    await api.POST(post()); await api.POST(post());
    expect(db.enqueue.mock.calls[0]?.[0]).toEqual(db.enqueue.mock.calls[1]?.[0]);
  });
  it.each([
    [{ ...input, storeSlug: 'mi01' }, 400],
    [{ ...input, variantId: '99' }, 400],
    [{ ...input, requestKey: 'invalid' }, 400],
    [{ ...input, productId: '99' }, 404],
    [{ ...input, variantId: '99', requestKey: input.requestKey.replace(':34', ':99') }, 409],
  ])('rejects invalid or missing item %j', async (body, status) => {
    const { api, db } = setup();
    expect((await api.POST(post(body))).status).toBe(status);
    expect(db.enqueue).not.toHaveBeenCalled();
  });
  it('refuses stale inventory', async () => {
    const { api, db, getCatalog } = setup();
    getCatalog.mockResolvedValue({ ...catalog, status: 'stale' });
    expect((await api.POST(post())).status).toBe(503);
    expect(db.enqueue).not.toHaveBeenCalled();
  });
  it('rejects foreign origins, non JSON, oversized bodies, and malformed JSON', async () => {
    const { api, db } = setup();
    expect((await api.POST(post(input, { origin: 'https://evil.example' }))).status).toBe(400);
    expect((await api.POST(post(input, { 'content-type': 'text/plain' }))).status).toBe(400);
    expect((await api.POST(post({ ...input, junk: 'x'.repeat(9000) }))).status).toBe(400);
    expect((await api.POST(new Request('https://pm.juanquenga.com/api/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }))).status).toBe(400);
    expect(db.enqueue).not.toHaveBeenCalled();
  });
  it('lists one store and rejects duplicate store parameters', async () => {
    const { api, db } = setup();
    expect((await api.GET(new Request('https://pm.juanquenga.com/api/requests?store=southfieldmi'))).status).toBe(200);
    expect(db.list).toHaveBeenCalledWith({ secret: 's'.repeat(32), storeSlug: 'southfieldmi' });
    expect((await api.GET(new Request('https://pm.juanquenga.com/api/requests?store=taylormi&store=southfieldmi'))).status).toBe(400);
  });
  it('returns 404 for missing or expired updates', async () => {
    const { api } = setup();
    expect((await api.PATCH(new Request('https://pm.juanquenga.com/api/requests', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeSlug: 'taylormi', id: 'request1', status: 'shown' }) }))).status).toBe(404);
  });
  it.each([['RATE_LIMITED', 429], ['QUEUE_FULL', 429], ['CONFLICT', 409], ['UNAUTHORIZED', 503], ['INVALID_INPUT', 400]])('maps %s without leaking backend details', async (code, status) => {
    const { api, db } = setup();
    db.enqueue.mockRejectedValue(new ConvexError({ code, message: 'secret value' }));
    const response = await api.POST(post());
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain('secret value');
  });
  it('does not invent persistence when configuration is absent', async () => {
    const api = createRequestHandlers({ getConfig: () => { throw new Error('missing secret'); } });
    const response = await api.POST(post());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('missing secret');
  });
  it('returns the saved staff update without changing its expiry', async () => {
    const { api, db } = setup();
    const saved = { ...receipt, storeSlug: 'taylormi', productId: '12', variantId: '34', title: 'Camera', variantTitle: 'Default Title', sku: 'MI01-8773A-E9', imageUrl: null, priceCents: 2000, productUrl: 'https://taylormi.paymore.com/products/camera', status: 'found' as const, updatedAt: time + 2000 };
    db.setStatus.mockResolvedValue(saved);
    const response = await api.PATCH(new Request('https://pm.juanquenga.com/api/requests', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storeSlug: 'taylormi', id: 'request1', status: 'found' }) }));
    expect(await response.json()).toEqual(saved);
  });
  it('bounds slow catalog calls and never enqueues after the deadline', async () => {
    vi.useFakeTimers();
    try {
      const { api, db, getCatalog } = setup();
      let finish: ((value: CatalogResponse) => void) | undefined;
      getCatalog.mockImplementation(() => new Promise<CatalogResponse>(resolve => { finish = resolve; }));
      const response = api.POST(post());
      await vi.advanceTimersByTimeAsync(12_000);
      expect((await response).status).toBe(503);
      finish?.(catalog);
      await vi.advanceTimersByTimeAsync(0);
      expect(db.enqueue).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
