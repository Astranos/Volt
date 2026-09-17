import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = new URL(process.argv[2] || 'http://127.0.0.1:4175');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('This check creates a temporary request. Use a local development server.');
const storeSlug = 'taylormi';
async function call(path, method = 'GET', body) {
  const response = await fetch(new URL(path, base), { method, headers: { 'Content-Type': 'application/json', Origin: base.origin }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
const catalog = await call('/api/catalog?store=' + storeSlug);
const product = catalog.products[0];
assert.ok(product, 'A real available product is required');
const variant = product.variants[0];
const payload = { storeSlug, productId: product.id, variantId: variant.id, requestKey: `${randomUUID()}:${variant.id}` };
const receipt = await call('/api/requests', 'POST', payload);
try {
  assert.equal(receipt.expiresAt - receipt.createdAt, 3_600_000);
  assert.equal((await call('/api/requests', 'POST', payload)).id, receipt.id, 'Repeated taps must not duplicate requests');
  let queue = await call('/api/requests?store=' + storeSlug);
  const matching = queue.requests.filter(item => item.id === receipt.id);
  assert.equal(matching.length, 1);
  assert.equal(matching[0].sku, variant.sku);
  assert.equal(matching[0].title, product.title);
  assert.ok(!('clientHash' in matching[0]) && !('requestKey' in matching[0]));
  const otherStore = await call('/api/requests?store=southfieldmi');
  assert.ok(!otherStore.requests.some(item => item.id === receipt.id), 'Store isolation required');
  await call('/api/requests', 'PATCH', { storeSlug, id: receipt.id, status: 'found' });
  queue = await call('/api/requests?store=' + storeSlug);
  assert.equal(queue.requests.find(item => item.id === receipt.id)?.status, 'found');
  await call('/api/requests', 'PATCH', { storeSlug, id: receipt.id, status: 'shown' });
  queue = await call('/api/requests?store=' + storeSlug);
  assert.ok(!queue.requests.some(item => item.id === receipt.id));
  const again = await call('/api/requests', 'POST', payload);
  assert.equal(again.id, receipt.id);
  assert.equal(again.status, 'shown');
  process.stdout.write('Verified request delivery, exact SKU, duplicate protection, franchise isolation, staff status changes, and one-hour expiry timestamp.\n');
} finally {
  // A terminal request stays closed; clear only if an earlier assertion failed.
  const queue = await call('/api/requests?store=' + storeSlug);
  if (queue.requests.some(item => item.id === receipt.id)) await call('/api/requests', 'PATCH', { storeSlug, id: receipt.id, status: 'cleared' });
}
