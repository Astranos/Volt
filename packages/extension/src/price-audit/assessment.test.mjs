import assert from "node:assert/strict";
import test from "node:test";
import { assessPrice } from "./assessment.ts";

const item = { id: "store:1", title: "Camera", variant: "Black", sku: "CAM", description: "Used", url: "https://shop.example/products/camera", priceCents: 10000, currency: "USD" };
const comps = (prices = [9000, 10000, 11000]) => prices.map((priceCents, index) => ({ id: `${index}`, url: `https://www.ebay.com/itm/${index}`, text: "Sold used camera", priceCents, confidence: 0.9 }));

test("inclusive fair band and one-cent boundaries", () => {
  for (const [priceCents, expected] of [[8499, "low"], [8500, "fair"], [10000, "fair"], [11500, "fair"], [11501, "high"]]) {
    const result = assessPrice({ ...item, priceCents }, comps(), 15);
    assert.equal(result.kind, expected);
    assert.equal(result.medianCents, 10000);
    assert.equal(result.lowCents, 8500);
    assert.equal(result.highCents, 11500);
  }
});

test("zero tolerance and fractional-cent bands", () => {
  assert.equal(assessPrice(item, comps(), 0).kind, "fair");
  assert.equal(assessPrice({ ...item, priceCents: 9999 }, comps(), 0).kind, "low");
  assert.equal(assessPrice({ ...item, priceCents: 10001 }, comps(), 0).kind, "high");
  const result = assessPrice({ ...item, priceCents: 101 }, comps([100, 101, 102]), 15);
  assert.equal(result.lowCents, 86);
  assert.equal(result.highCents, 116);
});

test("sorts without changing inputs and rounds even median half-cent up", () => {
  const input = comps([104, 100, 101, 102]);
  const before = structuredClone(input);
  const result = assessPrice({ ...item, priceCents: 102 }, input, 0);
  assert.equal(result.medianCents, 102);
  assert.equal(result.differencePercent, 0);
  assert.deepEqual(input, before);
});

test("duplicates do not count toward minimum or weight the median", () => {
  const input = comps();
  assert.equal(assessPrice(item, [input[0], input[0], input[1]], 15).kind, "insufficient");
  assert.equal(assessPrice(item, [...input, input[0], input[0]], 15).medianCents, 10000);
  assert.equal(assessPrice(item, [...input, { ...input[0], priceCents: 9999 }], 15).kind, "insufficient");
});

test("rejects absent, invalid, and low-confidence evidence even with three valid comps", () => {
  for (const input of [[], comps([1]), comps([1, 2])]) assert.equal(assessPrice(item, input, 15).kind, "insufficient");
  for (const priceCents of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(assessPrice(item, [...comps(), { ...comps()[0], id: "extra", priceCents }], 15).kind, "insufficient");
    assert.equal(assessPrice({ ...item, priceCents }, comps(), 15).kind, "insufficient");
  }
  for (const confidence of [0, 0.8499, -1, 1.01, NaN, Infinity]) {
    assert.equal(assessPrice(item, [...comps(), { ...comps()[0], id: "extra", confidence }], 15).kind, "insufficient");
  }
  assert.equal(assessPrice(item, comps().map((entry) => ({ ...entry, confidence: 0.85 })), 15).kind, "fair");
  assert.equal(assessPrice(item, [...comps(), { ...comps()[0], id: " " }], 15).kind, "insufficient");
});

test("rejects unsupported currency and invalid tolerance", () => {
  assert.equal(assessPrice({ ...item, currency: "CAD" }, comps(), 15).kind, "insufficient");
  for (const tolerance of [-1, 100.01, NaN, Infinity]) assert.equal(assessPrice(item, comps(), tolerance).kind, "insufficient");
  assert.equal(assessPrice(item, comps(), 100).kind, "fair");
  assert.equal(assessPrice(item, comps(), 15.5).kind, "fair");
});

test("large safe cents avoid median overflow and reject overflowing bands", () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const input = comps([maximum - 3, maximum - 2, maximum - 1, maximum]);
  assert.equal(assessPrice({ ...item, priceCents: maximum - 1 }, input, 0).medianCents, maximum - 1);
  assert.equal(assessPrice(item, input, 15).kind, "insufficient");
});
