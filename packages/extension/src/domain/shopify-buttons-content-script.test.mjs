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
  let checkFields;
  const messages = [];
  let onMessage;
  const context = vm.createContext({
    exports: {}, defineContentScript: (config) => config, document, window, location,
    history: { pushState() {}, replaceState() {} },
    MutationObserver: class { observe() {} },
    requestAnimationFrame(callback) { frame = callback; }, setTimeout() {}, setInterval(callback) { checkFields = callback; },
    console: { log() {} },
    chrome: {
      runtime: { getURL: (path) => path, onMessage: { addListener(callback) { onMessage = callback; } }, sendMessage: (message) => messages.push(message) },
      storage: {
        sync: { get: (_, callback) => callback({ cmdkSettings: settings, ...stored }) },
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
    poll: () => { checkFields(); frame(); } };
}

function addShadowUpc(document, value) {
  const container = document.createElement("div");
  container.id = "PRODUCT.metafields.custom.upc-anchor";
  const field = document.createElement("s-internal-quick-text-field");
  field.setAttribute("accessibilitylabel", "UPC");
  field.value = "";
  const root = field.attachShadow({ mode: "open" });
  const display = document.createElement("span");
  display.className = "display-value";
  display.textContent = value;
  const input = document.createElement("input");
  input.value = value;
  root.append(display, input);
  container.appendChild(field);
  document.querySelector("main").appendChild(container);
  return input;
}

test("the toolbar's CSS clears Shopify's z-index 100 app frame", () => {
  const { document } = mount();
  // Linkedom has no paint/hit-testing engine. Lock down the external layer
  // contract here; verify actual visibility with elementFromPoint in Chrome.
  const rules = document.getElementById("volt-quick-actions-styles").sheet.cssRules;
  const toolbarRule = rules.find((rule) => rule.selectorText === ".volt-quick-actions-overlay");
  assert.ok(Number(toolbarRule.style.getPropertyValue("z-index")) > 100,
    "a body-level toolbar must paint above Shopify's AppFrameBevel");
});

test("PriceCharting reads the UPC in Shopify's quick-field shadow root", () => {
  const { document, messages, poll } = mount();
  addShadowUpc(document, "012345678905");
  poll();
  const button = document.getElementById("volt-tab-pc");
  assert.equal(button.disabled, false);
  button.onclick({ stopPropagation() {} });
  assert.equal(messages[0].url,
    "https://www.pricecharting.com/search-products?q=012345678905&type=videogames");
});

test("PriceCharting rereads edited and cleared shadow UPCs instead of stale display text", () => {
  const { document, messages, poll } = mount();
  const input = addShadowUpc(document, "012345678905");
  poll();
  const button = document.getElementById("volt-tab-pc");
  input.value = "0012345678905";
  button.onclick({ stopPropagation() {} });
  assert.match(messages[0].url, /q=0012345678905&/);
  input.value = "";
  poll();
  button.onclick({ stopPropagation() {} });
  assert.equal(messages[1].url, "https://www.pricecharting.com/search-products?q=Dell%20Latitude&type=videogames",
    "a cleared UPC must not launch the old displayed value");
});

function addMetafield(document, key, label, value) {
  const container = document.createElement("div");
  container.id = `PRODUCT.metafields.custom.${key}-anchor`;
  container.innerHTML = `<label>${label}</label><input value="${value}">`;
  document.querySelector("main").appendChild(container);
}

test("PriceCharting without a UPC searches the game name plus platform", () => {
  const { document, messages, poll } = mount();
  addMetafield(document, "game_name", "Game name", "Halo 3");
  addMetafield(document, "platform", "Platform", "Xbox 360");
  poll();
  const button = document.getElementById("volt-tab-pc");
  assert.equal(button.disabled, false);
  assert.match(button.getAttribute("data-tooltip"), /^Search PriceCharting by game name \+ platform: Halo 3 Xbox 360/);
  button.onclick({ stopPropagation() {} });
  assert.equal(messages[0].url, "https://www.pricecharting.com/search-products?q=Halo%203%20Xbox%20360&type=videogames");
});

test("PriceCharting falls back to the title and skips a platform it already names", () => {
  const { document, messages, poll } = mount();
  document.querySelector('[name="title"]').shadowRoot.querySelector("input").value = "Halo 3 Xbox 360";
  addMetafield(document, "platform", "Console", "Xbox 360");
  poll();
  document.getElementById("volt-tab-pc").onclick({ stopPropagation() {} });
  assert.match(messages[0].url, /q=Halo%203%20Xbox%20360&/);
});

test("an exact Platform label beats an earlier label that only mentions a console", () => {
  const { document, messages, poll } = mount();
  addMetafield(document, "game_name", "Game name", "  Halo 3 ");
  addMetafield(document, "console_color", "Console color", "Black");
  addMetafield(document, "platform", "Platform", "Xbox 360");
  poll();
  document.getElementById("volt-tab-pc").onclick({ stopPropagation() {} });
  assert.match(messages[0].url, /q=Halo%203%20Xbox%20360&/);
});

function addQuickField(document, key, label, value) {
  const container = document.createElement("div");
  container.id = `PRODUCT.metafields.custom.${key}-anchor`;
  const field = document.createElement("s-internal-quick-text-field");
  field.setAttribute("accessibilitylabel", label);
  const input = document.createElement("input");
  input.value = value;
  field.attachShadow({ mode: "open" }).appendChild(input);
  container.appendChild(field);
  document.querySelector("main").appendChild(container);
}

test("reads game name and platform from Shopify's quick fields", () => {
  const { document, messages, poll } = mount();
  addQuickField(document, "game_name", "Game name", "Halo 3");
  addQuickField(document, "platform", "Platform", "Xbox 360");
  poll();
  document.getElementById("volt-tab-pc").onclick({ stopPropagation() {} });
  assert.match(messages[0].url, /q=Halo%203%20Xbox%20360&/);
});

test("a platform is only skipped when the name already has it as a word", () => {
  const { document, messages, poll } = mount();
  addMetafield(document, "game_name", "Game name", "My Friends");
  addMetafield(document, "platform", "Platform", "DS");
  poll();
  document.getElementById("volt-tab-pc").onclick({ stopPropagation() {} });
  assert.match(messages[0].url, /q=My%20Friends%20DS&/);
});

test("a wrapper around several metafields never supplies another field's value", () => {
  const { document, messages, poll } = mount();
  const wrapper = document.createElement("div");
  wrapper.id = "PRODUCT.metafields-section";
  wrapper.innerHTML = '<div id="PRODUCT.metafields.custom.color-anchor"><label>Console color</label><input value="Black"></div>'
    + '<div id="PRODUCT.metafields.custom.platform-anchor"><label>Console</label><input value="Wii"></div>';
  document.querySelector("main").appendChild(wrapper);
  addMetafield(document, "game_name", "Game name", "Wii Sports");
  addMetafield(document, "condition", "Game name notes", "ignored");
  poll();
  document.getElementById("volt-tab-pc").onclick({ stopPropagation() {} });
  assert.match(messages[0].url, /q=Wii%20Sports&/);
});

test("labels that only mention a console or game name are ignored", () => {
  const { document, messages, poll } = mount();
  addMetafield(document, "game_name", "Game name", "Halo 3");
  addMetafield(document, "console_color", "Console color", "Black");
  addMetafield(document, "notes", "Game name notes", "Sealed");
  poll();
  document.getElementById("volt-tab-pc").onclick({ stopPropagation() {} });
  assert.match(messages[0].url, /q=Halo%203&/);
});

test("an empty <label> falls back to the quick field's accessibility label", () => {
  const { document, messages, poll } = mount();
  addMetafield(document, "game_name", "Game name", "Halo 3");
  addQuickField(document, "platform", "Platform", "Xbox 360");
  document.getElementById("PRODUCT.metafields.custom.platform-anchor").prepend(document.createElement("label"));
  poll();
  document.getElementById("volt-tab-pc").onclick({ stopPropagation() {} });
  assert.match(messages[0].url, /q=Halo%203%20Xbox%20360&/);
});

test("a label in its own metafield element still reads the field's input", () => {
  const { document, messages, poll } = mount();
  const field = document.createElement("div");
  field.id = "PRODUCT.metafields.custom.game_name-anchor";
  field.innerHTML = '<div id="PRODUCT.metafields.custom.game_name-label"><label>Game name *</label></div><input value="Halo 3">';
  document.querySelector("main").appendChild(field);
  addMetafield(document, "platform", "Platform:", "Xbox 360");
  poll();
  document.getElementById("volt-tab-pc").onclick({ stopPropagation() {} });
  assert.match(messages[0].url, /q=Halo%203%20Xbox%20360&/);
});

test("an empty field never borrows a neighboring field's value through a wrapper", () => {
  const { document, messages, poll } = mount();
  const wrapper = document.createElement("div");
  wrapper.id = "PRODUCT.metafields-section";
  wrapper.innerHTML = '<div id="PRODUCT.metafields.custom.game_name-label"><label>Game name</label></div>'
    + '<div id="PRODUCT.metafields.custom.condition-anchor"><label>Condition</label><input value="Sealed"></div>';
  document.querySelector("main").appendChild(wrapper);
  addQuickField(document, "platform", "Platform", "");
  poll();
  document.getElementById("volt-tab-pc").onclick({ stopPropagation() {} });
  assert.match(messages[0].url, /q=Dell%20Latitude&/);
});

test("a field split into its own id'd label and input parts is still read", () => {
  const { document, messages, poll } = mount();
  const field = document.createElement("div");
  field.id = "PRODUCT.metafields.custom.game_name-anchor";
  field.innerHTML = '<div id="PRODUCT.metafields.custom.game_name-label"><label>Game name</label></div>'
    + '<div id="PRODUCT.metafields.custom.game_name-input"><input value="Halo 3"></div>';
  document.querySelector("main").appendChild(field);
  poll();
  document.getElementById("volt-tab-pc").onclick({ stopPropagation() {} });
  assert.match(messages[0].url, /q=Halo%203&/);
});

test("an empty matching field doesn't hide a later filled one", () => {
  const { document, messages, poll } = mount();
  addMetafield(document, "game_name", "Game name", "Wii Sports Resort");
  addMetafield(document, "platform", "Platform", "");
  addMetafield(document, "console", "Console", "Wii U");
  poll();
  document.getElementById("volt-tab-pc").onclick({ stopPropagation() {} });
  assert.match(messages[0].url, /q=Wii%20Sports%20Resort%20Wii%20U&/);
});

test("a wrapper whose bare label sits beside another field is never used", () => {
  const { document, messages, poll } = mount();
  const wrapper = document.createElement("div");
  wrapper.id = "PRODUCT.metafields-section";
  wrapper.innerHTML = '<div><label>Game name</label></div>'
    + '<div id="PRODUCT.metafields.custom.condition-anchor"><label>Condition</label><input value="Sealed"></div>';
  document.querySelector("main").appendChild(wrapper);
  poll();
  document.getElementById("volt-tab-pc").onclick({ stopPropagation() {} });
  assert.match(messages[0].url, /q=Dell%20Latitude&/);
});

test("reads a multi-line game name field", () => {
  const { document, messages, poll } = mount();
  const field = document.createElement("div");
  field.id = "PRODUCT.metafields.custom.game_name-anchor";
  field.innerHTML = "<label>Game name</label><textarea>Halo 3</textarea>";
  document.querySelector("main").appendChild(field);
  poll();
  document.getElementById("volt-tab-pc").onclick({ stopPropagation() {} });
  assert.match(messages[0].url, /q=Halo%203&/);
});

test("a UPC still wins over the game name", () => {
  const { document, messages, poll } = mount();
  addMetafield(document, "game_name", "Game name", "Halo 3");
  addShadowUpc(document, "012345678905");
  poll();
  document.getElementById("volt-tab-pc").onclick({ stopPropagation() {} });
  assert.match(messages[0].url, /q=012345678905&/);
});

for (const html of ['<span class="_ReadField_abc">012345678905</span>', '<input value="012345678905">']) {
  test(`PriceCharting still reads legacy UPC markup: ${html}`, () => {
    const { document, messages, poll } = mount({ modern: false });
    const container = document.createElement("div");
    container.id = "PRODUCT.metafields.custom.upc-anchor";
    container.innerHTML = html;
    document.querySelector("main").appendChild(container);
    poll();
    const button = document.getElementById("volt-tab-pc");
    assert.equal(button.disabled, false);
    button.onclick({ stopPropagation() {} });
    assert.match(messages[0].url, /q=012345678905&/);
  });
}

for (const options of [{}, { modern: false }, { width: 480 }, { modern: false, width: 480 }, { card: false }]) {
  test(`actions sit on the title row and never move Shopify's card (${JSON.stringify(options)})`, () => {
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
    assert.ok(!container.style.getPropertyValue("max-width"));
    assert.equal(document.querySelector("#volt-tab-ebay .volt-action-label"), null);
    assert.equal(document.querySelector("#volt-tab-pc .volt-action-label").textContent, "PriceCharting");
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
  assert.equal(document.getElementById("volt-tab-pc").getAttribute("data-tooltip"), "No UPC or product name found");
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

test("research actions open a popup unless modifier or middle clicked, whatever the menus' setting", () => {
  const { document, messages, frame } = mount({ stored: { openSearchResultsIn: "tab" } });
  const ebay = document.getElementById("volt-tab-ebay");
  const click = (event = {}) => ebay.onclick({ stopPropagation() {}, preventDefault() {}, button: 0, ...event });
  click();
  click({ metaKey: true });
  click({ ctrlKey: true });
  ebay.onauxclick({ stopPropagation() {}, preventDefault() {}, button: 1 });
  ebay.onauxclick({ stopPropagation() {}, preventDefault() {}, button: 2 });
  assert.deepEqual(messages.map((message) => message.action),
    ["openPreviewPopup", "openUrl", "openUrl", "openUrl"]);
  assert.match(messages.at(-1).url, /_nkw=Dell%20Latitude.*LH_Sold=1/);
  frame();
  assert.match(ebay.getAttribute("data-tooltip"), /\nCtrl\+click or middle-click to open in a new tab$/);
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
  assert.equal(document.getElementById("volt-quick-actions-overlay").dataset.layout, "title");
  assert.ok(!container.style.getPropertyValue("margin-inline-start"));
  assert.ok(!section.style.getPropertyValue("margin-inline-start"));
  location.href = "https://admin.shopify.com/store/test/orders";
  frame();
  assert.equal(document.getElementById("volt-quick-actions-overlay"), null);
});


test("disabling research actions removes them until explicitly enabled again", () => {
  const { container, document, settings, frame } = mount();
  settings(false);
  frame();
  assert.equal(document.getElementById("volt-quick-actions-overlay"), null);
  assert.ok(!container.style.getPropertyValue("margin-inline-start"));
  settings(true);
  assert.equal(document.getElementById("volt-quick-actions-overlay").dataset.layout, "title");
  assert.ok(!container.style.getPropertyValue("margin-inline-start"));
});
