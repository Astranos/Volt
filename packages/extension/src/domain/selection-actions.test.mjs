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

test("highlight links keep the page fragment and add a text directive", () => {
  assert.equal(
    linkToTextHighlight("https://example.com/page#section", "  first\nsecond "),
    "https://example.com/page#section:~:text=first%20second",
  );
  assert.equal(linkToTextHighlight("chrome://settings", "some text"), null);
});
