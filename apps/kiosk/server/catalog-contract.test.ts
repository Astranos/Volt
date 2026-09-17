import { describe, expect, it, vi } from 'vitest';
import { catalogResponseSchema } from '../src/catalog';
import { createCatalogService } from './catalog';

function shopifyProduct() {
  return {
    id: 101,
    title: 'Apple iPhone 14',
    handle: 'iphone-14',
    body_html: '<table><tr><td>Condition</td><td>Good</td></tr></table>',
    // The upstream value is normalized by the service before the shared
    // contract is exposed to the browser.
    published_at: '2026-09-17T12:00:00-04:00',
    product_type: 'Phones',
    variants: [{ id: 1001, title: 'Default Title', price: '199.99', available: true }],
    images: [{ src: 'https://cdn.shopify.com/s/files/photo.jpg' }],
  };
}

describe('catalog response contract', () => {
  it('returns a shared-schema response with normalized dates and no internal store code', async () => {
    const service = createCatalogService({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ products: [shopifyProduct()] }),
      ),
      now: () => Date.parse('2026-09-17T16:00:00Z'),
    });

    const response = await service.getCatalog('taylormi');
    expect(() => catalogResponseSchema.parse(response)).not.toThrow();
    expect(response.products[0]?.publishedAt).toBe('2026-09-17T16:00:00.000Z');
    expect(response.checkedAt).toBe('2026-09-17T16:00:00.000Z');
    expect(response.store).not.toHaveProperty('internalCode');
    expect(JSON.stringify(response)).not.toContain('MI01');
  });
});
