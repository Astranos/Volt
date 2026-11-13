import assert from 'node:assert/strict';
import { canonicalStoreSlug } from '../src/store-address.ts';

// Opt-in integration check against the running kiosk and public Shopify stores.
const base = new URL(process.argv[2] || 'http://127.0.0.1:4175');
const slugs = process.argv.length > 3 ? process.argv.slice(3) : ['paymore-taylor', 'paymore-southfield'];
for (const slug of slugs) {
  const handle = canonicalStoreSlug(slug);
  const response = await fetch(new URL('/api/catalog?store=' + encodeURIComponent(slug), base));
  assert.equal(response.status, 200, slug + ' catalog must load');
  const catalog = await response.json();
  assert.equal(catalog.store.slug, slug);
  assert.equal(catalog.store.storefrontUrl, 'https://' + handle + '.myshopify.com');
  assert.equal(catalog.status, 'fresh');
  assert.ok(catalog.products.length > 0, 'Expected live listings');
  assert.ok(Date.now() - Date.parse(catalog.checkedAt) < 90_000, 'Fresh timestamp required');
  assert.ok(!('internalCode' in catalog.store), 'Internal store configuration must stay server-side');
  assert.equal(new Set(catalog.products.map(product => product.id)).size, catalog.products.length);
  for (const product of catalog.products) {
    assert.equal(new URL(product.url).hostname, handle + '.myshopify.com');
    assert.ok(product.variants.length > 0, 'Available variants required');
    assert.ok(Number.isSafeInteger(product.priceCents) && product.priceCents >= 0);
  }
  const metadataResponse = await fetch(catalog.store.storefrontUrl + '/meta.json', { redirect: 'error' });
  assert.equal(metadataResponse.status, 200, 'Shopify metadata must load directly');
  const metadata = await metadataResponse.json();
  assert.equal(catalog.store.name, metadata.name, 'Displayed store name matches Shopify');
  assert.equal(catalog.store.region, [metadata.city, metadata.province, metadata.country].filter(Boolean).join(', '));
  assert.equal(catalog.store.address, '', 'No street address is invented');
  const sample = catalog.products[0];
  let shopify;
  for (let page = 1; page <= 20 && !shopify; page += 1) {
    const shopifyResponse = await fetch(catalog.store.storefrontUrl + '/products.json?limit=250&page=' + page, { redirect: 'error' });
    assert.equal(shopifyResponse.status, 200, 'Shopify product feed must load directly');
    const feed = await shopifyResponse.json();
    shopify = feed.products.find(product => String(product.id) === sample.id);
    if (feed.products.length < 250) break;
  }
  assert.ok(shopify, 'Sample product exists in the Shopify feed');
  assert.equal(sample.title, shopify.title, 'Displayed title matches Shopify');
  const availableVariants = shopify.variants.filter(variant => variant.available);
  assert.deepEqual(sample.variants.map(variant => variant.id), availableVariants.map(variant => String(variant.id)), 'Displayed choices match Shopify availability');
  assert.deepEqual(sample.variants.map(variant => variant.sku), availableVariants.map(variant => variant.sku?.trim() || null), 'Staff lookup SKUs match Shopify');
  if (/<table\b/i.test(shopify.body_html || '')) assert.ok(sample.details.some(block => block.kind === 'specifications'), 'Source specifications remain a table');
  assert.equal(sample.priceCents, Math.min(...availableVariants.map(variant => Math.round(Number(variant.price) * 100))), 'Displayed price matches Shopify');
  process.stdout.write('Verified ' + catalog.products.length + ' ' + catalog.store.name + ' listings, host isolation, freshness, specifications, SKUs, and Shopify prices.\n');
}
assert.equal((await fetch(new URL('/api/catalog?store=mi01', base))).status, 404);
assert.equal((await fetch(new URL('/api/catalog?store=https://example.com', base))).status, 400);
assert.equal((await fetch(new URL('/api/catalog?store=paymore-taylor', base), { method: 'POST' })).status, 405);
