import test from "node:test";
import assert from "node:assert/strict";
import { runPriceAudit } from "./runner.ts";

const catalog = JSON.stringify({ products: [{ id: 1, title: "Canon camera", handle: "camera", body_html: "Used, good condition", variants: [{ id: 10, title: "Black", available: true, price: "200.00", sku: "C1" }] }] });
const candidates = Array.from({ length: 3 }, (_, index) => ({ id: String(123456789010 + index), url: `https://www.ebay.com/itm/${123456789010 + index}`, text: "Sold Sep 20, 2026 Used Canon camera US $100.00", prices: [{ id: "price_0", cents: 10000, text: "US $100.00" }] }));

function setup(overrides = {}) {
  const updates = [];
  const controller = new AbortController();
  let closed = false;
  let reads = 0;
  const browser = {
    readCatalog: async () => catalog,
    readSearch: async (url) => { reads++; return { url, candidates, nextLinks: [], noResults: false, truncated: false }; },
    close: async () => { closed = true; },
    ...overrides.browser,
  };
  const decisions = {
    reviewItem: async () => true,
    chooseQuery: async () => "Canon camera Black",
    selectComparables: async (_item, values) => values.map((value) => ({ id: value.id, url: value.url, text: value.text, priceCents: value.prices[0].cents, matchProbability: .95, decisionConfidence: .9 })),
    verifyResult: async (_item, values) => values,
    chooseNextPage: async (links) => links[0]?.url ?? null,
    ...overrides.decisions,
  };
  const run = () => runPriceAudit({ settings: { storeUrl: "https://store.com", tolerancePercent: 15, maxSearchPages: 2 }, decisions, signal: controller.signal, onUpdate: (state) => updates.push(state) }, { browser });
  return { updates, controller, run, get closed() { return closed; }, get reads() { return reads; } };
}

test("catalog → Jev review → sold search → matching → verification → exact result", async () => {
  const flow = setup();
  await flow.run();
  const result = flow.updates.at(-1);
  assert.equal(result.status, "complete");
  assert.equal(result.catalogComplete, true);
  assert.equal(result.processed, 1);
  assert.equal(result.results[0].assessment.kind, "high");
  assert.equal(result.results[0].assessment.medianCents, 10000);
  assert.match(result.results[0].searchUrl, /LH_Sold=1/);
  assert.match(result.results[0].searchUrl, /LH_Complete=1/);
  assert.ok(flow.closed);
  assert.ok(!JSON.stringify(result).includes("test-key"));
});

test("Jev's final pass must retain three comparisons for a price classification", async () => {
  const flow = setup({ decisions: { verifyResult: async (_item, values) => values.slice(0, 2) } });
  await flow.run();
  assert.equal(flow.updates.at(-1).results[0].assessment.kind, "insufficient");
});

test("ambiguous store identity skips search and does not guess a value", async () => {
  const flow = setup({ decisions: { reviewItem: async () => false } });
  await flow.run();
  assert.equal(flow.reads, 0);
  assert.equal(flow.updates.at(-1).results[0].assessment.kind, "insufficient");
});

test("deduplication crosses pages; page cap is disclosed", async () => {
  const flow = setup({ browser: { readSearch: async (url) => {
    const next = new URL(url); next.searchParams.set("_pgn", String(Number(next.searchParams.get("_pgn")) + 1));
    return { url, candidates: candidates.slice(0, 2), nextLinks: [{ id: "next", text: "Next", url: next.href }], noResults: false, truncated: false };
  } } });
  await flow.run();
  const result = flow.updates.at(-1).results[0];
  assert.equal(result.comparables.length, 2);
  assert.equal(result.assessment.kind, "insufficient");
  assert.match(result.note, /page limit reached/);
});

test("navigation or API failure retains partial evidence and closes owned tabs", async () => {
  const flow = setup({ decisions: { chooseNextPage: async () => { throw new Error("Pagination blocked"); } } });
  await flow.run();
  const result = flow.updates.at(-1);
  assert.equal(result.status, "error");
  assert.equal(result.results[0].assessment.kind, "insufficient");
  assert.equal(result.results[0].comparables.length, 3);
  assert.ok(flow.closed);
});

test("cancellation never produces a complete audit or verified current result", async () => {
  const flow = setup({ decisions: { verifyResult: async (_item, values) => { flow.controller.abort(); return values; } } });
  await flow.run();
  const result = flow.updates.at(-1);
  assert.equal(result.status, "stopped");
  assert.equal(result.results[0].assessment.kind, "insufficient");
  assert.ok(flow.closed);
});

test("empty public inventory finishes without fabricated comparisons", async () => {
  const flow = setup({ browser: { readCatalog: async () => JSON.stringify({ products: [] }) } });
  await flow.run();
  assert.equal(flow.updates.at(-1).status, "complete");
  assert.equal(flow.updates.at(-1).total, 0);
  assert.equal(flow.reads, 0);
});
