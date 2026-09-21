import assert from "node:assert/strict";
import test from "node:test";
import { computeToolTabIndicator } from "./tool-tab-indicator.ts";

test("computes the active tab geometry", () => {
  assert.deepEqual(computeToolTabIndicator([{ offsetLeft: 8, offsetWidth: 72 }], 0), {
    x: 8,
    width: 72,
    visible: true,
  });
});

test("hides the indicator for missing or invalid tabs", () => {
  assert.deepEqual(computeToolTabIndicator(null, 0), { x: 0, width: 0, visible: false });
  assert.deepEqual(computeToolTabIndicator([], 0), { x: 0, width: 0, visible: false });
  assert.deepEqual(computeToolTabIndicator([{ offsetLeft: 8, offsetWidth: 72 }], 2), { x: 0, width: 0, visible: false });
  assert.deepEqual(computeToolTabIndicator([{ offsetLeft: Number.NaN, offsetWidth: 72 }], 0), { x: 0, width: 0, visible: false });
  assert.deepEqual(computeToolTabIndicator([{ offsetLeft: 8, offsetWidth: Number.POSITIVE_INFINITY }], 0), { x: 0, width: 0, visible: false });
});

test("rejects fractional active indexes", () => {
  assert.deepEqual(computeToolTabIndicator([
    { offsetLeft: 8, offsetWidth: 72 },
    { offsetLeft: 84, offsetWidth: 72 },
  ], 0.5), { x: 0, width: 0, visible: false });
});

test("supports a single tab", () => {
  assert.deepEqual(computeToolTabIndicator([{ offsetLeft: 12, offsetWidth: 64 }], 0), {
    x: 12,
    width: 64,
    visible: true,
  });
  assert.deepEqual(computeToolTabIndicator([{ offsetLeft: 12, offsetWidth: 64 }], 1), { x: 0, width: 0, visible: false });
});

test("clamps negative geometry", () => {
  assert.deepEqual(computeToolTabIndicator([{ offsetLeft: -4, offsetWidth: -8 }], 0), {
    x: 0,
    width: 0,
    visible: true,
  });
});
