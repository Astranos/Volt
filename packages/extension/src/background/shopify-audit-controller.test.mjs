import assert from "node:assert/strict";
import test from "node:test";
import { createShopifyAuditController } from "./shopify-audit-controller.ts";
import { yesterdayInComputerTimezone } from "../domain/shopify-audit.ts";
import { EXTENSION_SCANNER_SIGNAL_URL } from "../domain/mobile-scanner-signal-url.ts";

function setup(products) {
  const calls = { created: [], grouped: [], updatedGroups: [], activated: [] };
  const chromeApi = {
    tabs: {
      create: async (options) => {
        calls.created.push(options);
        return { id: calls.created.length };
      },
      group: async (options) => { calls.grouped.push(options); return 7; },
      update: async (id, options) => { calls.activated.push({ id, options }); },
    },
    tabGroups: { update: async (id, options) => { calls.updatedGroups.push({ id, options }); } },
  };
  const controller = createShopifyAuditController({
    chromeApi,
    extensionId: "ext",
    sendOffscreenMessage: async (message) => ({
      success: true,
      value: { shop: "sample.myshopify.com", date: message.date, products },
    }),
  });
  const request = () => new Promise((resolve) => {
    assert.equal(controller.handleMessage(
      { action: "shopifyAuditOpenYesterday" },
      { id: "ext", url: "chrome-extension://ext/newtab.html", tab: { windowId: 5 } },
      resolve,
    ), true);
  });
  return { calls, request };
}

test("opens all yesterday product admin pages in one named tab group", async () => {
  const products = [11, 12].map((id) => ({ id: String(id), title: `Product ${id}`, status: "DRAFT", url: `https://admin.shopify.com/store/sample/products/${id}` }));
  const { calls, request } = setup(products);
  const response = await request();
  assert.deepEqual(response, { success: true, value: { shop: "sample.myshopify.com", date: yesterdayInComputerTimezone().date, count: 2 } });
  assert.deepEqual(calls.created, products.map((product) => ({ url: product.url, active: false, windowId: 5 })));
  assert.deepEqual(calls.grouped, [{ tabIds: [1, 2] }]);
  assert.equal(calls.updatedGroups[0].options.title, `Shopify audit · ${yesterdayInComputerTimezone().date}`);
  assert.deepEqual(calls.activated, [{ id: 1, options: { active: true } }]);
});

test("does not open an unexpected product URL", async () => {
  const { calls, request } = setup([{ id: "11", title: "Wrong store", status: "DRAFT", url: "https://admin.shopify.com/store/other/products/11" }]);
  const response = await request();
  assert.equal(response.success, false);
  assert.deepEqual(calls.created, []);
});

test("refuses an audit day too large to open safely", async () => {
  const products = Array.from({ length: 101 }, (_, index) => ({
    id: String(index + 1), title: `Product ${index + 1}`, status: "DRAFT",
    url: `https://admin.shopify.com/store/sample/products/${index + 1}`,
  }));
  const { calls, request } = setup(products);
  const response = await request();
  assert.equal(response.success, false);
  assert.match(response.error, /up to 100 audit tabs/);
  assert.deepEqual(calls.created, []);
});

test("forwards live searches only from trusted extension pages", async () => {
  const messages = [];
  const controller = createShopifyAuditController({
    chromeApi: {},
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
