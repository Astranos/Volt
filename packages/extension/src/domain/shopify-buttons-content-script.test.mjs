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
