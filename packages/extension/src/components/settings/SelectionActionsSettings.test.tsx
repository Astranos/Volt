import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { SelectionActionsSettings } from "./SelectionActionsSettings";

test("each selected action can be replaced even when both menus are full", () => {
  const html = renderToStaticMarkup(
    <SelectionActionsSettings settings={DEFAULT_SETTINGS} saveSettings={vi.fn()} />,
  );

  expect(html.match(/aria-label="Action \d in (Highlighted text popup|Right click menu)"/g)).toHaveLength(6);
  expect(html.match(/Create custom action\.\.\./g)).toHaveLength(6);
  expect(html).toContain("Search Google");
  expect(html).not.toContain("Move eBay Prices up");
});
