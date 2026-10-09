import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const extensionRequire = createRequire(new URL("../../package.json", import.meta.url));
// WXT already uses this DOM implementation; exercise the actual content script.
const { parseHTML } = createRequire(extensionRequire.resolve("wxt"))("linkedom");
const source = await readFile(new URL("../../entrypoints/shopify-buttons.ts", import.meta.url), "utf8");
const script = ts.transpileModule(source.replace(/^import .*define-content-script.*;$/m, ""), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function mount({ modern = true, card = true, width = 720 } = {}) {
  let availableWidth = width;
  const { document, window } = parseHTML(`<html><head></head><body><main>${modern
    ? '<s-internal-section><s-internal-text-field name="title"></s-internal-text-field></s-internal-section>'
    : '<div class="Polaris-Card"><label for="title">Title</label><input id="title" name="title" value="Dell Latitude"><div>Description</div></div>'
  }</main></body></html>`);
  const title = document.querySelector('[name="title"]');
  let container = title.parentElement;
  if (modern) {
    const input = document.createElement("input");
    input.value = "Dell Latitude";
    title.attachShadow({ mode: "open" }).appendChild(input);
    if (card) {
      const section = document.createElement("section");
      section.className = "Polaris-Card";
      section.appendChild(document.createElement("slot"));
      section.getBoundingClientRect = () => ({ left: 280, top: 160, width: 720, height: 600 });
      container.attachShadow({ mode: "open" }).appendChild(section);
    }
  }
  // Linkedom omits this standard CSSOM method.
  Object.getPrototypeOf(container.style).getPropertyPriority = () => "";
  window.screen = { width: 1440, height: 900 };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const gutter = parseFloat(this.style.getPropertyValue("margin-inline-start")) || 0;
    return { left: 296 + gutter, top: 176, width: availableWidth - gutter, height: 400 };
  };
  if (!card) container.className = "";
  const location = { href: "https://admin.shopify.com/store/test/products/123" };
  let frame;
  const messages = [];
  let onMessage;
  const context = vm.createContext({
    exports: {}, defineContentScript: (config) => config, document, window, location,
    history: { pushState() {}, replaceState() {} },
    MutationObserver: class { observe() {} },
    requestAnimationFrame(callback) { frame = callback; }, setTimeout() {}, setInterval() {},
    console: { log() {} },
    chrome: {
      runtime: { getURL: (path) => path, onMessage: { addListener(callback) { onMessage = callback; } }, sendMessage: (message) => messages.push(message) },
      storage: { sync: { get: (_, callback) => callback({}) } },
    },
  });
  window.getComputedStyle = (element) => ({
    marginInlineStart: element.style.getPropertyValue("margin-inline-start") || "0px",
    marginInlineEnd: "0px", maxWidth: element.style.getPropertyValue("max-width") || "none",
    backgroundColor: "transparent", boxShadow: "none", borderRadius: "0px", borderColor: "rgba(0, 0, 0, 0)" });
  document.readyState = "complete";
  vm.runInContext(script, context);
  context.exports.default.main();
  frame();
  return { document, window, container, location, messages, frame: () => frame(), resize: (width) => { availableWidth = width; frame(); }, settings: (enabled) => onMessage({ action: "shopify-buttons-settings-changed", enabled }) };
}

for (const modern of [true, false]) {
  test(`research actions reserve an external gutter (${modern ? "shadow" : "legacy"} card)`, () => {
    const { document, container, frame } = mount({ modern });
    const toolbar = document.getElementById("volt-quick-actions-overlay");
    assert.equal(toolbar.parentElement, document.body, "gutter must escape shadow clipping");
    assert.equal(toolbar.dataset.layout, "gutter");
    assert.equal(container.style.getPropertyValue("margin-inline-start"), "40px");
    assert.equal(container.style.getPropertyValue("max-width"), "calc(100% - 40px)");
    assert.equal(toolbar.style.left, "296px");
    assert.equal(toolbar.style.top, "192px");
    frame();
    assert.equal(document.querySelectorAll("#volt-quick-actions-overlay").length, 1);
  });
}

