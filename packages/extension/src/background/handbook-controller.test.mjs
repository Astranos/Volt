import assert from "node:assert/strict";
import test from "node:test";
import { createHandbookController } from "./handbook-controller.ts";
import { isHandbookOffscreenRuntimeMessage } from "./messages.ts";

const newTab = { id: "ext", url: "chrome-extension://ext/newtab.html" };

function setup(value = []) {
  const forwarded = [];
  const controller = createHandbookController({
    extensionId: "ext",
    sendOffscreenMessage: async (message) => {
      forwarded.push(message);
      return { success: true, value };
    },
  });
  const request = (message, sender = newTab) => new Promise((resolve) => {
    assert.equal(controller.handleMessage(message, sender, resolve), true);
  });
  return { controller, forwarded, request };
}

test("relays list and reveal requests from the New Tab to the offscreen client", async () => {
  const { forwarded, request } = setup([{ _id: "abc" }]);
  assert.deepEqual(await request({ action: "handbookList" }), { success: true, value: [{ _id: "abc" }] });
  await request({ action: "handbookRevealSecret", id: "k57abcdefghijklmnop" });
  assert.deepEqual(forwarded, [
    { action: "handbookOffscreenList" },
    { action: "handbookOffscreenRevealSecret", id: "k57abcdefghijklmnop" },
  ]);
});

test("refuses senders outside the Command Menu pages and malformed ids", async () => {
  const { forwarded, request } = setup();
  for (const sender of [
    { id: "ext", url: "https://example.com/" },
    { id: "other", url: "chrome-extension://other/newtab.html" },
    { id: "ext", url: "chrome-extension://ext/options.html" },
  ]) {
    assert.deepEqual(await request({ action: "handbookRevealSecret", id: "k57abcdefghijklmnop" }, sender), {
      success: false,
      error: "unauthorized_extension_sender",
    });
  }
  assert.deepEqual(await request({ action: "handbookRevealSecret", id: "../../etc" }), {
    success: false,
    error: "Invalid handbook entry.",
  });
  assert.deepEqual(forwarded, []);
});

test("ignores other actions and lets offscreen-bound handbook messages through", () => {
  const { controller } = setup();
  assert.equal(controller.handleMessage({ action: "shopifyAuditStatus" }, newTab, () => {}), false);
  assert.equal(isHandbookOffscreenRuntimeMessage({ action: "handbookOffscreenRevealSecret" }), true);
  assert.equal(isHandbookOffscreenRuntimeMessage({ action: "handbookRevealSecret" }), false);
});
