import { describe, expect, it, vi } from 'vitest';
import { createCatalogService } from './catalog';
import { getStore } from './stores';
import { GET } from '../api/catalog';

function product(id = 1) {
  return {
    id, title: 'Apple iPhone 14', handle: `iphone-${id}`, body_html: '<table><tr><td>Condition</td><td>Good</td></tr></table>',
    published_at: '2026-09-17T12:00:00Z', product_type: '',
    images: [{ src: 'https://cdn.shopify.com/s/files/photo.jpg' }],
    variants: [{ id: id * 10, title: 'Default Title', price: '199.99', available: true }],
  };
}

function response(products: unknown[]) { return Response.json({ products }); }

describe('approved Shopify catalog', () => {
  it('preserves exact staff lookup SKUs and structured specifications', async () => {
    const item = { ...product(), variants: product().variants.map(variant => ({ ...variant, sku: 'MI01-8773A-E9' })) };
    const data = await createCatalogService({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response([item])) }).getCatalog('taylormi');
    expect(data.products[0]?.variants[0]?.sku).toBe('MI01-8773A-E9');
    expect(data.store).not.toHaveProperty('internalCode');
    expect(data.products[0]?.details).toContainEqual({ kind: 'specifications', rows: [{ label: 'Condition', value: 'Good' }] });
  });
  it('uses explicit categories before title keywords and keeps gaming computers under Computers', async () => {
    const laptop = { ...product(1), title: 'Gaming laptop', body_html: '<table><tr><td>Collection</td><td>Laptops</td></tr></table>' };
    const tablet = { ...product(2), title: 'Gaming tablet', body_html: '' };
    const accessory = { ...product(3), title: 'Nintendo camera accessory', product_type: 'Video Games' };
    const phone = { ...product(4), title: 'Apple iPhone Air', body_html: '<table><tr><td>Collection</td><td>Tablets</td></tr></table>' };
    const data = await createCatalogService({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response([laptop, tablet, accessory, phone])) }).getCatalog('taylormi');
    expect(data.products.map(item => item.category)).toEqual(['Computers', 'Tablets', 'Gaming', 'Phones']);
  });

  it('prominently labels explicitly broken devices even when cosmetic condition says Good', async () => {
    const item = { ...product(), title: 'Broken Unlocked Apple iPhone 12 Pro Max READ' };
    const data = await createCatalogService({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response([item])) }).getCatalog('taylormi');
    expect(data.products[0]?.condition).toBe('For parts / repair');
  });
  it('maps listings and available variant ranges without exposing internal identifiers', async () => {
    const item = product();
    item.variants.push({ id: 11, title: 'Another', price: '299.99', available: true }, { id: 12, title: 'Sold', price: '1.00', available: false });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response([item]));
    const data = await createCatalogService({ fetchImpl }).getCatalog('taylormi');
    expect(data.products[0]).toMatchObject({ id: '1', category: 'Phones', condition: 'Good', priceCents: 19999, priceMaxCents: 29999 });
    expect(data.products[0]?.variants).toHaveLength(2);
    expect(JSON.stringify(data.store)).not.toMatch(/MI01|internalCode/);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://taylormi.paymore.com/products.json?limit=250&page=1');
    expect(fetchImpl.mock.calls[0]?.[1]?.redirect).toBe('error');
  });

  it('omits sold items, preserves separate identities, and never guesses condition', async () => {
    const sold = product(2); sold.variants[0] = { id: 20, title: 'Sold', price: '2.00', available: false };
    const item = product(); item.body_html = '<p>Great phone</p>';
    const data = await createCatalogService({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response([item, sold, product(3)])) }).getCatalog('taylormi');
    expect(data.products.map((p) => p.id)).toEqual(['1', '3']);
    expect(data.products[0]?.condition).toBe('See item details');
  });

  it('retrieves every page before publishing', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response(Array.from({ length: 250 }, (_, i) => product(i + 1))))
      .mockResolvedValueOnce(response([product(251)]));
    const data = await createCatalogService({ fetchImpl }).getCatalog('taylormi');
    expect(data.products).toHaveLength(251);
    expect(fetchImpl.mock.calls[1]?.[0]).toContain('page=2');
  });

  it.each([
    { ...product(), variants: [{ id: 1, title: 'Bad', available: true, price: 'free' }] },
    { ...product(), images: [{ src: 'https://evil.example/photo.jpg' }] },
    { ...product(), published_at: 'bad' },
  ])('rejects malformed records without publishing a partial catalog', async (bad) => {
    const service = createCatalogService({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response([product(), bad])) });
    await expect(service.getCatalog('taylormi')).rejects.toMatchObject({ statusCode: 503 });
  });

  it('keeps successful timestamp on stale fallback, then fails closed at five minutes', async () => {
    let time = 1000000;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response([product()])).mockRejectedValue(new Error('secret upstream detail'));
    const service = createCatalogService({ fetchImpl, now: () => time });
    const first = await service.getCatalog('taylormi');
    time += 59999;
    expect(await service.getCatalog('taylormi')).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    time += 1;
    expect(await service.getCatalog('taylormi')).toEqual({ ...first, status: 'stale' });
    time += 240000;
    await expect(service.getCatalog('taylormi')).rejects.toMatchObject({ statusCode: 503 });
  });

  it('deduplicates concurrent fetches', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response([product()]));
    const service = createCatalogService({ fetchImpl });
    const results = await Promise.all([service.getCatalog('taylormi'), service.getCatalog('taylormi')]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(results[0]).toEqual(results[1]);
  });

  it('rejects unsafe hosts and internal codes before fetching', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const service = createCatalogService({ fetchImpl });
    await expect(service.getCatalog('mi01')).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.getCatalog('evil.example')).rejects.toMatchObject({ statusCode: 404 });
    expect(fetchImpl).not.toHaveBeenCalled();
    const store = getStore('taylormi');
    if (store) store.name = 'Changed';
    expect(getStore('taylormi')?.name).toBe('taylormi');
  });

  it('loads an unregistered franchise and keeps concurrent store caches isolated', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async input => {
      const url = new URL(String(input));
      const southfield = url.hostname === 'southfieldmi.paymore.com';
      if (url.pathname === '/') return new Response(`<script type="application/ld+json">${JSON.stringify({ '@type': 'ElectronicsStore', url: url.origin, address: { addressLocality: southfield ? 'Southfield' : 'Taylor', addressRegion: 'MI', streetAddress: southfield ? '29139 Southfield Rd' : '9058 Telegraph Road' } })}</script>`);
      return response([product(southfield ? 200 : 100)]);
    });
    const service = createCatalogService({ fetchImpl });
    const [taylor, southfield] = await Promise.all([service.getCatalog('taylormi'), service.getCatalog('southfieldmi')]);
    expect(taylor.store.name).toBe('Taylor');
    expect(southfield.store).toMatchObject({ slug: 'southfieldmi', name: 'Southfield', address: '29139 Southfield Rd', storefrontUrl: 'https://southfieldmi.paymore.com' });
    expect(taylor.products[0]?.id).toBe('100');
    expect(southfield.products[0]?.id).toBe('200');
    expect(southfield.products[0]?.url).toMatch(/^https:\/\/southfieldmi\.paymore\.com\//);
    expect((await service.getCatalog('taylormi')).products[0]?.id).toBe('100');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('does not replace a missing franchise with another store or an empty catalog', async () => {
    const missing = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
    await expect(createCatalogService({ fetchImpl: missing }).getCatalog('missingstore')).rejects.toMatchObject({ statusCode: 404 });
    expect(missing).toHaveBeenCalledTimes(1);
    const dns = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } }));
    await expect(createCatalogService({ fetchImpl: dns }).getCatalog('missingstore')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('keeps working products when optional store metadata cannot be fetched', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response([product()])).mockRejectedValue(new Error('Homepage unavailable'));
    const catalog = await createCatalogService({ fetchImpl }).getCatalog('southfieldmi');
    expect(catalog.store).toMatchObject({ name: 'southfieldmi', region: '', address: '' });
    expect(catalog.products).toHaveLength(1);
  });

  it('rejects incomplete pages and duplicate identities', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response(Array.from({ length: 250 }, (_, i) => product(i + 1)))).mockRejectedValue(new Error('offline'));
    await expect(createCatalogService({ fetchImpl }).getCatalog('taylormi')).rejects.toMatchObject({ statusCode: 503 });
    await expect(createCatalogService({ fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response([product(), product()])) }).getCatalog('taylormi')).rejects.toMatchObject({ statusCode: 503 });
  });

  it('validates API requests without touching Shopify', async () => {
    expect((await GET(new Request('https://kiosk.test/api/catalog', { method: 'POST' }))).status).toBe(405);
    expect((await GET(new Request('https://kiosk.test/api/catalog?store=a&store=b'))).status).toBe(400);
    expect((await GET(new Request('https://kiosk.test/api/catalog?store=mi01'))).status).toBe(404);
  });

  it('bounds pagination, response size, and upstream status', async () => {
    let page = 0;
    const endless = vi.fn<typeof fetch>().mockImplementation(async () => {
      const offset = page++ * 250;
      return response(Array.from({ length: 250 }, (_, i) => product(offset + i + 1)));
    });
    await expect(createCatalogService({ fetchImpl: endless }).getCatalog('taylormi')).rejects.toMatchObject({ statusCode: 503 });
    expect(endless).toHaveBeenCalledTimes(20);
    const huge = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(8 * 1024 * 1024 + 1)));
    await expect(createCatalogService({ fetchImpl: huge }).getCatalog('taylormi')).rejects.toMatchObject({ statusCode: 503 });
    const denied = vi.fn<typeof fetch>().mockResolvedValue(new Response('private upstream error', { status: 403 }));
    await expect(createCatalogService({ fetchImpl: denied }).getCatalog('taylormi')).rejects.toMatchObject({ statusCode: 503 });
  });

  it('aborts the complete upstream operation after twenty seconds', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }));
      const promise = createCatalogService({ fetchImpl }).getCatalog('taylormi');
      const assertion = expect(promise).rejects.toMatchObject({ statusCode: 503 });
      await vi.advanceTimersByTimeAsync(20000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
