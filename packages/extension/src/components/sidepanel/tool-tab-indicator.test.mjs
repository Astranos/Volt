import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { computeToolTabIndicator } from "./tool-tab-indicator.ts";

test("renders one sliding underline without a pill or duplicate active border", () => {
  const css = readFileSync(new URL("../../../entrypoints/sidepanel/sidepanel.css", import.meta.url), "utf8");
  const indicator = css.match(/\.sidepanel-tool-tab-indicator\s*\{([^}]+)\}/)?.[1];
  assert.ok(indicator);
  assert.match(indicator, /height:\s*2px/);
  assert.match(indicator, /bottom:\s*0/);
  assert.doesNotMatch(indicator, /border-radius|box-shadow|\btop:/);
  const activeTab = css.match(/\.sidepanel-tool-tab\.is-active\s*\{([^}]+)\}/)?.[1];
  assert.ok(activeTab);
  assert.doesNotMatch(activeTab, /border-bottom-color/);
});

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