for (const options of [{ width: 480 }, { modern: false, width: 480 }, { card: false }]) {
  test(`narrow or unknown forms use compact inline actions (${JSON.stringify(options)})`, () => {
    const { document, container, frame } = mount(options);
    const toolbar = document.getElementById("volt-quick-actions-overlay");
    let moves = 0;
    const countMove = (method) => function (...args) { moves++; return method.apply(this, args); };
    document.body.appendChild = countMove(document.body.appendChild);
    container.insertBefore = countMove(container.insertBefore);
    frame();
    assert.equal(moves, 0, "a settled toolbar must not be reinserted every frame");
    assert.equal(toolbar.parentElement, container);
    assert.equal(container.firstChild, toolbar);
    assert.equal(toolbar.dataset.layout, "inline");
    assert.ok(!toolbar.style.left);
    assert.ok(!container.style.getPropertyValue("margin-inline-start"));
    const styles = document.getElementById("volt-quick-actions-styles").textContent;
    assert.match(styles, /justify-content: flex-end;/);
    assert.match(styles, /height: 28px;/);
    assert.match(styles, /margin: 0 0 0 auto;/);
    assert.equal(document.querySelector("#volt-tab-ebay .volt-action-label"), null);
    assert.equal(document.querySelector("#volt-tab-pc .volt-action-label").textContent, "UPC");
    assert.equal(document.querySelector(".volt-volt-badge"), null);
    assert.equal(document.querySelector("#volt-tab-ebay img").getAttribute("src"), "assets/logos/ebay-wordmark.svg");
  });
}

test("resize restores original card styles, then reserves the gutter again", () => {
  const { container, document, resize, location, frame } = mount({ width: 480 });
  container.style.setProperty("margin-inline-start", "12px");
  container.style.setProperty("max-width", "900px");
  resize(720);
  assert.equal(container.style.getPropertyValue("margin-inline-start"), "52px");
  assert.equal(container.style.getPropertyValue("max-width"), "min(900px, calc(100% - 52px))");
  resize(480);
  assert.equal(container.style.getPropertyValue("margin-inline-start"), "12px");
  assert.equal(container.style.getPropertyValue("max-width"), "900px");
  assert.equal(document.getElementById("volt-quick-actions-overlay").dataset.layout, "inline");
  resize(720);
  assert.equal(document.getElementById("volt-quick-actions-overlay").dataset.layout, "gutter");
  location.href = "https://admin.shopify.com/store/test/orders";
  frame();
  assert.equal(container.style.getPropertyValue("margin-inline-start"), "12px");
  assert.equal(container.style.getPropertyValue("max-width"), "900px");
});

test("cleanup preserves newer Shopify inline style changes", () => {
  const { container, location, frame } = mount();
  container.style.setProperty("max-width", "700px");
  location.href = "https://admin.shopify.com/store/test/orders";
  frame();
  assert.equal(container.style.getPropertyValue("max-width"), "700px");
});

test("research action reads Shopify's shadow title and still opens sold listings", () => {
  const { document, messages } = mount();
  document.getElementById("volt-tab-ebay").onclick({ stopPropagation() {} });
  assert.equal(messages[0].action, "openPreviewPopup");
  assert.match(messages[0].url, /_nkw=Dell%20Latitude.*LH_Sold=1/);
});

test("toolbar follows a replaced product section and leaves non-product pages", () => {
  const { document, container, location, frame } = mount();
  const replacement = container.cloneNode(true);
  replacement.style.removeProperty("margin-inline-start");
  replacement.style.removeProperty("max-width");
  const section = document.createElement("section");
  section.className = "Polaris-Card";
  section.appendChild(document.createElement("slot"));
  replacement.attachShadow({ mode: "open" }).appendChild(section);
  container.replaceWith(replacement);
  frame();
  assert.equal(document.getElementById("volt-quick-actions-overlay").dataset.layout, "gutter");
  assert.ok(!container.style.getPropertyValue("margin-inline-start"));
  assert.equal(replacement.style.getPropertyValue("margin-inline-start"), "40px");
  location.href = "https://admin.shopify.com/store/test/orders";
  frame();
  assert.equal(document.getElementById("volt-quick-actions-overlay"), null);
});


test("disabling research actions releases the gutter until explicitly enabled again", () => {
  const { container, document, settings, frame } = mount();
  settings(false);
  frame();
  assert.equal(document.getElementById("volt-quick-actions-overlay"), null);
  assert.ok(!container.style.getPropertyValue("margin-inline-start"));
  settings(true);
  assert.equal(document.getElementById("volt-quick-actions-overlay").dataset.layout, "gutter");
  assert.equal(container.style.getPropertyValue("margin-inline-start"), "40px");
});


test("restoration compares canonical CSSOM values after reserving the gutter", () => {
  const { container, resize } = mount({ width: 480 });
  container.style.setProperty("max-width", "900px");
  const prototype = Object.getPrototypeOf(container.style);
  const originalSetProperty = prototype.setProperty;
  prototype.setProperty = function (name, value, priority) {
    return originalSetProperty.call(this, name,
      value === "min(900px, calc(100% - 40px))" ? "min(900px, 100% - 40px)" : value, priority);
  };
  try {
    resize(720);
    assert.equal(container.style.getPropertyValue("max-width"), "min(900px, 100% - 40px)");
    resize(480);
    assert.equal(container.style.getPropertyValue("max-width"), "900px");
  } finally {
    prototype.setProperty = originalSetProperty;
  }
});
