import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { deepActiveElement, isolateMenuPointerEvents } from "./context-menu-host.ts";

const extensionRequire = createRequire(new URL("../../package.json", import.meta.url));
const { parseHTML } = createRequire(extensionRequire.resolve("wxt"))("linkedom");

test("deepActiveElement follows focus into nested shadow roots", () => {
  const field = { tagName: "S-SEARCH-FIELD" };
  const inner = { tagName: "S-INTERNAL-SEARCH-FIELD" };
  const input = { tagName: "INPUT" };
  field.shadowRoot = { activeElement: inner };
  inner.shadowRoot = { activeElement: input };
  assert.equal(deepActiveElement({ activeElement: field }), input);
  assert.equal(deepActiveElement({ activeElement: input }), input, "plain inputs are returned as-is");
  assert.equal(deepActiveElement({ activeElement: null }), null);
});

test("menu presses keep page focus and never reach the page's outside-click handlers", () => {
  const { document, window } = parseHTML("<html><body><input id='search'></body></html>");
  const host = document.createElement("div");
  const item = document.createElement("div");
  host.appendChild(item);
  document.documentElement.appendChild(host);
  isolateMenuPointerEvents(host);

  const seenByPage = [];
  const seenByMenu = [];
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "auxclick"]) {
    document.addEventListener(type, () => seenByPage.push(type));
    item.addEventListener(type, () => seenByMenu.push(type));
  }

  const events = {};
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "auxclick"]) {
    events[type] = new window.Event(type, { bubbles: true, cancelable: true });
    item.dispatchEvent(events[type]);
  }
  assert.deepEqual(seenByPage, [], "the page must not see presses inside the menu");
  assert.equal(seenByMenu.length, 6, "the menu's own handlers still run");
  assert.equal(events.mousedown.defaultPrevented, true, "mousedown must not move focus out of the page");
  assert.equal(events.click.defaultPrevented, false);

  const outside = new window.Event("mousedown", { bubbles: true, cancelable: true });
  document.getElementById("search").dispatchEvent(outside);
  assert.deepEqual(seenByPage, ["mousedown"], "presses outside the menu are untouched");
  assert.equal(outside.defaultPrevented, false);
});
