import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../entrypoints/context-menu.tsx", import.meta.url),
  "utf8",
);

test("selected-text toolbar exposes three search actions and one copy row", () => {
  const ebayIndex = source.indexOf('label: "eBay Prices"');
  const googleIndex = source.indexOf('label: "Search for UPC"');
  const priceChartingIndex = source.indexOf('label: "PriceCharting"');

  assert.ok(ebayIndex >= 0);
  assert.ok(googleIndex > ebayIndex);
  assert.ok(priceChartingIndex > googleIndex);
  assert.match(source, /Copy selected text/);
  assert.match(source, /className="selection-copy"/);
  assert.match(source, /copyToClipboard\(selection\)/);
  assert.match(source, /buildGoogleUpcUrl\(selection\)/);
});

test("selected-text toolbar renders on the next frame and supports dismissal", () => {
  assert.match(source, /selectionPointerIsDown/);
  assert.match(source, /addEventListener\("selectionchange"/);
  assert.match(source, /requestAnimationFrame/);
  assert.doesNotMatch(source, /\}, 240\)/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /closeSelectionSuggestions\(\{ suppressCurrent: true \}\)/);
  assert.match(source, /selection-suggestions-settings-changed/);
});

test("context menu keeps quick icon actions and adds clearer grouping", () => {
  assert.match(source, /className="quick-actions"/);
  assert.match(source, /className="selection-context"/);
  assert.match(source, />Search selected text</);
  assert.match(source, />Tools</);
  assert.match(source, /const enabledItems = useMemo/);
  assert.match(source, /ev\.key === "Escape"/);
});
