import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../components/sidepanel/UnifiedSidepanel.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../entrypoints/sidepanel/sidepanel.css", import.meta.url), "utf8");

test("tool tabs retain accessible names and selection when visual names collapse", () => {
  assert.match(component, /title=\{tool.label\}/);
  assert.match(component, /aria-label=\{tool.label\}/);
  assert.match(component, /aria-selected=\{selected\}/);
  assert.match(component, /className="sidepanel-tool-tab-label" aria-hidden="true"/);
  assert.match(component, /onClick=\{\(\) => handleToolChange\(tool.id\)\}/);
  assert.match(css, /\.sidepanel-tool-tab:focus-visible\s*\{[^}]*outline:/);
});

test("only the active tool name expands with a reduced-motion-safe transition", () => {
  assert.match(css, /\.sidepanel-tool-tab-label\s*\{[^}]*grid-template-columns: 0fr;[^}]*opacity: 0;[^}]*200ms/s);
  assert.match(css, /\.sidepanel-tool-tab\.is-active \.sidepanel-tool-tab-label\s*\{[^}]*grid-template-columns: 1fr;[^}]*max-width: 160px;[^}]*opacity: 1;/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.sidepanel-tool-tab-label\s*\{\s*transition: none;/s);
  assert.doesNotMatch(css, /\.sidepanel-tool-tab-label > span\s*\{[^}]*text-overflow: ellipsis/);
});
