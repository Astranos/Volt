import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CONTEXT_ACTIONS,
  linkToTextHighlight,
  normalizeSelectionActions,
  selectionActionUrl,
} from "./selection-actions.ts";

test("selection actions keep user order, remove duplicates, and cap at three", () => {
  assert.deepEqual(
    normalizeSelectionActions(
      ["google-search", "unknown", "google-search", "look-up", "ask-gemini", "ebay"],
      DEFAULT_CONTEXT_ACTIONS,
    ),
    ["google-search", "look-up", "ask-gemini"],
  );
  assert.deepEqual(normalizeSelectionActions([], DEFAULT_CONTEXT_ACTIONS), []);
  assert.deepEqual(normalizeSelectionActions(null, DEFAULT_CONTEXT_ACTIONS), DEFAULT_CONTEXT_ACTIONS);
});

test("search actions encode selected text and non-search actions have no URL", () => {
  assert.equal(
    selectionActionUrl("google-search", "red & blue"),
    "https://www.google.com/search?q=red%20%26%20blue",
  );
  assert.equal(selectionActionUrl("ask-gemini", "red"), null);
});

test("custom actions keep their order and append encoded selected text", () => {
  const custom = { kind: "custom", id: "my-search", label: "My search", iconName: "search-01", iconCodepoint: 0xf14e0, url: "https://example.com/search?q=" };
  assert.deepEqual(normalizeSelectionActions(["ebay", custom, custom, "look-up"], []), ["ebay", custom, "look-up"]);
  assert.equal(selectionActionUrl(custom, "red & blue"), "https://example.com/search?q=red%20%26%20blue");
  assert.equal(selectionActionUrl({ ...custom, url: "https://example.com/search?q=#results" }, "red & blue"), "https://example.com/search?q=red%20%26%20blue#results");
  assert.deepEqual(normalizeSelectionActions([{ ...custom, url: "javascript:alert(1)" }], []), []);
  assert.deepEqual(normalizeSelectionActions([{ ...custom, iconCodepoint: 42 }], []), []);
});

test("highlight links keep the page fragment and add a text directive", () => {
  assert.equal(
    linkToTextHighlight("https://example.com/page#section", "  first\nsecond "),
    "https://example.com/page#section:~:text=first%20second",
  );
  assert.equal(linkToTextHighlight("chrome://settings", "some text"), null);
});
