import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../../entrypoints/shopify-buttons.ts", import.meta.url),
  "utf8",
);

test("Shopify quick actions use the visible title input inside Shopify web components", () => {
  assert.match(
    source,
    /const shadowInput = shopifyField\.shadowRoot\?\.querySelector\("input"\);/,
  );
  assert.match(source, /return shadowInput \|\| shopifyField;/);
});

test("Shopify quick actions anchor outside the product section shadow root", () => {
  assert.match(
    source,
    /findShopifyTitleField\(\)\?\.closest\("s-internal-section"\)/,
  );
  assert.match(
    source,
    /shopifySection\?\.shadowRoot\?\.querySelector\("section"\)/,
  );
  assert.match(
    source,
    /if \(sectionCard && looksLikeProductCard\(sectionCard\)\)/,
  );
  assert.ok(
    source.indexOf("return sectionCard;") <
      source.indexOf("titleRect.left - 64"),
    "the product card anchor must win before the title-input fallback",
  );
  assert.match(source, /rect\.left - tabWidth - gap/);
});
