import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSelectionSuggestionText,
  positionSelectionSuggestions,
  shouldShowSelectionSuggestions,
} from "./selection-suggestions.ts";

const visibleRect = {
  bottom: 240,
  height: 24,
  left: 300,
  top: 216,
  width: 220,
};

test("selection suggestions normalize whitespace and reject noisy selections", () => {
  assert.equal(
    normalizeSelectionSuggestionText("  Nintendo\n Switch   OLED  "),
    "Nintendo Switch OLED",
  );
  assert.equal(
    shouldShowSelectionSuggestions({
      enabled: true,
      isEditable: false,
      rect: visibleRect,
      selection: "Nintendo Switch OLED",
    }),
    true,
  );
  assert.equal(
    shouldShowSelectionSuggestions({
      enabled: true,
      isEditable: true,
      rect: visibleRect,
      selection: "Nintendo Switch OLED",
    }),
    false,
  );
  assert.equal(
    shouldShowSelectionSuggestions({
      enabled: true,
      isEditable: false,
      rect: visibleRect,
      selection: "x".repeat(301),
    }),
    false,
  );
});

test("selection suggestions stay inside the viewport above or below text", () => {
  assert.deepEqual(
    positionSelectionSuggestions({
      rect: visibleRect,
      viewportHeight: 700,
      viewportWidth: 900,
    }),
    {
      left: 217,
      placement: "above",
      top: 126,
      width: 386,
    },
  );

  assert.deepEqual(
    positionSelectionSuggestions({
      rect: { ...visibleRect, left: 4, top: 20, bottom: 44 },
      viewportHeight: 700,
      viewportWidth: 320,
    }),
    {
      left: 8,
      placement: "below",
      top: 54,
      width: 304,
    },
  );
});
