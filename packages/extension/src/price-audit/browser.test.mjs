import test from "node:test";
import assert from "node:assert/strict";
import { createAuditBrowser } from "./browser.ts";
import { soldSearchUrl } from "./ebay.ts";

function fakeChrome(context) {
  const previous = globalThis.chrome;
  const tabs = new Map();
  const changes = [];
  const closed = [];
  let nextId = 1;
  const api = {
    tabs: {
      create: async ({ url }) => { const tab = { id: nextId++, url, status: "complete" }; tabs.set(tab.id, tab); return tab; },
      get: async (id) => { if (!tabs.has(id)) throw Error("closed"); return tabs.get(id); },
      update: async (id, { url }) => { changes.push(url); const tab = { id, url, status: "complete" }; tabs.set(id, tab); return tab; },
      remove: async (id) => { closed.push(id); tabs.delete(id); },
    },
    scripting: { executeScript: async ({ args: [url] }) => [{ result: url.includes("/products.json") ? { url, text: '{"products":[]}' } : { url, cards: [], links: [], noResults: true, truncated: false } }] },
  };
  globalThis.chrome = api;
  context.after(() => { if (previous) globalThis.chrome = previous; else delete globalThis.chrome; });
  return { api, tabs, changes, closed };
}

test("dedicated tabs are reused and only untouched research tabs are closed", async (t) => {
  const state = fakeChrome(t);
  const browser = createAuditBrowser();
  const signal = new AbortController().signal;
  await browser.readSearch(soldSearchUrl("camera"), signal);
  await browser.readSearch(soldSearchUrl("phone"), signal);
  await browser.readCatalog("https://store.com/products.json?limit=250&page=1", signal);
  assert.equal(state.tabs.size, 2);
  assert.equal(state.changes.length, 1);
  state.tabs.get(1).url = "https://www.ebay.com/mye/myebay";
  await browser.close();
  assert.deepEqual(state.closed, [2]);
  assert.equal(state.tabs.size, 1);
});

test("user-modified search filters cannot be overwritten or closed", async (t) => {
  const state = fakeChrome(t);
  const browser = createAuditBrowser();
  const signal = new AbortController().signal;
  await browser.readSearch(soldSearchUrl("camera"), signal);
  state.tabs.get(1).url += "&LH_ItemCondition=1000";
  await assert.rejects(browser.readSearch(soldSearchUrl("phone"), signal), /changed outside/);
  await browser.close();
  assert.equal(state.changes.length, 0);
  assert.equal(state.closed.length, 0);
});

test("stop during a pending browser call prevents the next navigation", async (t) => {
  const state = fakeChrome(t);
  const browser = createAuditBrowser();
  const controller = new AbortController();
  await browser.readSearch(soldSearchUrl("camera"), controller.signal);
  const get = state.api.tabs.get;
  state.api.tabs.get = async (id) => { controller.abort(); return get(id); };
  await assert.rejects(browser.readSearch(soldSearchUrl("phone"), controller.signal));
  assert.equal(state.changes.length, 0);
  await browser.close();
});

test("stop during extraction prevents a late page result", async (t) => {
  const state = fakeChrome(t);
  const browser = createAuditBrowser();
  const controller = new AbortController();
  const extract = state.api.scripting.executeScript;
  state.api.scripting.executeScript = async (args) => { controller.abort(); return extract(args); };
  await assert.rejects(browser.readCatalog("https://store.com/products.json?limit=250&page=1", controller.signal));
  await browser.close();
  assert.equal(state.closed.length, 1);
});

test("eBay challenge is never bypassed and is left open for human verification", async (t) => {
  const state = fakeChrome(t);
  const browser = createAuditBrowser();
  const create = state.api.tabs.create;
  state.api.tabs.create = async (args) => {
    const tab = await create(args);
    tab.url = "https://www.ebay.com/splashui/challenge?ap=1";
    return tab;
  };
  await assert.rejects(browser.readSearch(soldSearchUrl("camera"), new AbortController().signal), /verification/);
  await browser.close();
  assert.equal(state.closed.length, 0);
  assert.equal(state.changes.length, 0);
});
