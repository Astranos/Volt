import assert from "node:assert/strict";
import test from "node:test";

import { createSidepanelToolController } from "./sidepanel-tool-controller.ts";

function createChromeApi(options = {}) {
  const calls = {
    close: [],
    open: [],
    setOptions: [],
    storageSet: [],
  };
  const openErrors = [...(options.openErrors || [])];
  const pendingStorageGets = [];
  const runtime = { lastError: null };
  const tabForGet = options.tabForGet || { id: 101, windowId: 7 };

  const chromeApi = {
    runtime,
    storage: {
      local: {
        get(defaults, callback) {
          const resolve = () =>
            callback({
              ...defaults,
              ...(options.storedTool
                ? { sidePanelTool: options.storedTool }
                : {}),
            });
          if (options.deferStorageGet) {
            pendingStorageGets.push(resolve);
          } else {
            resolve();
          }
        },
        set(values) {
          calls.storageSet.push(values);
        },
      },
    },
    tabs: {
      get(_tabId, callback) {
        callback(tabForGet);
      },
      query(_queryInfo, callback) {
        callback([{ id: 101, windowId: 7 }]);
      },
      sendMessage(_tabId, _message, callback) {
        callback?.();
      },
    },
    sidePanel: {
      close(options, callback) {
        calls.close.push(options);
        callback?.();
      },
      open(options, callback) {
        calls.open.push(options);
        const message = openErrors.shift();
        if (message) runtime.lastError = { message };
        callback?.();
        runtime.lastError = null;
      },
      setOptions(options) {
        calls.setOptions.push(options);
      },
    },
  };

  return {
    calls,
    chromeApi,
    flushStorageGets() {
      pendingStorageGets.splice(0).forEach((resolve) => resolve());
    },
  };
}

function createController(chromeApi) {
  return createSidepanelToolController({
    chromeApi,
    getFallbackTabIds: () => [],
    log: () => {},
  });
}

function toggleForWindow(controller, windowId, tool, mode) {
  return new Promise((resolve) => {
    controller.toggleForWindow(windowId, tool, mode, resolve);
  });
}

function toggleForTab(controller, tabId, tool, mode) {
  return new Promise((resolve) => {
    controller.toggleForTab(tabId, tool, mode, resolve);
  });
}

test("explicit open reopens stale same-tool state instead of toggling closed", async () => {
  const { calls, chromeApi } = createChromeApi();
  const controller = createController(chromeApi);

  const firstOpen = await toggleForWindow(controller, 7, "mobile-scanner", "open");
  assert.equal(firstOpen.success, true);
  assert.equal(firstOpen.mode, "open");
  assert.deepEqual(calls.setOptions, [
    { enabled: true, path: "sidepanel.html" },
  ]);
  assert.deepEqual(controller.getStateForWindow(7), {
    open: true,
    tool: "mobile-scanner",
  });

  const reopen = await toggleForWindow(controller, 7, "mobile-scanner", "open");

  assert.equal(reopen.success, true);
  assert.equal(reopen.mode, "open");
  assert.equal(calls.open.length, 2);
  assert.equal(calls.close.length, 0);
});

test("open without an explicit tool restores the last selected sidepanel tool", async () => {
  const { calls, chromeApi } = createChromeApi({ storedTool: "top-offers" });
  const controller = createController(chromeApi);

  const result = await toggleForTab(controller, 101, undefined, "open");

  assert.equal(result.success, true);
  assert.equal(result.mode, "open");
  assert.equal(result.tool, "top-offers");
  assert.deepEqual(controller.getStateForWindow(7), {
    open: true,
    tool: "top-offers",
  });
  assert.deepEqual(calls.storageSet, [
    { sidePanelTool: "top-offers", sidePanelUrl: null },
  ]);
});

test("toolbar-style opens preserve the user gesture while restoring the saved tool", () => {
  const { calls, chromeApi, flushStorageGets } = createChromeApi({
    deferStorageGet: true,
    storedTool: "top-offers",
  });
  const controller = createController(chromeApi);

  controller.openForWindowPreservingTool(7);

  assert.deepEqual(calls.open, [{ windowId: 7 }]);
  assert.deepEqual(calls.storageSet, []);
  assert.deepEqual(controller.getStateForWindow(7), {
    open: false,
    tool: null,
  });

  flushStorageGets();

  assert.deepEqual(controller.getStateForWindow(7), {
    open: true,
    tool: "top-offers",
  });
});

test("toggle still closes an open same-tool sidepanel", async () => {
  const { calls, chromeApi } = createChromeApi();
  const controller = createController(chromeApi);

  controller.setStateForWindow(7, { open: true, tool: "mobile-scanner" });

  const result = await toggleForWindow(controller, 7, "mobile-scanner", "toggle");

  assert.equal(result.success, true);
  assert.equal(result.mode, "close");
  assert.equal(calls.open.length, 0);
  assert.equal(calls.close.length, 1);
  assert.deepEqual(controller.getStateForWindow(7), { open: false, tool: null });
});

test("failed opens do not start the duplicate-open cooldown", async () => {
  const { calls, chromeApi } = createChromeApi({
    openErrors: ["sidepanel failed"],
  });
  const controller = createController(chromeApi);

  const failedOpen = await toggleForWindow(controller, 7, "mobile-scanner", "toggle");
  const retry = await toggleForWindow(controller, 7, "mobile-scanner", "toggle");

  assert.equal(failedOpen.success, false);
  assert.equal(failedOpen.mode, "open");
  assert.equal(retry.success, true);
  assert.equal(retry.mode, "open");
  assert.equal(calls.open.length, 2);
  assert.deepEqual(controller.getStateForWindow(7), {
    open: true,
    tool: "mobile-scanner",
  });
});

test("toggle reports cooldown skips for repeated non-explicit opens", async () => {
  const { chromeApi } = createChromeApi();
  const controller = createController(chromeApi);

  await toggleForWindow(controller, 7, "mobile-scanner", "open");
  controller.setStateForWindow(7, { open: false, tool: null });

  const result = await toggleForWindow(controller, 7, "mobile-scanner", "toggle");

  assert.equal(result.success, true);
  assert.equal(result.mode, "skipped");
  assert.equal(result.reason, "cooldown");
});

test("toggleForTab reports missing_window when the tab has no window id", async () => {
  const { chromeApi } = createChromeApi({ tabForGet: { id: 101 } });
  const controller = createController(chromeApi);

  const result = await toggleForTab(controller, 101, "mobile-scanner", "open");

  assert.deepEqual(result, {
    success: false,
    error: "missing_window",
    tool: "mobile-scanner",
  });
});
