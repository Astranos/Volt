import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { SelectionSuggestionPill } from "./selection-suggestion-pill";
import { positionSelectionSuggestions } from "../domain/selection-suggestions";

test("renders the selected-text search actions and copy control in order", () => {
  const position = positionSelectionSuggestions({
    rect: { left: 100, width: 100, height: 20, top: 100, bottom: 120 },
    viewportWidth: 800,
    viewportHeight: 600,
  });
  const html = renderToStaticMarkup(<SelectionSuggestionPill onCopy={vi.fn()} onSearch={vi.fn()} position={position} />);
  expect(html).toContain('role="toolbar"');
  expect(html).toContain('aria-label="Actions for selected text"');
  const labels = [...html.matchAll(/<button[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);
  expect(labels).toEqual(["eBay Prices", "Search for UPC", "PriceCharting", "Copy selected text"]);
  expect(html).toContain(`left:${position.left}px`);
  expect(html).toContain(`top:${position.top}px`);
});
