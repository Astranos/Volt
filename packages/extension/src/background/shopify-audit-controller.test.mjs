import assert from "node:assert/strict";
import test from "node:test";
import { AUDIT_TAB_LIMIT, createShopifyAuditController } from "./shopify-audit-controller.ts";
import { auditRangeInComputerTimezone, yesterdayInComputerTimezone } from "../domain/shopify-audit.ts";
import { EXTENSION_SCANNER_SIGNAL_URL } from "../domain/mobile-scanner-signal-url.ts";

const product = (id) => ({ id: String(id), title: `Product ${id}`, status: "DRAFT", url: `https://admin.shopify.com/store/sample/products/${id}` });
// chrome.storage.local, where the active store is saved.
function memoryStorage(items = {}) {
  return {
    items,
    get: async (key) => (key in items ? { [key]: items[key] } : {}),
    set: async (values) => { Object.assign(items, values); },
    remove: async (key) => { delete items[key]; },
  };
}
const lazyUrl = (item) => `chrome-extension://ext/shopify-audit-tab.html?${new URLSearchParams({ u: item.url, t: item.title })}`;

function setup(products, { groupFails = () => false } = {}) {
  const calls = { created: [], grouped: [], updatedGroups: [], activated: [], removed: [], fetches: 0 };
  const session = {};
  const openTabs = new Set();
  let groupAlive = true;
  const chromeApi = {
    runtime: { getURL: (path) => `chrome-extension://ext${path}` },
    storage: { local: memoryStorage(), session: {
      get: async (key) => (key in session ? { [key]: structuredClone(session[key]) } : {}),
      set: async (items) => { Object.assign(session, structuredClone(items)); },
      remove: async (key) => { delete session[key]; },
    } },
    tabs: {
      create: async (options) => {
        calls.created.push(options);
        const id = calls.created.length;
        openTabs.add(id);
        return { id };
      },
      get: async (id) => { if (!openTabs.has(id)) throw new Error(`No tab with id: ${id}.`); return { id }; },
      group: async (options) => {
        const failure = groupFails(options);
        if (failure) throw new Error(typeof failure === "string" ? failure : "No group with id: 7.");
        calls.grouped.push(options);
        return 7;
      },
      update: async (id, options) => { calls.activated.push({ id, options }); },
      remove: async (id) => { calls.removed.push(id); openTabs.delete(id); },
    },
    tabGroups: {
      get: async (id) => { if (!groupAlive) throw new Error(`No group with id: ${id}.`); return { id }; },
      update: async (id, options) => { calls.updatedGroups.push({ id, options }); },
    },
  };
  const controller = createShopifyAuditController({
    chromeApi,
    extensionId: "ext",
    sendOffscreenMessage: async (message) => {
      calls.fetches++;
      return { success: true, value: { shop: "sample.myshopify.com", date: message.date, products } };
    },
    wait: async () => {},
  });
  const request = (action = "shopifyAuditOpenYesterday") => new Promise((resolve) => {
    assert.equal(controller.handleMessage(
      { action },
      { id: "ext", url: "chrome-extension://ext/newtab.html", tab: { windowId: 5 } },
      resolve,
    ), true);
  });
  // The user closing a tab: Chrome removes it, then fires onRemoved.
  const close = (id, removeInfo) => { openTabs.delete(id); return controller.handleTabRemoved(id, removeInfo); };
  const closeGroup = () => { groupAlive = false; };
  return { calls, request, close, closeGroup, session, openTabs };
}

test("opens only the first products, as lazy placeholders, in one named tab group", async () => {
  const products = [11, 12, 13, 14, 15].map(product);
  const { calls, request, session } = setup(products);
  const response = await request();
  const date = yesterdayInComputerTimezone().date;
  assert.deepEqual(response, { success: true, value: { shop: "sample.myshopify.com", date, count: 5, opened: AUDIT_TAB_LIMIT, resumed: false } });
  assert.deepEqual(calls.created, products.slice(0, 3).map((item, index) => ({ url: lazyUrl(item), active: index === 0, windowId: 5 })));
  assert.deepEqual(calls.grouped, [{ tabIds: [1, 2, 3] }]);
  assert.equal(calls.updatedGroups[0].options.title, `Shopify audit · ${date}`);
  assert.deepEqual(session.shopifyAuditTabsRun.queue.map((item) => item.id), ["14", "15"]);
});

