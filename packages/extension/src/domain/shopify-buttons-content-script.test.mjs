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

function mount({ modern = true, card = true } = {}) {
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
  window.screen = { width: 1440, height: 900 };
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 296, top: 176, width: 600, height: 400 });
  if (!card) container.className = "";
  const location = { href: "https://admin.shopify.com/store/test/products/123" };
  let frame;
  const messages = [];
  const context = vm.createContext({
    exports: {}, defineContentScript: (config) => config, document, window, location,
    history: { pushState() {}, replaceState() {} },
    MutationObserver: class { observe() {} },
    requestAnimationFrame(callback) { frame = callback; }, setTimeout() {}, setInterval() {},
    console: { log() {} },
    chrome: {
      runtime: { getURL: (path) => path, onMessage: { addListener() {} }, sendMessage: (message) => messages.push(message) },
      storage: { sync: { get: (_, callback) => callback({}) } },
    },
  });
  window.getComputedStyle = () => ({ backgroundColor: "transparent", boxShadow: "none", borderRadius: "0px", borderColor: "rgba(0, 0, 0, 0)" });
  document.readyState = "complete";
  vm.runInContext(script, context);
  context.exports.default.main();
  frame();
  return { document, window, container, location, messages, frame: () => frame() };
}

for (const options of [{ modern: true }, { modern: false }, { modern: true, card: false }]) {
  test(`research actions reserve space above product fields (${JSON.stringify(options)})`, () => {
    const { document, container, frame } = mount(options);
    const toolbar = document.getElementById("volt-quick-actions-overlay");
    assert.ok(toolbar.parentElement === container, "toolbar must be inside the product form");
    assert.ok(container.firstChild === toolbar, "toolbar must precede product fields");
    assert.equal(toolbar.style.left, undefined);
    assert.equal(toolbar.style.top, undefined);
    const styles = document.getElementById("volt-quick-actions-styles").textContent;
    assert.match(styles, /position: relative;/);
    assert.doesNotMatch(styles, /position: fixed;/);
    assert.match(styles, /flex-direction: row;/);
    frame();
    assert.equal(container.querySelectorAll("#volt-quick-actions-overlay").length, 1);
  });
}

test("research action reads Shopify's shadow title and still opens sold listings", () => {
  const { document, messages } = mount();
  document.getElementById("volt-tab-ebay").onclick({ stopPropagation() {} });
  assert.equal(messages[0].action, "openPreviewPopup");
  assert.match(messages[0].url, /_nkw=Dell%20Latitude.*LH_Sold=1/);
});

test("toolbar follows a replaced product section and leaves non-product pages", () => {
  const { document, container, location, frame } = mount();
  const replacement = container.cloneNode(true);
  replacement.querySelector("#volt-quick-actions-overlay").remove();
  container.replaceWith(replacement);
  frame();
  assert.equal(replacement.firstChild.id, "volt-quick-actions-overlay");
  location.href = "https://admin.shopify.com/store/test/orders";
  frame();
  assert.equal(document.getElementById("volt-quick-actions-overlay"), null);
});
