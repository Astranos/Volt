import test from "node:test";
import assert from "node:assert/strict";
import { createAuditBrowser, observeSearch } from "./browser.ts";
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

async function advance(t, milliseconds) {
  // Chrome calls and the async reader each resume in microtasks between timer ticks.
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 100) {
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    t.mock.timers.tick(100);
  }
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
}

test("an automatically resolving eBay challenge resumes the exact search without interaction", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const state = fakeChrome(t);
  const browser = createAuditBrowser();
  const url = soldSearchUrl("camera");
  const create = state.api.tabs.create;
  state.api.tabs.create = async (args) => {
    const tab = await create(args);
    tab.url = "https://www.ebay.com/splashui/challenge?ap=1";
    setTimeout(() => { tab.url = url; }, 1500);
    return tab;
  };
  const result = browser.readSearch(url, new AbortController().signal);
  // Attach immediately so the old immediate-rejection behavior is captured deterministically.
  const completion = result.then(page => ({ page }), error => ({ error }));
  await advance(t, 2000);
  const outcome = await completion;
  assert.equal(outcome.error, undefined);
  assert.equal(outcome.page.url, url);
  await browser.close();
  assert.equal(state.closed.length, 1);
  assert.equal(state.changes.length, 0);
});

test("same-search verification waits passively and resumes after it clears", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const state = fakeChrome(t);
  const browser = createAuditBrowser();
  const url = soldSearchUrl("camera");
  const extract = state.api.scripting.executeScript;
  state.api.scripting.executeScript = async (args) => Date.now() < 1500
    ? [{ result: { kind: "challenge", url } }] : extract(args);
  const completion = browser.readSearch(url, new AbortController().signal);
  await advance(t, 2000);
  assert.equal((await completion).url, url);
  await browser.close();
  assert.equal(state.closed.length, 1);
  assert.equal(state.changes.length, 0);
});

test("permanent challenge URL times out and is left open without DOM extraction", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const state = fakeChrome(t);
  const browser = createAuditBrowser();
  const create = state.api.tabs.create;
  state.api.tabs.create = async (args) => {
    const tab = await create(args); tab.url = "https://www.ebay.com/splashui/challenge?ap=1"; return tab;
  };
  state.api.scripting.executeScript = async () => assert.fail("must not extract a challenge page");
  const completion = assert.rejects(browser.readSearch(soldSearchUrl("camera"), new AbortController().signal), /verification.*30 seconds/);
  await advance(t, 30_000);
  await completion;
  await browser.close();
  assert.equal(state.closed.length, 0);
  assert.equal(state.changes.length, 0);
});

test("challenge URL and same-search challenge share one 30 second deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const state = fakeChrome(t);
  const browser = createAuditBrowser();
  const url = soldSearchUrl("camera");
  const create = state.api.tabs.create;
  state.api.tabs.create = async (args) => {
    const tab = await create(args);
    tab.url = "https://www.ebay.com/splashui/challenge?ap=1";
    setTimeout(() => { tab.url = url; }, 20_000);
    return tab;
  };
  state.api.scripting.executeScript = async () => [{ result: { kind: "challenge", url } }];
  const completion = assert.rejects(browser.readSearch(url, new AbortController().signal), /verification.*30 seconds/);
  await advance(t, 30_000);
  await completion;
  await browser.close();
  assert.equal(state.tabs.get(1).url, url);
  assert.equal(state.closed.length, 0, "same-URL challenge remains available to the user");
});

test("aborting verification wait rejects without waiting for another timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const state = fakeChrome(t);
  const browser = createAuditBrowser();
  const url = soldSearchUrl("camera");
  state.api.scripting.executeScript = async () => [{ result: { kind: "challenge", url } }];
  const controller = new AbortController();
  const completion = assert.rejects(browser.readSearch(url, controller.signal), /stopped/);
  await advance(t, 1000);
  controller.abort();
  await completion;
  assert.equal(Date.now(), 1000);
  await browser.close();
  assert.equal(state.closed.length, 0);
});

test("unrelated redirects remain refused instead of being waited through", async (t) => {
  const state = fakeChrome(t);
  const browser = createAuditBrowser();
  const create = state.api.tabs.create;
  state.api.tabs.create = async (args) => {
    const tab = await create(args); tab.url = "https://www.ebay.com/splashui/challenge-unrelated"; return tab;
  };
  await assert.rejects(browser.readSearch(soldSearchUrl("camera"), new AbortController().signal), /redirected/);
  await browser.close();
  assert.equal(state.closed.length, 0);
});

test("challenge DOM returns only its status, never challenge contents or controls", (t) => {
  const previousLocation = globalThis.location, previousDocument = globalThis.document;
  t.after(() => {
    if (previousLocation === undefined) delete globalThis.location; else globalThis.location = previousLocation;
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
  });
  const url = soldSearchUrl("camera");
  globalThis.location = { href: url };
  globalThis.document = {
    title: "Pardon our interruption", body: { innerText: "private challenge contents" },
    querySelectorAll: () => assert.fail("must not extract challenge controls"),
  };
  assert.deepEqual(observeSearch(url), { kind: "challenge", url });
  globalThis.location = { href: "https://www.ebay.com/splashui/challenge?ap=1" };
  globalThis.document = new Proxy({}, { get() { assert.fail("must not inspect challenge URL DOM"); } });
  assert.deepEqual(observeSearch(url), { kind: "challenge", url: globalThis.location.href });
});