test("closing a reviewed tab opens the next queued product until the queue is empty", async () => {
  const { calls, request, close, session } = setup([11, 12, 13, 14].map(product));
  await request();
  await close(1);
  assert.deepEqual(calls.created.at(-1), { url: lazyUrl(product(14)), active: false, windowId: 5 });
  assert.deepEqual(calls.grouped.at(-1), { groupId: 7, tabIds: [4] });
  assert.deepEqual(session.shopifyAuditTabsRun.tabIds, [2, 3, 4]);
  await close(2);
  assert.equal(calls.created.length, 4);
  assert.deepEqual(session.shopifyAuditTabsRun.tabIds, [3, 4]);
});

test("closing the audit group cancels the rest of the audit", async () => {
  const { calls, request, close, closeGroup, openTabs, session } = setup([11, 12, 13, 14, 15].map(product));
  await request();
  closeGroup();
  openTabs.clear();
  await Promise.all([close(1), close(2), close(3)]);
  assert.equal(calls.created.length, 3);
  assert.equal(session.shopifyAuditTabsRun, undefined);
});

test("closing the window cancels the audit", async () => {
  const { calls, request, close, session } = setup([11, 12, 13, 14].map(product));
  await request();
  await close(1, { isWindowClosing: true });
  assert.equal(calls.created.length, 3);
  assert.equal(session.shopifyAuditTabsRun, undefined);
});

test("clicking Audit again returns to the open audit instead of opening a duplicate", async () => {
  const { calls, request } = setup([11, 12, 13, 14].map(product));
  await request();
  const again = await request();
  assert.equal(again.value.resumed, true);
  assert.equal(calls.created.length, 3);
  assert.equal(calls.fetches, 1);
  assert.deepEqual(calls.activated, [{ id: 1, options: { active: true } }]);
});

test("closes the opened tabs and reports the failure when grouping fails", async () => {
  const { calls, request, session } = setup([11, 12].map(product), { groupFails: () => true });
  const response = await request();
  assert.equal(response.success, false);
  assert.match(response.error, /Could not open the Shopify audit/);
  assert.deepEqual(calls.removed, [1, 2]);
  assert.equal(session.shopifyAuditTabsRun, undefined);
});

test("does not open an unexpected product URL", async () => {
  const { calls, request } = setup([{ id: "11", title: "Wrong store", status: "DRAFT", url: "https://admin.shopify.com/store/other/products/11" }]);
  const response = await request();
  assert.equal(response.success, false);
  assert.deepEqual(calls.created, []);
});

test("large audit days no longer hit a tab cap", async () => {
  const { calls, request } = setup(Array.from({ length: 150 }, (_, index) => product(index + 1)));
  const response = await request();
  assert.equal(response.value.count, 150);
  assert.equal(calls.created.length, AUDIT_TAB_LIMIT);
});

test("lists the last 3 days when the side panel asks for them", async () => {
  const sent = [];
  const controller = createShopifyAuditController({
    chromeApi: { storage: { local: memoryStorage() } }, extensionId: "ext",
    sendOffscreenMessage: async (message) => {
      sent.push(message);
      return { success: true, value: { shop: "sample.myshopify.com", date: message.date, products: [] } };
    },
  });
  const response = await new Promise((resolve) => controller.handleMessage(
    { action: "shopifyAuditListYesterday", days: 3 }, { id: "ext", url: "chrome-extension://ext/sidepanel.html" }, resolve));
  assert.equal(response.success, true);
  const range = auditRangeInComputerTimezone(3);
  assert.equal(sent[0].startUtc, range.startUtc);
  assert.equal(sent[0].endUtc, range.endUtc);
  assert.equal(response.value.date, range.date);
});

