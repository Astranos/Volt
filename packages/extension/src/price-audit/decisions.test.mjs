import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditDecisions } from '../../../../convex/priceAudit/decisions.ts';

const item = { id: '1', title: 'Phone X', variant: '128GB Used', sku: 'sku', description: 'Used phone', url: 'https://store.test/products/phone', priceCents: 10000, currency: 'USD' };
const signal = new AbortController().signal;
const client = (choice, confidence = .95) => ({ choose: async (_, questions) => Object.fromEntries(Object.keys(questions).map(id => [id, { choice, confidence }])) });
test('reviews and queries conservatively', async () => {
  assert.equal(await createAuditDecisions(client('accept')).reviewItem(item, signal), true);
  assert.equal(await createAuditDecisions(client('accept', .84)).reviewItem(item, signal), false);
  assert.equal(await createAuditDecisions(client('query_0')).chooseQuery(item, signal), 'Phone X 128GB Used');
  assert.equal(await createAuditDecisions(client('reject')).chooseQuery(item, signal), null);
});
test('selects only exact observed prices with confidence and bounded batches', async () => {
  let calls = 0;
  const decisions = createAuditDecisions({ choose: async (state, questions) => {
    calls++; assert.ok(Object.keys(state.listings).length <= 6);
    for (const q of Object.values(questions)) {
      assert.match(q.instructions, /untrusted evidence/);
      assert.match(q.instructions, /best-offer/);
      assert.match(q.instructions, /SOLD/);
    }
    return Object.fromEntries(Object.keys(questions).map((id, index) => [id, { choice: index === 1 ? 'reject' : 'price_1', confidence: index === 2 ? .5 : .95 }]));
  } });
  const candidates = Array.from({ length: 7 }, (_, i) => ({ id: String(i), url: `https://www.ebay.com/itm/${i}`, text: 'Phone X 128GB Used Sold', prices: [{ id: 'a', text: '$200', cents: 20000 }, { id: 'b', text: '$100', cents: 10000 }] }));
  const accepted = await decisions.selectComparables(item, candidates, signal);
  assert.equal(calls, 2); assert.equal(accepted.length, 5);
  assert.ok(accepted.every(c => c.priceCents === 10000));
});
test('pagination distinguishes end and ambiguity', async () => {
  const links = [{ id: 'next', text: 'Next', url: 'https://www.ebay.com/sch/?page=2' }];
  assert.equal(await createAuditDecisions(client('link_0')).chooseNextPage(links, signal), links[0].url);
  await assert.rejects(createAuditDecisions(client('end')).chooseNextPage(links, signal), /partial/);
  assert.equal(await createAuditDecisions(client('uncertain')).chooseNextPage([], signal), null);
  await assert.rejects(createAuditDecisions(client('uncertain')).chooseNextPage(links, signal), /partial/);
  await assert.rejects(createAuditDecisions(client('end', .5)).chooseNextPage(links, signal), /partial/);
});
test('verification rejects any unsupported batch', async () => {
  const comparable = { id: 'a', url: 'https://www.ebay.com/itm/1', text: 'sold', priceCents: 10000, confidence: .95 };
  let calls = 0;
  const decisions = createAuditDecisions({ choose: async (_, questions) => { calls++; assert.match(questions.verification.instructions, /not arithmetic/); return { verification: { choice: calls === 1 ? 'accept' : 'reject', confidence: .95 } }; } });
  assert.equal(await decisions.verifyResult(item, Array(7).fill(comparable), signal), false);
  assert.equal(calls, 2);
  assert.equal(await decisions.verifyResult(item, [], signal), false);
});
