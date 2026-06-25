import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeActionRegistry } from "./runtime-action-registry.ts";
import { registerSidepanelMessageActions } from "./sidepanel-message-controller.ts";

function createChromeApi({ activeTabs = [{ id: 42, windowId: 9 }] } = {}) {
  return {
    runtime: { lastError: null },
    tabs: {
      get(_tabId, callback) {
        callback({ id: 42, windowId: 9 });
      },
      query(_queryInfo, callback) {
        callback(activeTabs);
      },
    },
    sidePanel: {
      close(_options, callback) {
        callback?.();
      },
    },
  };
}

test("openInSidebar replies with the controller result and preserves explicit open mode", () => {
  const registry = createRuntimeActionRegistry();
  const responses = [];
  let capturedCallback = null;
  let capturedMode = null;

  registerSidepanelMessageActions({
    chromeApi: createChromeApi(),
    getCurrentTabId: () => 42,
    getLastTabId: () => null,
    getSidePanelState: () => ({ open: false, tool: null }),
    log: () => {},
    registry,
    setSidePanelState: () => {},
    toggleSidePanelForTab: (_tabId, _tool, mode, callback) => {
      capturedMode = mode;
      capturedCallback = callback;
    },
  });

  const handled = registry.handle(
    { action: "openInSidebar", tool: "mobile-scanner", mode: "open" },
    {},
    (response) => responses.push(response)
  );

  assert.equal(handled, true);
  assert.equal(capturedMode, "open");
  assert.equal(responses.length, 0);

  capturedCallback({
    success: true,
    mode: "open",
    tool: "mobile-scanner",
    windowId: 9,
  });

  assert.deepEqual(responses, [
    {
      success: true,
      mode: "open",
      tool: "mobile-scanner",
      windowId: 9,
      tabId: 42,
    },
  ]);
});

test("openInSidebar defaults to toggle mode when no mode is provided", () => {
  const registry = createRuntimeActionRegistry();
  let capturedMode = null;

  registerSidepanelMessageActions({
    chromeApi: createChromeApi(),
    getCurrentTabId: () => 42,
    getLastTabId: () => null,
    getSidePanelState: () => ({ open: false, tool: null }),
    log: () => {},
    registry,
    setSidePanelState: () => {},
    toggleSidePanelForTab: (_tabId, _tool, mode, callback) => {
      capturedMode = mode;
      callback({
        success: true,
        mode: "close",
        tool: "mobile-scanner",
        windowId: 9,
      });
    },
  });

  registry.handle(
    { action: "openInSidebar", tool: "mobile-scanner" },
    {},
    () => {}
  );

  assert.equal(capturedMode, "toggle");
});

test("openInSidebar uses the last tab fallback when no current tab is tracked", () => {
  const registry = createRuntimeActionRegistry();
  let capturedTabId = null;

  registerSidepanelMessageActions({
    chromeApi: createChromeApi(),
    getCurrentTabId: () => null,
    getLastTabId: () => 42,
    getSidePanelState: () => ({ open: false, tool: null }),
    log: () => {},
    registry,
    setSidePanelState: () => {},
    toggleSidePanelForTab: (tabId, _tool, _mode, callback) => {
      capturedTabId = tabId;
      callback({
        success: true,
        mode: "open",
        tool: "mobile-scanner",
        windowId: 9,
      });
    },
  });

  registry.handle(
    { action: "openInSidebar", tool: "mobile-scanner", mode: "open" },
    {},
    () => {}
  );

  assert.equal(capturedTabId, 42);
});

test("openInSidebar uses the active tab fallback when no tracked tab exists", () => {
  const registry = createRuntimeActionRegistry();
  const responses = [];
  let capturedTabId = null;

  registerSidepanelMessageActions({
    chromeApi: createChromeApi({ activeTabs: [{ id: 77, windowId: 9 }] }),
    getCurrentTabId: () => null,
    getLastTabId: () => null,
    getSidePanelState: () => ({ open: false, tool: null }),
    log: () => {},
    registry,
    setSidePanelState: () => {},
    toggleSidePanelForTab: (tabId, _tool, _mode, callback) => {
      capturedTabId = tabId;
      callback({
        success: true,
        mode: "open",
        tool: "mobile-scanner",
        windowId: 9,
      });
    },
  });

  registry.handle(
    { action: "openInSidebar", tool: "mobile-scanner", mode: "open" },
    {},
    (response) => responses.push(response)
  );

  assert.equal(capturedTabId, 77);
  assert.equal(responses[0].tabId, 77);
});

test("openInSidebar responds with no_active_tab when no tab can be resolved", () => {
  const registry = createRuntimeActionRegistry();
  const responses = [];

  registerSidepanelMessageActions({
    chromeApi: createChromeApi({ activeTabs: [] }),
    getCurrentTabId: () => null,
    getLastTabId: () => null,
    getSidePanelState: () => ({ open: false, tool: null }),
    log: () => {},
    registry,
    setSidePanelState: () => {},
    toggleSidePanelForTab: () => {
      throw new Error("unexpected sidepanel toggle");
    },
  });

  registry.handle(
    { action: "openInSidebar", tool: "mobile-scanner", mode: "open" },
    {},
    (response) => responses.push(response)
  );

  assert.deepEqual(responses, [{ success: false, error: "no_active_tab" }]);
});