test("lists yesterday's products for the side panel review without opening tabs", async () => {
  const { calls, request } = setup([11, 12].map(product));
  const response = await request("shopifyAuditListYesterday");
  assert.equal(response.success, true);
  assert.deepEqual(response.value.products.map((item) => item.id), ["11", "12"]);
  assert.deepEqual(calls.created, []);
});

test("forwards live searches only from trusted extension pages", async () => {
  const messages = [];
  const controller = createShopifyAuditController({
    chromeApi: { storage: { local: memoryStorage() } },
    extensionId: "ext",
    sendOffscreenMessage: async (message) => {
      messages.push(message);
      return { success: true, value: { shop: "sample.myshopify.com", products: [] } };
    },
  });
  const request = (query, sender) => new Promise((resolve) => {
    assert.equal(controller.handleMessage({ action: "shopifyAuditSearchProducts", query }, sender, resolve), true);
  });
  const trusted = { id: "ext", url: "chrome-extension://ext/newtab.html" };
  assert.deepEqual(await request("  camera  ", trusted), { success: true, value: { shop: "sample.myshopify.com", products: [] } });
  assert.deepEqual(messages, [{ action: "shopifyAuditOffscreenSearchProducts", query: "camera" }]);
  assert.equal((await request("x", trusted)).success, false);
  assert.equal((await request("camera", { id: "other", url: "chrome-extension://other/newtab.html" })).success, false);
  assert.equal(messages.length, 1);
});

test("forwards compare detail requests from the compare page with valid product IDs", async () => {
  const messages = [];
  const controller = createShopifyAuditController({
    chromeApi: { storage: { local: memoryStorage() } },
    extensionId: "ext",
    sendOffscreenMessage: async (message) => {
      messages.push(message);
      return { success: true, value: { shop: "sample.myshopify.com", products: [] } };
    },
  });
  const request = (productIds) => new Promise((resolve) => {
    assert.equal(controller.handleMessage({ action: "shopifyAuditProductDetails", productIds }, { id: "ext", url: "chrome-extension://ext/shopify-compare.html?ids=1" }, resolve), true);
  });
  const ids = ["gid://shopify/Product/2", "gid://shopify/Product/1"];
  assert.equal((await request(ids)).success, true);
  assert.deepEqual(messages, [{ action: "shopifyAuditOffscreenProductDetails", productIds: ids }]);
  assert.equal((await request([])).success, false);
  assert.equal((await request(["gid://shopify/Product/1", "gid://shopify/Product/1"])).success, false);
  assert.equal((await request(["gid://shopify/Collection/1"])).success, false);
  assert.equal((await request(Array.from({ length: 9 }, (_, index) => `gid://shopify/Product/${index}`))).success, false);
  assert.equal(messages.length, 1);
});

test("binds Shopify authorization to this browser before opening the approval tab", async () => {
  const callback = `${new URL(EXTENSION_SCANNER_SIGNAL_URL).origin}/api/shopify/callback`;
  const cookies = [];
  const tabs = [];
  const url = new URL("https://sample.myshopify.com/admin/oauth/authorize");
  url.searchParams.set("redirect_uri", callback);
  const controller = createShopifyAuditController({
    chromeApi: {
      cookies: { set: async (details) => { cookies.push(details); return details; } },
      tabs: { create: async (details) => { tabs.push(details); return { id: 1 }; } },
    },
    extensionId: "ext",
    sendOffscreenMessage: async () => ({ success: true, value: {
      url: url.href,
      browserCookie: { url: callback, name: "volt_shopify_oauth", value: "b".repeat(64) },
    } }),
  });
  const response = await new Promise((resolve) => controller.handleMessage(
    { action: "shopifyAuditConnect", shop: "sample.myshopify.com" },
    { id: "ext", url: "chrome-extension://ext/options.html", tab: { windowId: 5 } },
    resolve,
  ));
  assert.equal(response.success, true);
  assert.equal(cookies[0].url, callback);
  assert.equal(cookies[0].httpOnly, true);
  assert.equal(cookies[0].sameSite, "lax");
  assert.deepEqual(tabs, [{ url: url.href, active: true, windowId: 5 }]);
});

