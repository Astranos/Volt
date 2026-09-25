import assert from "node:assert/strict";
import test from "node:test";
import { createShopifyAuditController } from "./shopify-audit-controller.ts";
import { yesterdayInComputerTimezone } from "../domain/shopify-audit.ts";

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
