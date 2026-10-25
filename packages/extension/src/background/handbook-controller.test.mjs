import assert from "node:assert/strict";
import test from "node:test";
import { createHandbookController } from "./handbook-controller.ts";
import { isHandbookOffscreenRuntimeMessage } from "./messages.ts";

const newTab = { id: "ext", url: "chrome-extension://ext/newtab.html" };

function setup(value = [], { onForward } = {}) {
  const forwarded = [];
  const state = { epoch: "epoch-1" };
  const controller = createHandbookController({
    extensionId: "ext",
    accountEpoch: () => state.epoch,
    sendOffscreenMessage: async (message) => {
      forwarded.push(message);
      onForward?.(state);
      return { success: true, value };
    },
  });
  const request = (message, sender = newTab) => new Promise((resolve) => {
    assert.equal(controller.handleMessage(message, sender, resolve), true);
  });
  return { controller, forwarded, request, state };
}

test("relays list and reveal requests from the New Tab to the offscreen client", async () => {
  const { forwarded, request } = setup([{ _id: "abc" }]);
  assert.deepEqual(await request({ action: "handbookList" }), { success: true, value: [{ _id: "abc" }] });
  await request({ action: "handbookRevealSecret", id: "k57abcdefghijklmnop" });
  assert.deepEqual(forwarded, [
    { action: "handbookOffscreenList", accountEpoch: "epoch-1" },
    { action: "handbookOffscreenRevealSecret", accountEpoch: "epoch-1", id: "k57abcdefghijklmnop" },
  ]);
});

test("discards a response when the account changed while it was in flight", async () => {
  const { request } = setup([{ _id: "abc" }], { onForward: (state) => { state.epoch += "-next"; } });
  assert.deepEqual(await request({ action: "handbookList" }), { success: false, error: "Volt account changed. Try again." });
  assert.deepEqual(await request({ action: "handbookRevealSecret", id: "k57abcdefghijklmnop" }), {
    success: false,
    error: "Volt account changed. Try again.",
  });
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
