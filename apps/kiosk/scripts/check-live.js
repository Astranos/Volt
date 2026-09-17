import assert from 'node:assert/strict';

// Opt-in integration check against the running kiosk and public Shopify stores.
const base = new URL(process.argv[2] || 'http://127.0.0.1:4175');
const slugs = process.argv.length > 3 ? process.argv.slice(3) : ['taylormi', 'southfieldmi'];
for (const slug of slugs) {
  const response = await fetch(new URL('/api/catalog?store=' + encodeURIComponent(slug), base));
  assert.equal(response.status, 200, slug + ' catalog must load');
  const catalog = await response.json();
  assert.equal(catalog.store.slug, slug);
  assert.equal(catalog.store.storefrontUrl, 'https://' + slug + '.paymore.com');
  assert.equal(catalog.status, 'fresh');
  assert.ok(catalog.products.length > 0, 'Expected live listings');
  assert.ok(Date.now() - Date.parse(catalog.checkedAt) < 90_000, 'Fresh timestamp required');
  assert.ok(!('internalCode' in catalog.store), 'Internal store configuration must stay server-side');
  assert.equal(new Set(catalog.products.map(product => product.id)).size, catalog.products.length);
  for (const product of catalog.products) {
    assert.equal(new URL(product.url).hostname, slug + '.paymore.com');
    assert.ok(product.variants.length > 0, 'Available variants required');
    assert.ok(Number.isSafeInteger(product.priceCents) && product.priceCents >= 0);
  }
  const sample = catalog.products[0];
  const shopifyResponse = await fetch(sample.url + '.js');
  assert.equal(shopifyResponse.status, 200, 'Sample Shopify product must load');
  const shopify = await shopifyResponse.json();
  assert.equal(sample.title, shopify.title, 'Displayed title matches Shopify');
  const availableVariants = shopify.variants.filter(variant => variant.available);
  assert.deepEqual(sample.variants.map(variant => variant.id), availableVariants.map(variant => String(variant.id)), 'Displayed choices match Shopify availability');
  assert.deepEqual(sample.variants.map(variant => variant.sku), availableVariants.map(variant => variant.sku?.trim() || null), 'Staff lookup SKUs match Shopify');
  if (/<table\b/i.test(shopify.description || '')) assert.ok(sample.details.some(block => block.kind === 'specifications'), 'Source specifications remain a table');
  assert.equal(sample.priceCents, Math.min(...availableVariants.map(variant => variant.price)), 'Displayed price matches Shopify');
  process.stdout.write('Verified ' + catalog.products.length + ' ' + catalog.store.name + ' listings, host isolation, freshness, specifications, SKUs, and Shopify prices.\n');
}
assert.equal((await fetch(new URL('/api/catalog?store=mi01', base))).status, 404);
assert.equal((await fetch(new URL('/api/catalog?store=https://example.com', base))).status, 400);
assert.equal((await fetch(new URL('/api/catalog?store=taylormi', base), { method: 'POST' })).status, 405);
