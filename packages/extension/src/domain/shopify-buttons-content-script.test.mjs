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

function mount({ modern = true, card = true, width = 720, settings = {}, stored = {} } = {}) {
  let availableWidth = width;
  const { document, window } = parseHTML(`<html><head></head><body><main>${modern
    ? '<s-internal-section><s-internal-text-field name="title"></s-internal-text-field></s-internal-section>'
    : '<div class="Polaris-Card"><label for="title">Title</label><input id="title" name="title" value="Dell Latitude"><div>Description</div></div>'
  }</main></body></html>`);
  const title = document.querySelector('[name="title"]');
  const host = title.parentElement;
  // Shopify's web components are `:host { display: contents }`: hosts measure
  // 0x0 and ignore margins. The card box is the shadow <section>.
  let container = host;
  if (modern) {
    const input = document.createElement("input");
    input.value = "Dell Latitude";
    title.attachShadow({ mode: "open" }).appendChild(input);
    if (card) {
      const section = document.createElement("section");
      section.className = "Polaris-Card";
      section.appendChild(document.createElement("slot"));
      host.attachShadow({ mode: "open" }).appendChild(section);
      container = section;
    }
  }
  // Linkedom omits this standard CSSOM method.
  Object.getPrototypeOf(container.style).getPropertyPriority = () => "";
  window.screen = { width: 1440, height: 900 };
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.id === "volt-quick-actions-overlay") return { left: 0, top: 0, width: 120, height: 28 };
    if (this.tagName.startsWith("S-INTERNAL")) return { left: 0, top: 0, right: 0, width: 0, height: 0 };
    const gutter = parseFloat(this.style.getPropertyValue("margin-inline-start")) || 0;
    return { left: 296 + gutter, top: 176, width: availableWidth - gutter, height: 400 };
  };
  if (!card) host.className = "";
  const location = { href: "https://admin.shopify.com/store/test/products/123" };
  let frame;
  const messages = [];
  let onMessage;
  let onStorageChanged;
  const context = vm.createContext({
    exports: {}, defineContentScript: (config) => config, document, window, location,
    history: { pushState() {}, replaceState() {} },
    MutationObserver: class { observe() {} },
    requestAnimationFrame(callback) { frame = callback; }, setTimeout() {}, setInterval() {},
    console: { log() {} },
    chrome: {
      runtime: { getURL: (path) => path, onMessage: { addListener(callback) { onMessage = callback; } }, sendMessage: (message) => messages.push(message) },
      storage: {
        sync: { get: (_, callback) => callback({ cmdkSettings: settings, ...stored }) },
        onChanged: { addListener(callback) { onStorageChanged = callback; } },
      },
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
  return { document, window, host, container, location, messages, frame: () => frame(), resize: (width) => { availableWidth = width; frame(); }, settings: (enabled) => onMessage({ action: "shopify-buttons-settings-changed", enabled }),
    storageChanged: (changes) => onStorageChanged(changes, "sync") };
}

for (const modern of [true, false]) {
  test(`research actions reserve an external gutter (${modern ? "shadow" : "legacy"} card)`, () => {
    const { document, host, container, frame } = mount({ modern });
    const toolbar = document.getElementById("volt-quick-actions-overlay");
    assert.equal(toolbar.parentElement, document.body, "gutter must escape shadow clipping");
    assert.equal(toolbar.dataset.layout, "gutter");
    assert.equal(container.style.getPropertyValue("margin-inline-start"), "40px");
    assert.equal(container.style.getPropertyValue("max-width"), "calc(100% - 40px)");
    if (modern) assert.ok(!host.style.getPropertyValue("margin-inline-start"), "margins on a contents host do nothing");
    assert.equal(toolbar.style.left, "296px");
    assert.equal(toolbar.style.top, "192px");
    frame();
    assert.equal(document.querySelectorAll("#volt-quick-actions-overlay").length, 1);
  });
}

for (const options of [{ width: 480 }, { modern: false, width: 480 }, { card: false }]) {
  test(`narrow or unknown forms place actions above the title input (${JSON.stringify(options)})`, () => {
    const { document, container, frame } = mount(options);
    const toolbar = document.getElementById("volt-quick-actions-overlay");
    let moves = 0;
    const countMove = (method) => function (...args) { moves++; return method.apply(this, args); };
    document.body.appendChild = countMove(document.body.appendChild);
    container.insertBefore = countMove(container.insertBefore);
    frame();
    assert.equal(moves, 0, "a settled toolbar must not be reinserted every frame");
    assert.equal(toolbar.parentElement, document.body, "never insert into Shopify-owned nodes");
    assert.equal(toolbar.dataset.layout, "title");
    const fieldRight = 296 + (options.width ?? 720);
    assert.equal(toolbar.style.left, `${fieldRight - 120}px`);
    assert.equal(toolbar.style.top, "140px", "no label text: sit 8px above the input");
    assert.equal(toolbar.style.visibility, "");
    assert.ok(!container.style.getPropertyValue("margin-inline-start"));
    assert.equal(document.querySelector("#volt-tab-ebay .volt-action-label"), null);
    assert.equal(document.querySelector("#volt-tab-pc .volt-action-label").textContent, "UPC");
    assert.equal(document.querySelector("#volt-tab-ebay img").getAttribute("src"), "assets/logos/ebay-wordmark.svg");
  });
}

test("toolbar stays hidden until the title input has a box", () => {
  const { document, window, frame } = mount({ width: 480 });
  const toolbar = document.getElementById("volt-quick-actions-overlay");
  const measure = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.tagName === "INPUT" ? { left: 0, top: 0, width: 0, height: 0 } : measure.call(this);
  };
  frame();
  assert.equal(toolbar.style.visibility, "hidden");
  window.HTMLElement.prototype.getBoundingClientRect = measure;
  frame();
  assert.equal(toolbar.style.visibility, "");
});

test("disabled actions fade their icon, not their tooltip", () => {
  const { document } = mount();
  const styles = document.getElementById("volt-quick-actions-styles").textContent;
  assert.doesNotMatch(styles, /\.volt-action-tab\.disabled \{[^}]*opacity/);
  assert.match(styles, /\.volt-action-tab\.disabled > \* \{\s*opacity: 0\.45;/);
  assert.equal(document.getElementById("volt-tab-pc").getAttribute("data-tooltip"), "No UPC found");
});

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
  assert.equal(document.getElementById("volt-quick-actions-overlay").dataset.layout, "title");
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

test("research actions open a new tab on modifier or middle click, or when preferred", () => {
  const { document, messages, storageChanged, frame } = mount();
  const ebay = document.getElementById("volt-tab-ebay");
  const click = (event = {}) => ebay.onclick({ stopPropagation() {}, preventDefault() {}, button: 0, ...event });
  click();
  click({ metaKey: true });
  click({ ctrlKey: true });
  ebay.onauxclick({ stopPropagation() {}, preventDefault() {}, button: 1 });
  ebay.onauxclick({ stopPropagation() {}, preventDefault() {}, button: 2 });
  assert.deepEqual(messages.map((message) => message.action),
    ["openPreviewPopup", "openUrl", "openUrl", "openUrl"]);
  frame();
  assert.match(ebay.getAttribute("data-tooltip"), /\nCtrl\+click to open in a new tab$/);

  storageChanged({ cmdkSettings: { newValue: { shopifyButtons: { enabled: true } } } });
  click();
  assert.equal(messages.at(-1).action, "openPreviewPopup", "unrelated settings changes keep the mode");
  storageChanged({ openSearchResultsIn: { newValue: "tab" } });
  click();
  assert.equal(messages.at(-1).action, "openUrl");
  assert.match(messages.at(-1).url, /_nkw=Dell%20Latitude.*LH_Sold=1/);
});

test("stored new-tab preference applies on load and drops the hint", () => {
  const { document, messages, frame } = mount({ stored: { openSearchResultsIn: "tab" } });
  document.getElementById("volt-tab-ebay").onclick({ stopPropagation() {}, button: 0 });
  assert.equal(messages[0].action, "openUrl");
  frame();
  const tooltip = document.getElementById("volt-tab-ebay").getAttribute("data-tooltip");
  assert.equal(tooltip, "Search eBay sold prices: Dell Latitude");
});

test("toolbar follows a replaced product section and leaves non-product pages", () => {
  const { document, host, container, location, frame } = mount();
  const replacement = host.cloneNode(true);
  const section = document.createElement("section");
  section.className = "Polaris-Card";
  section.appendChild(document.createElement("slot"));
  replacement.attachShadow({ mode: "open" }).appendChild(section);
  host.replaceWith(replacement);
  frame();
  assert.equal(document.getElementById("volt-quick-actions-overlay").dataset.layout, "gutter");
  assert.ok(!container.style.getPropertyValue("margin-inline-start"));
  assert.equal(section.style.getPropertyValue("margin-inline-start"), "40px");
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
