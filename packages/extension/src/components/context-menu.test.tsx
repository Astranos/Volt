import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { ContextMenu, type MenuAction, type OpenMode } from "./context-menu";

const actions: MenuAction[] = [
  { id: "search", label: "Search text", requiresSelection: true, opensUrl: true, onInvoke: vi.fn() },
  { id: "link", label: "Open link", requiresUrl: true, onInvoke: vi.fn() },
  { id: "settings", label: "Settings", onInvoke: vi.fn() },
];

function render(selection: string, clickedUrl: string | null, selectionActionCount = 1, { openMode = "popup" as OpenMode, menuActions = actions } = {}) {
  return renderToStaticMarkup(<ContextMenu actions={menuActions} selectionActionCount={selectionActionCount} quickActions={[]} lastSelection={selection} clickedUrl={clickedUrl} x={0} y={0} closeMenu={vi.fn()} openMode={openMode} dismiss={vi.fn()} />);
}

const checkedOption = (html: string) =>
  html.match(/<button aria-checked="true" class="open-mode-option"[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]+)/)?.[1];

test("without a selection, disables search while retaining general actions", () => {
  const html = render("", null);
  expect(html).toContain('aria-disabled="true"');
  expect(html).toContain("Select text on the page first");
  expect(html).not.toContain('role="radiogroup"');
  expect(html).toContain("Settings");
  expect(html).not.toContain("Open link");
});

test("selection and clicked link enable their corresponding actions", () => {
  const html = render("hello", "https://example.test");
  expect(html).toContain("Search text");
  expect(html).toContain("Open link");
  expect(html).not.toContain('aria-disabled="true"');
});

test("tools heading follows the configured selection actions", () => {
  const html = render("hello", null);
  expect(html.indexOf(">Search<")).toBeLessThan(html.indexOf("Search text"));
  expect(html.indexOf("Tools")).toBeGreaterThan(html.indexOf("Search text"));
  expect(html.indexOf("Tools")).toBeLessThan(html.indexOf("Settings"));
});

test("search section offers a labelled Popup / New tab switch instead of a hover icon", () => {
  const html = render("hello", null);
  expect(html).toContain('role="radiogroup"');
  expect(html).toContain('aria-label="Open results in"');
  expect(checkedOption(html)).toBe("Popup");
  expect(checkedOption(render("hello", null, 1, { openMode: "tab" }))).toBe("New tab");
  expect(html).not.toContain("new-tab-btn");
});

test("open switch is hidden when no selection action opens a URL", () => {
  const menuActions = actions.map((action) => ({ ...action, opensUrl: false }));
  expect(render("hello", null, 1, { menuActions })).not.toContain('role="radiogroup"');
});
