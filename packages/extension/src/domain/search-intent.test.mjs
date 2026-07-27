import assert from "node:assert/strict";
import test from "node:test";

import {
  getSearchPrefixMode,
  parseSearchPrefix,
  resolveNewTabSearchIntent,
} from "./search-intent.ts";

test("plain new-tab queries stay inside closed-tab search", () => {
  assert.equal(
    resolveNewTabSearchIntent("iphone", {
      activeMode: "closed-tabs",
      providers: [],
    }),
    null,
  );
});

test("getSearchPrefixMode resolves exact one-character new-tab search prefixes", () => {
  assert.equal(getSearchPrefixMode("g"), null);
  assert.equal(getSearchPrefixMode(" e "), "ebay");
  assert.equal(getSearchPrefixMode("p"), "pricecharting");
  assert.equal(getSearchPrefixMode("u"), "barcodelookup");
  assert.equal(getSearchPrefixMode("s"), "shopify");
});

test("getSearchPrefixMode ignores partial queries and unknown prefixes", () => {
  assert.equal(getSearchPrefixMode(""), null);
  assert.equal(getSearchPrefixMode("x"), null);
  assert.equal(getSearchPrefixMode("e iphone"), null);
  assert.equal(getSearchPrefixMode("ebay"), null);
});

test("parseSearchPrefix keeps requiring a query after the prefix", () => {
  assert.deepEqual(parseSearchPrefix("e "), { mode: null, query: "e " });
  assert.deepEqual(parseSearchPrefix("g iphone"), {
    mode: null,
    query: "g iphone",
  });
  assert.deepEqual(parseSearchPrefix("e iphone"), {
    mode: "ebay",
    query: "iphone",
  });
});