test("a tab drag in progress doesn't cancel the audit; grouping is retried", async () => {
  let refusals = 2;
  const { calls, request, close, session } = setup([11, 12, 13, 14].map(product), {
    groupFails: (options) => options.groupId !== undefined && refusals-- > 0 && "Tabs cannot be edited right now (user may be dragging a tab).",
  });
  await request();
  await close(1);
  assert.deepEqual(session.shopifyAuditTabsRun.tabIds, [2, 3, 4]);
  assert.equal(calls.created.length, 4);
});

test("a close handler still settling can't erase an audit started meanwhile", async () => {
  const { request, close, closeGroup, openTabs, session } = setup([11, 12, 13, 14].map(product));
  await request();
  // Close the whole group; its handler waits before deciding the audit ended.
  closeGroup();
  openTabs.clear();
  const closing = close(1);
  // A new audit starts while that handler is still waiting.
  const starting = request();
  await closing;
  const response = await starting;
  assert.equal(response.success, true);
  assert.equal(response.value.resumed, false);
  assert.ok(session.shopifyAuditTabsRun, "the new audit's state survives");
});

test("status lists every connected store and keeps the saved one active while it's connected", async () => {
  const local = memoryStorage({ shopifyActiveShop: "two.myshopify.com" });
  let shops = ["one.myshopify.com", "two.myshopify.com"];
  const controller = createShopifyAuditController({
    chromeApi: { storage: { local } }, extensionId: "ext",
    sendOffscreenMessage: async (message) => {
      assert.equal(message.action, "shopifyAuditOffscreenStores");
      return { success: true, value: shops.map((shop) => ({ shop })) };
    },
  });
  const status = () => new Promise((resolve) => controller.handleMessage(
    { action: "shopifyAuditStatus" }, { id: "ext", url: "chrome-extension://ext/newtab.html" }, resolve));
  assert.deepEqual(await status(), { success: true, value: { shop: "two.myshopify.com", shops } });
  // Disconnected elsewhere: fall back to the first store and remember that.
  shops = ["one.myshopify.com"];
  assert.deepEqual(await status(), { success: true, value: { shop: "one.myshopify.com", shops } });
  assert.equal(local.items.shopifyActiveShop, "one.myshopify.com");
  shops = [];
  assert.deepEqual(await status(), { success: true, value: null });
  assert.equal("shopifyActiveShop" in local.items, false);
});

test("searches the active store unless the page names another one", async () => {
  const messages = [];
  const controller = createShopifyAuditController({
    chromeApi: { storage: { local: memoryStorage({ shopifyActiveShop: "two.myshopify.com" }) } }, extensionId: "ext",
    sendOffscreenMessage: async (message) => {
      messages.push(message);
      return { success: true, value: null };
    },
  });
  const send = (message) => new Promise((resolve) => controller.handleMessage(message, { id: "ext", url: "chrome-extension://ext/newtab.html" }, resolve));
  await send({ action: "shopifyAuditSearchProducts", query: "camera" });
  await send({ action: "shopifyAuditSearchProducts", query: "camera", shop: "One.myshopify.com" });
  assert.equal((await send({ action: "shopifyAuditSearchProducts", query: "camera", shop: "evil.test" })).success, false);
  await send({ action: "shopifyAuditDisconnect", shop: "two.myshopify.com" });
  await send({ action: "shopifyAuditDisconnect" });
  assert.deepEqual(messages, [
    { action: "shopifyAuditOffscreenSearchProducts", query: "camera", shop: "two.myshopify.com" },
    { action: "shopifyAuditOffscreenSearchProducts", query: "camera", shop: "one.myshopify.com" },
    { action: "shopifyAuditOffscreenDisconnect", shop: "two.myshopify.com" },
    { action: "shopifyAuditOffscreenDisconnect" },
  ]);
});
