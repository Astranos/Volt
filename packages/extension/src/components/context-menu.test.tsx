import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { ContextMenu, type MenuAction } from "./context-menu";

const actions: MenuAction[] = [
  { id: "search", label: "Search text", requiresSelection: true, onInvoke: vi.fn() },
  { id: "link", label: "Open link", requiresUrl: true, onInvoke: vi.fn() },
  { id: "settings", label: "Settings", onInvoke: vi.fn() },
];

function render(selection: string, clickedUrl: string | null, selectionActionCount = 1) {
  return renderToStaticMarkup(<ContextMenu actions={actions} selectionActionCount={selectionActionCount} quickActions={[]} lastSelection={selection} clickedUrl={clickedUrl} x={0} y={0} closeMenu={vi.fn()} openUrl={vi.fn()} dismiss={vi.fn()} />);
}

test("without a selection, disables search while retaining general actions", () => {
  const html = render("", null);
  expect(html).toContain('aria-disabled="true"');
  expect(html).toContain("Select text for search actions");
  expect(html).toContain("Settings");
  expect(html).not.toContain("Open link");
});

test("selection and clicked link enable their corresponding actions", () => {
  const html = render("hello", "https://example.test");
  expect(html).toContain("Search text");
  expect(html).toContain("Open link");
  expect(html).toContain("hello");
  expect(html).not.toContain('aria-disabled="true"');
});

test("tools heading follows the configured selection actions", () => {
  const html = render("hello", null);
  expect(html.indexOf("Search selected text")).toBeLessThan(html.indexOf("Search text"));
  expect(html.indexOf("Tools")).toBeGreaterThan(html.indexOf("Search text"));
  expect(html.indexOf("Tools")).toBeLessThan(html.indexOf("Settings"));
});
