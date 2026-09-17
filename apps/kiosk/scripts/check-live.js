import assert from 'node:assert/strict';

// Deliberately opt-in: contacts the running kiosk and its public Shopify source.
const base = new URL(process.argv[2] || 'http://127.0.0.1:4175');
const response = await fetch(new URL('/api/catalog?store=taylormi', base));
assert.equal(response.status, 200, 'Taylor catalog must load');
const catalog = await response.json();
assert.equal(catalog.store.slug, 'taylormi');
assert.equal(catalog.status, 'fresh');
assert.ok(catalog.products.length > 0, 'Expected live Taylor listings');
assert.ok(Date.now() - Date.parse(catalog.checkedAt) < 90_000, 'Fresh timestamp required');
assert.ok(!('internalCode' in catalog.store), 'Internal store configuration must stay server-side');
assert.equal(new Set(catalog.products.map((product) => product.id)).size, catalog.products.length);
for (const product of catalog.products) {
  assert.equal(new URL(product.url).hostname, 'taylormi.paymore.com');
  assert.ok(product.variants.length > 0, 'Available variants required');
  assert.ok(Number.isSafeInteger(product.priceCents) && product.priceCents >= 0);
}
const sample = catalog.products[0];
const shopifyResponse = await fetch(`${sample.url}.js`);
assert.equal(shopifyResponse.status, 200, 'Sample Shopify product must load');
const shopify = await shopifyResponse.json();
assert.equal(sample.title, shopify.title, 'Displayed title matches Shopify');
const availableVariants = shopify.variants.filter((variant) => variant.available);
assert.deepEqual(sample.variants.map((variant) => variant.id), availableVariants.map((variant) => String(variant.id)), 'Displayed choices match Shopify availability');
assert.deepEqual(sample.variants.map((variant) => variant.sku), availableVariants.map((variant) => variant.sku?.trim() || null), 'Staff lookup SKUs match Shopify');
assert.ok(sample.details.some((block) => block.kind === 'specifications'), 'Sample listing specifications must remain a table');
assert.equal(sample.priceCents, Math.min(...availableVariants.map((variant) => variant.price)), 'Displayed price matches Shopify');
assert.equal((await fetch(new URL('/api/catalog?store=unconfigured-store', base))).status, 404);
assert.equal((await fetch(new URL('/api/catalog?store=https://example.com', base))).status, 400);
assert.equal((await fetch(new URL('/api/catalog?store=taylormi', base), { method: 'POST' })).status, 405);
process.stdout.write(`Verified ${catalog.products.length} Taylor listings, store isolation, freshness, API errors, specification tables, and a product's title, variants, SKUs, and price against Shopify.\n`);
