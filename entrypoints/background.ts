/**
 * Volt Chrome Extension Background Service Worker
 * Migrated to WXT background entrypoint.
 */
// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
/* global chrome */
import { defineBackground } from "wxt/utils/define-background";

export default defineBackground({
  main() {
    /**
     * @fileoverview Volt Chrome Extension Background Service Worker
     * @description Manages extension lifecycle, message handling, and core functionality
     * @version 1.0.0
     * @author PayMore Team
     * @license MIT
     *
     * This lite service worker handles:
     * - Extension installation and startup
     * - Message routing between content scripts and popup
     * - Side panel state management for controller testing
     * - Basic storage configuration
     * - Tab communication and injection
     * - Controller detection and testing
     */

    // Paymore extension background service worker (MV3) with verbose debug logging

    /** @type {boolean} Debug mode flag for console logging */
    let DEBUG = true;

    /**
     * @type {Map<number, {open: boolean, tool: string|null}>}
     * Track side panel state per tab for toggle/switch functionality
     */
    const SIDE_PANEL_STATE = new Map(); // tabId -> { open: boolean, tool: string | null }
    const PANEL_PAGE_PATH = "sidepanel.html";

    function getSidePanelState(tabId) {
      return (
        SIDE_PANEL_STATE.get(tabId) || {
          open: false,
          tool: null,
        }
      );
    }

    function setSidePanelState(tabId, nextState) {
      if (typeof tabId !== "number") return;
      SIDE_PANEL_STATE.set(tabId, nextState);
      broadcastSidePanelState(tabId, nextState);
    }

    function broadcastSidePanelState(tabId, state) {
      if (typeof tabId !== "number") return;
      const payload = state || getSidePanelState(tabId);
      try {
        chrome.tabs.sendMessage(
          tabId,
          { action: "sidePanelStateSync", state: payload },
          () => {
            const err = chrome.runtime.lastError;
            if (
              err &&
              DEBUG &&
              !String(err.message || "").includes("Receiving end")
            ) {
              log("sidePanelStateSync delivery issue", err.message);
            }
          }
        );
      } catch (e) {
        if (DEBUG) {
          log("sidePanelStateSync sendMessage error", e?.message || e, tabId);
        }
      }
    }

    function configurePanelForTab(tabId) {
      try {
        const options: any = {
          enabled: true,
          path: PANEL_PAGE_PATH,
        };
        // When we know the tabId, configure options for that tab explicitly so
        // chrome.sidePanel.open({ tabId }) is allowed to show the panel there.
        if (typeof tabId === "number") {
          options.tabId = tabId;
        }
        chrome.sidePanel.setOptions(options);
      } catch (setErr) {
        log("sidePanel setOptions error", setErr?.message || setErr);
      }
    }

    function updatePreferredTool(tool) {
      try {
        chrome.storage.local.set({
          sidePanelTool: tool,
          sidePanelUrl: null,
        });
      } catch (storageErr) {
        log(
          "Failed to set chrome storage for tool:",
          storageErr?.message || storageErr
        );
      }
    }

    function planSidePanelAction(tabId, desiredTool) {
      if (typeof tabId !== "number" || !desiredTool) return null;
      const prev = getSidePanelState(tabId);

      if (prev.open && prev.tool === desiredTool) {
        return {
          mode: "close",
          tabId,
          tool: desiredTool,
        };
      }

      updatePreferredTool(desiredTool);

      if (prev.open && prev.tool !== desiredTool) {
        setSidePanelState(tabId, { open: true, tool: desiredTool });
        return {
          mode: "switch",
          tabId,
          tool: desiredTool,
        };
      }

      configurePanelForTab(tabId);
      return {
        mode: "open",
        tabId,
        tool: desiredTool,
      };
    }

    // Track controller connection state
    let CONTROLLER_CONNECTED = false;
    let CONTROLLER_CHECK_INTERVAL = null;
    let LAST_CONTROLLER_COUNT = 0;

    const STORAGE_STATS_KEY = "grokStorageStats";
    const DEFAULT_STORAGE_STATS = {
      indexedPages: 0,
      totalDocuments: 0,
      totalTabs: 0,
      indexSize: 0,
      isInitialized: false,
    };
    async function openOptionsPage() {
      try {
        await chrome.tabs.create({
          url: chrome.runtime.getURL("options.html"),
          active: true,
        });
        return true;
      } catch (error) {
        log("Failed to open options page", error);
        return false;
      }
    }

    /**
     * Logs debug messages when DEBUG mode is enabled
     * @param {...any} args - Arguments to log
     */
    function log(...args) {
      if (DEBUG) console.log("[Volt Service Wroker]", ...args);
    }

    log("Service worker booted", { time: new Date().toISOString() });

    // Track previous active tab for CMDK "return to previous tab" feature
    let previousActiveTabId = null;
    let lastActiveTabId = null;
    let currentActiveTabId = null;

    try {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const active = tabs && tabs[0];
        if (active?.id) {
          lastActiveTabId = active.id;
          currentActiveTabId = active.id;
        }
      });
    } catch (_) {}

    chrome.tabs.onActivated.addListener(({ tabId }) => {
      try {
        if (lastActiveTabId && lastActiveTabId !== tabId) {
          previousActiveTabId = lastActiveTabId;
        }
        lastActiveTabId = tabId;
        currentActiveTabId = tabId;
      } catch (_) {}
    });
    // Clean up tracking if tabs are closed
    try {
      chrome.tabs.onRemoved.addListener((closedTabId) => {
        if (previousActiveTabId === closedTabId) previousActiveTabId = null;
        if (lastActiveTabId === closedTabId) lastActiveTabId = null;
        if (currentActiveTabId === closedTabId) {
          currentActiveTabId = null;
          try {
            chrome.tabs.query(
              { active: true, lastFocusedWindow: true },
              (tabs) => {
                const active = tabs && tabs[0];
                if (active?.id) currentActiveTabId = active.id;
              }
            );
          } catch (_) {}
        }
      });
    } catch (_) {}

    // Listen for extension icon click
    chrome.action.onClicked.addListener((tab) => {
      if (tab.id) {
        toggleSidePanelForTab(tab.id);
      }
    });

    // Listen for keyboard commands
    chrome.commands.onCommand.addListener((command) => {
      if (command === "open-options") {
        log("Open options command triggered");
        openOptionsPage().catch((error) =>
          log("openOptions command handler error", error)
        );
      } else if (command === "_execute_action") {
        log("Action shortcut triggered");
        // Open the sidepanel instead of the popup
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const active = tabs && tabs[0];
          if (active?.id) {
            toggleSidePanelForTab(active.id);
          }
        });
      } else if (command === "open-controller-testing") {
        log("Controller testing shortcut triggered");
        // Open the controller testing sidepanel
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const active = tabs && tabs[0];
          if (active?.id) {
            toggleSidePanelForTab(active.id, "controller-testing");
          } else {
            log("open-controller-testing: no active tab id");
          }
        });
      } else if (command === "open-quick-links") {
        log("Quick links shortcut triggered");
        // Open the quick links sidepanel
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const active = tabs && tabs[0];
          if (active?.id) {
            toggleSidePanelForTab(active.id, "quick-links");
          } else {
            log("open-quick-links: no active tab id");
          }
        });
      } else if (command === "reopen-last-closed-tab") {
        log("Reopen last closed tab shortcut triggered");
        try {
          if (!chrome.sessions || !chrome.sessions.restore) {
            log("chrome.sessions.restore is not available");
            return;
          }
          chrome.sessions.restore(undefined, (session) => {
            if (chrome.runtime.lastError) {
              log(
                "Error restoring last closed session",
                chrome.runtime.lastError.message
              );
              return;
            }
            log("Restored session from shortcut", session);
          });
        } catch (e) {
          log("Unexpected error in reopen-last-closed-tab handler", e);
        }
      }
    });

    // Create context menu items that operate on the current text selection
    try {
      const EBAY_SOLD_BASE =
        "https://www.ebay.com/sch/i.html?_nkw=iphone+15&_sacat=0&_from=R40&_dmd=2&rt=nc&LH_Sold=1&LH_Complete=1";
      const UPC_LOOKUP_BASE = "https://www.upcitemdb.com/upc/";
      const GOOGLE_UPC_BASE = "https://www.google.com/search?q=";
      const PRICE_CHARTING_BASE =
        "https://www.pricecharting.com/search-products?type=prices&q=grand+theft+auto&go=Go";

      // Ensure no stale items
      try {
        chrome.contextMenus.removeAll(() => {});
      } catch (_) {}

      try {
        chrome.contextMenus.create({
          id: "pm-search-ebay-sold",
          title: "Search for sold listings on eBay",
          contexts: ["selection"],
        });
        chrome.contextMenus.create({
          id: "pm-search-google-upc",
          title: "Search for UPC on Google",
          contexts: ["selection"],
        });
        chrome.contextMenus.create({
          id: "pm-search-google-mpn",
          title: "Search for MPN on Google",
          contexts: ["selection"],
        });
        chrome.contextMenus.create({
          id: "pm-search-upc",
          title: "Search on UPCItemDB",
          contexts: ["selection"],
        });
        chrome.contextMenus.create({
          id: "pm-search-price-charting",
          title: "Search on PriceCharting",
          contexts: ["selection"],
        });
      } catch (e) {
        log("contextMenus.create error", e?.message || e);
      }

      chrome.contextMenus.onClicked.addListener((info, _tab) => {
        const selection = (info.selectionText || "").trim();
        if (!selection) return;

        if (info.menuItemId === "pm-search-ebay-sold") {
          try {
            const u = new URL(EBAY_SOLD_BASE);
            u.searchParams.set("_nkw", selection);
            chrome.tabs.create({ url: u.href });
          } catch (err) {
            // Fallback: naive replacement + encode
            try {
              const q = encodeURIComponent(selection);
              const url = EBAY_SOLD_BASE.replace(/_nkw=[^&]*/, `_nkw=${q}`);
              chrome.tabs.create({ url });
            } catch (_) {
              log("Failed to open eBay search for selection", selection);
            }
          }
          return;
        }

        if (info.menuItemId === "pm-search-upc") {
          try {
            const url = `${UPC_LOOKUP_BASE}${encodeURIComponent(selection)}`;
            chrome.tabs.create({ url });
          } catch (err) {
            log("Failed to open UPC search for selection", selection);
          }
          return;
        }

        if (info.menuItemId === "pm-search-google-upc") {
          try {
            const query = encodeURIComponent(`UPC for ${selection}`);
            chrome.tabs.create({ url: `${GOOGLE_UPC_BASE}${query}` });
          } catch (err) {
            log("Failed to open Google UPC search for selection", selection);
          }
          return;
        }

        if (info.menuItemId === "pm-search-google-mpn") {
          try {
            const query = encodeURIComponent(`MPN for ${selection}`);
            chrome.tabs.create({ url: `${GOOGLE_UPC_BASE}${query}` });
          } catch (err) {
            log("Failed to open Google MPN search for selection", selection);
          }
          return;
        }

        if (info.menuItemId === "pm-search-price-charting") {
          try {
            const u = new URL(PRICE_CHARTING_BASE);
            u.searchParams.set("q", selection);
            chrome.tabs.create({ url: u.href });
          } catch (err) {
            try {
              const q = encodeURIComponent(selection);
              const url = PRICE_CHARTING_BASE.replace(/q=[^&]*/, `q=${q}`);
              chrome.tabs.create({ url });
            } catch (_) {
              log("Failed to open PriceCharting search", selection);
            }
          }
          return;
        }

        // only known handlers kept
      });
    } catch (_) {}

    // Provide a fetch fallback for content scripts that cannot fetch extension
    // resources directly due to page restrictions. Content scripts can request
    // `fetchResource` and the service worker will return the resource text.
    try {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.action === "fetchResource" && message?.url) {
          const url = chrome.runtime.getURL(message.url);
          fetch(url)
            .then((r) => {
              if (!r.ok)
                throw new Error("HTTP " + r.status + " " + r.statusText);
              return r.text();
            })
            .then((text) => sendResponse({ ok: true, html: text }))
            .catch((err) => sendResponse({ ok: false, error: String(err) }));
          return true; // keep channel open for async response
        }
      });
    } catch (_) {}

    /**
     * Handles extension installation and initial setup
     * Sets default storage values and configuration
     */
    chrome.runtime.onInstalled.addListener((details) => {
      log("onInstalled", details);
      chrome.storage.local.set({
        isEnabled: true,
        autoShowModal: true,
        vibrationEnabled: true,
        debugLogs: true,
      });

      // Set side panel behavior to open on action click
      try {
        if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
          chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
        }
      } catch (e) {
        log("Failed to set side panel behavior:", e);
      }

      // Open install page on first installation
      if (details.reason === "install") {
        log("First installation detected, opening install page");
        chrome.tabs.create({
          url: chrome.runtime.getURL("install.html"),
          active: true,
        });
      }
    });

    /**
     * Handles extension startup and initializes controller detection
     * Loads debug configuration and starts controller functionality
     */
    chrome.runtime.onStartup?.addListener(() => {
      log("onStartup");
      chrome.storage.local.get({ debugLogs: true }, (cfg) => {
        DEBUG = !!cfg.debugLogs;
        log("Debug flag loaded", DEBUG);
      });
      // Start controller detection
      startControllerDetection();
    });

    /**
     * Handles extension context invalidation and recovery
     * Sends heartbeat messages to content scripts to check if they're still valid
     */
    chrome.runtime.onSuspend?.addListener(() => {
      log("Extension suspended, cleaning up resources");
    });

    // Add message handler for extension health checks
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === "EXTENSION_HEALTH_CHECK") {
        log("Extension health check received from tab:", sender.tab?.id);
        sendResponse({ status: "healthy", timestamp: Date.now() });
        return true;
      }

      if (message.type === "CONTENT_SCRIPT_READY") {
        log("Content script ready notification from tab:", sender.tab?.id);
        sendResponse({ status: "acknowledged" });
        return true;
      }
    });

    /**
     * Sends a message to the currently active tab
     * Creates a new tab if no injectable tab is available
     * @param {Object} message - Message to send to the tab
     */
    function sendToActiveTab(message) {
      log("sendToActiveTab", message);
      chrome.tabs.query({ lastFocusedWindow: true }, (tabs) => {
        const isInjectable = (u = "") => /^(https?:|file:|ftp:)/.test(u);
        const active = tabs.find((t) => t.active);
        let target =
          active && isInjectable(active.url)
            ? active
            : tabs.find((t) => isInjectable(t.url));

        if (!target) {
          log("No injectable tab in currentWindow; creating a new one");
          chrome.tabs.create({ url: "https://example.com" }, (newTab) => {
            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
              if (tabId === newTab.id && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                deliverToTab(newTab.id, message);
              }
            });
          });
          return;
        }

        // Allow localhost/127.0.0.1 during development

        deliverToTab(target.id, message);
      });
    }

    /**
     * Returns content script declarations from the manifest so hashed bundles can be executed.
     * @returns {chrome.runtime.ManifestV3['content_scripts']} Manifest content scripts array.
     */
    function getManifestContentScripts() {
      try {
        return chrome.runtime.getManifest()?.content_scripts || [];
      } catch (_) {
        return [];
      }
    }

    /**
     * Ensures content scripts declared in the manifest are injected.
     * @param {number} tabId - Target tab ID
     */
    function injectManifestContentScripts(tabId) {
      const entries = getManifestContentScripts();
      entries.forEach((entry) => {
        const target = { tabId, allFrames: Boolean(entry.all_frames) };
        (entry.css || []).forEach((file) => {
          try {
            chrome.scripting.insertCSS({ target, files: [file] });
          } catch (_) {}
        });
        (entry.js || []).forEach((file) => {
          try {
            chrome.scripting.executeScript({ target, files: [file] });
          } catch (_) {}
        });
      });
    }

    /**
     * Delivers a message to a specific tab with retry logic
     * Handles content script injection if needed
     * @param {number} tabId - Target tab ID
     * @param {Object} message - Message to deliver
     */
    function deliverToTab(tabId, message) {
      const trySend = (attempt) => {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          const lastErr = chrome.runtime.lastError;
          if (lastErr) {
            log(`send attempt ${attempt} failed`, lastErr.message);
            if (attempt === 1) {
              // Try explicit injection then retry once
              log("injecting content script via scripting API");
              injectManifestContentScripts(tabId);
              setTimeout(() => trySend(2), 500);
            } else if (attempt === 2) {
              // Final fallback: postMessage into page
              log("final fallback: postMessage showControllerModal");
              chrome.scripting.executeScript({
                target: { tabId, allFrames: true },
                func: () =>
                  window.postMessage(
                    { source: "scout", action: "showControllerModal" },
                    "*"
                  ),
              });
            }
          } else {
            log("Message delivered; response=", response);
          }
        });
      };
      trySend(1);
    }

    /**
     * Helper to handle clipboard via offscreen document
     */
    async function handleClipboardWithOffscreen(action, text) {
      // Create offscreen document if needed
      const offscreenCreated = await createOffscreenDocument();
      if (!offscreenCreated) {
        throw new Error(
          "Failed to create offscreen document for clipboard access"
        );
      }

      // Send message to offscreen document
      return chrome.runtime.sendMessage({
        action,
        text,
      });
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      log("onMessage", {
        message,
        sender: { id: sender?.tab?.id, url: sender?.tab?.url },
      });

      // Handle PC_ITEM_SELECTED from PriceCharting game page content script
      if (message.type === "PC_ITEM_SELECTED" && message.data) {
        log("PC_ITEM_SELECTED received", message.data);

        // Save item to localStorage via storage.local (will be synced to sidepanel)
        chrome.storage.local.get(
          { scout_pricecharting_pending_items: [] },
          (result) => {
            const pendingItems = result.scout_pricecharting_pending_items || [];
            pendingItems.push(message.data);
            chrome.storage.local.set(
              { scout_pricecharting_pending_items: pendingItems },
              () => {
                log("Item saved to pending queue");

                // Open sidepanel with price-charting-tool
                chrome.tabs.query(
                  { active: true, currentWindow: true },
                  (tabs) => {
                    const active = tabs && tabs[0];
                    const tabId = sender?.tab?.id || active?.id;
                    if (tabId) {
                      // Set the tool preference and open sidepanel
                      updatePreferredTool("price-charting-tool");

                      // We want to ENSURE it's open, not toggle it.
                      // planSidePanelAction is for toggling.
                      configurePanelForTab(tabId);
                      try {
                        chrome.sidePanel.open({ tabId }, () => {
                          const err = chrome.runtime.lastError;
                          if (err) {
                            log("sidePanel open lastError", err.message);
                          } else {
                            setSidePanelState(tabId, {
                              open: true,
                              tool: "price-charting-tool",
                            });
                            log("Sidepanel opened for price-charting-tool");
                          }
                        });
                      } catch (openErr) {
                        log(
                          "sidePanel open error",
                          openErr?.message || openErr
                        );
                      }
                    }
                  }
                );
              }
            );
          }
        );

        sendResponse({ success: true });
        return true;
      }

      switch (message.action) {
        case "csReady":
          log("content script ready", message?.url);
          sendResponse({ ok: true });
          break;
        case "openInActionPopup": {
          const tool = message?.tool;
          if (!tool) {
            sendResponse({ success: false, error: "missing_tool" });
            break;
          }
          openInActionPopup(tool);
          sendResponse({ success: true });
          break;
        }
        case "openInSidebar": {
          const tool = message?.tool;
          if (!tool) {
            sendResponse({ success: false, error: "missing_tool" });
            break;
          }

          // Use the explicitly provided tabId if available, otherwise prefer the sender's tab
          // When invoked from the action popup, sender.tab will be undefined, so fall back to our
          // tracked active tab or query the current active tab explicitly.
          const candidateId =
            message?.tabId ??
            sender?.tab?.id ??
            currentActiveTabId ??
            lastActiveTabId;
          if (candidateId) {
            toggleSidePanelForTab(candidateId, tool);
            sendResponse({ success: true, tabId: candidateId });
          } else {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              const active = tabs && tabs[0];
              if (active?.id) {
                toggleSidePanelForTab(active.id, tool);
                sendResponse({ success: true, tabId: active.id });
              } else {
                sendResponse({ success: false, error: "no_active_tab" });
              }
            });
            return true; // async response
          }
          break;
        }
        case "getSidePanelStateForTab": {
          const tabId = sender?.tab?.id ?? message?.tabId ?? null;
          if (tabId === null) {
            sendResponse({ success: false, error: "missing_tab" });
            break;
          }
          sendResponse({
            success: true,
            tabId,
            state: getSidePanelState(tabId),
          });
          break;
        }
        case "sidePanelToggleResult": {
          const tabId = message?.tabId ?? sender?.tab?.id;
          const status = message?.status;
          const tool = message?.tool || null;
          if (typeof tabId !== "number") {
            sendResponse({ success: false, error: "missing_tab" });
            break;
          }
          if (status === "opened") {
            setSidePanelState(tabId, { open: true, tool });
          } else if (status === "closed") {
            setSidePanelState(tabId, { open: false, tool: null });
          } else if (status === "error") {
            log(
              "sidePanelToggleResult error",
              message?.error || "unknown_error",
              { tool, tabId, source: message?.source }
            );
          }
          sendResponse({ success: true });
          break;
        }
        case "openToolbarCustomization": {
          const intentKey = "popupIntent";
          const intentValue = "toolbar-customization";
          let notifyQueued = false;
          const notifyPopup = () => {
            if (notifyQueued) return;
            notifyQueued = true;
            setTimeout(() => {
              try {
                chrome.runtime.sendMessage({
                  action: "toolbarCustomizationIntent",
                });
              } catch (e) {
                log("openToolbarCustomization notify error", e?.message || e);
              }
            }, 100);
          };

          chrome.storage.local.set({ [intentKey]: intentValue });
          // Try to open the action popup; if that fails (no user gesture or other
          // restriction), fall back to opening the popup page as a normal window.
          try {
            chrome.action.openPopup(() => {
              const err = chrome.runtime.lastError;
              if (err) {
                log("openPopup error", err.message);
                try {
                  chrome.windows.create({
                    url: chrome.runtime.getURL("popup.html"),
                    type: "popup",
                    width: 480,
                    height: 640,
                    focused: true,
                  });
                } catch (_) {}
              }
              notifyPopup();
            });
          } catch (e) {
            log("openToolbarCustomization openPopup threw", e?.message || e);
            try {
              chrome.windows.create({
                url: chrome.runtime.getURL("popup.html"),
                type: "popup",
                width: 480,
                height: 640,
                focused: true,
              });
            } catch (_) {}
            notifyPopup();
          }
          sendResponse({ success: true });
          break;
        }
        case "closeSidebar": {
          const tabId = sender?.tab?.id ?? message?.tabId;
          if (typeof tabId === "number") {
            try {
              chrome.sidePanel.close({ tabId }, () => {
                const err = chrome.runtime.lastError;
                if (err) {
                  log("sidePanel close error", err.message);
                } else {
                  setSidePanelState(tabId, { open: false, tool: null });
                  log(`Sidepanel closed for tab: ${tabId}`);
                }
              });
            } catch (e) {
              log("sidePanel close error", e?.message || e);
            }
          } else {
            log("closeSidebar missing tabId");
          }
          sendResponse({ success: true });
          break;
        }
        case "openToolWindow": {
          const tool = message?.tool;
          if (!tool) {
            sendResponse({ success: false, error: "missing_tool" });
            break;
          }
          // Open near toolbar by default (right-middle of primary work area)
          try {
            chrome.system.display.getInfo((displays) => {
              const d = (displays && displays[0] && displays[0].workArea) || {
                left: 0,
                top: 0,
                width: 1280,
                height: 800,
              };
              const anchor = {
                x: d.left + d.width - 72,
                y: d.top + Math.floor(d.height / 2),
              };
              openToolNear(tool, anchor, 0.4);
            });
          } catch (_) {
            openToolNear(tool, { x: 1200, y: 600 }, 0.4);
          }
          sendResponse({ success: true });
          break;
        }
        case "openToolWindowAt": {
          const tool = message?.tool;
          const anchor = message?.anchor || {};
          if (!tool) {
            sendResponse({ success: false, error: "missing_tool" });
            break;
          }
          openToolNear(tool, anchor, 0.4);
          sendResponse({ success: true });
          break;
        }
        case "resizeToolForTab": {
          const width = Number(message?.width || 0);
          const height = Number(message?.height || 0);
          resizeFocusedPopup(width || null, height || null);
          sendResponse({ success: true });
          break;
        }
        case "getControllerStatus":
          // Hook for future background gamepad monitoring
          sendResponse({ connected: false, name: null });
          break;
        case "triggerControllerTest":
          openControllerTest();
          sendResponse({ success: true });
          break;
        case "checkControllerStatus":
          // Check current controller status
          checkForControllers();
          sendResponse({ success: true, connected: CONTROLLER_CONNECTED });
          break;
        case "enableControllerDetection":
          startControllerDetection();
          sendResponse({ success: true });
          break;
        case "disableControllerDetection":
          stopControllerDetection();
          sendResponse({ success: true });
          break;
        case "openUrl": {
          const url = message?.url;
          if (!url) {
            sendResponse({ success: false, error: "missing_url" });
            break;
          }
          chrome.tabs.create({ url }, (tab) => {
            sendResponse({ success: true, tabId: tab?.id });
          });
          return true;
        }
        case "OPEN_OPTIONS": {
          openOptionsPage()
            .then((opened) => {
              sendResponse({ success: opened });
            })
            .catch((error) => {
              log("OPEN_OPTIONS handler error", error);
              sendResponse({ success: false, error: String(error) });
            });
          return true;
        }
        case "open-settings": {
          const section = message?.section || "";
          const url = section
            ? chrome.runtime.getURL(`options.html#${section}`)
            : chrome.runtime.getURL("options.html");
          chrome.tabs.create({ url, active: true }, (tab) => {
            sendResponse({ success: true, tabId: tab?.id });
          });
          return true;
        }
        case "hideControllerModal":
          sendToActiveTab({ action: "hideControllerModal" });
          sendResponse({ success: true });
          break;
        case "GET_WEBPAGE_CONTEXT":
          // Get webpage context from the active tab
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
              const activeTab = tabs[0];
              // Send message to content script to get webpage data
              chrome.tabs.sendMessage(
                activeTab.id,
                { action: "GET_WEBPAGE_CONTEXT" },
                (response) => {
                  if (chrome.runtime.lastError) {
                    log(
                      "Error getting webpage context:",
                      chrome.runtime.lastError
                    );
                    sendResponse({
                      success: false,
                      error: "Failed to get webpage context",
                    });
                  } else if (response && response.success) {
                    sendResponse({ success: true, data: response.data });
                  } else {
                    sendResponse({
                      success: false,
                      error: "No webpage context available",
                    });
                  }
                }
              );
            } else {
              sendResponse({ success: false, error: "No active tab found" });
            }
          });
          return true; // Keep message channel open for async response
        case "getActiveTab":
          // Get the currently active tab
          log("getActiveTab requested");
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length > 0) {
              log("getActiveTab: found tab", tabs[0]);
              sendResponse({ tab: tabs[0] });
            } else {
              log("getActiveTab: no tabs found");
              sendResponse({ error: "No active tab found" });
            }
          });
          return true; // Keep message channel open for async response
        case "GET_TABS":
          // Get all tabs for CMDK palette
          chrome.tabs.query({}, (tabs) => {
            const tabInfo = tabs.map((tab) => ({
              id: tab.id,
              title: tab.title,
              url: tab.url,
              favIconUrl: tab.favIconUrl,
              active: tab.active,
              windowId: tab.windowId,
            }));
            sendResponse({ tabs: tabInfo });
          });
          return true; // Keep message channel open for async response
        case "SWITCH_TAB":
          // Switch to a specific tab
          const tabId = message.tabId;
          if (tabId) {
            chrome.tabs.update(tabId, { active: true }, (tab) => {
              if (tab) {
                chrome.windows.update(tab.windowId, { focused: true });
              }
              sendResponse({ success: true });
            });
          } else {
            sendResponse({ success: false, error: "No tabId provided" });
          }
          return true;
        case "GET_PREVIOUS_TAB":
          // Get the previous active tab ID
          sendResponse({ tabId: previousActiveTabId });
          break;
        case "OPEN_TAB":
          // Open a new tab with the given URL
          const newTabUrl = message.url;
          if (newTabUrl) {
            chrome.tabs.create({ url: newTabUrl }, (tab) => {
              sendResponse({ success: true, tabId: tab?.id });
            });
          } else {
            sendResponse({ success: false, error: "No URL provided" });
          }
          return true;
        case "UPDATE_CURRENT_TAB":
          // Update the current tab's URL (for new tab override)
          const updateTabUrl = message.url;
          if (updateTabUrl && sender.tab?.id) {
            chrome.tabs.update(sender.tab.id, { url: updateTabUrl }, (tab) => {
              sendResponse({ success: true, tabId: tab?.id });
            });
          } else {
            sendResponse({
              success: false,
              error: "No URL or tab ID provided",
            });
          }
          return true;
        case "FETCH_CSV_LINKS":
          // Fetch CSV data (bypasses CORS in content scripts)
          const csvUrl = message.url;
          if (csvUrl) {
            fetch(csvUrl)
              .then((response) => response.text())
              .then((data) => {
                sendResponse({ success: true, data });
              })
              .catch((error) => {
                log("CSV fetch error:", error);
                sendResponse({ success: false, error: error.message });
              });
          } else {
            sendResponse({ success: false, error: "No URL provided" });
          }
          return true; // Keep channel open for async response
        case "toggleDebug":
          DEBUG = !!message.value;
          chrome.storage.local.set({ debugLogs: DEBUG });
          log("DEBUG toggled", DEBUG);
          sendResponse({ success: true, debug: DEBUG });
          break;
        case "generateQr": {
          // Generate QR in SW to bypass page CSP (return as data URL)
          const text = message?.text || "";
          const size = Number(message?.size || 256);
          if (!text) {
            sendResponse({ success: false, error: "missing_text" });
            break;
          }
          const endpoint = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(
            text
          )}`;
          fetch(endpoint)
            .then(async (r) => {
              if (!r.ok) throw new Error(`HTTP ${r.status}`);
              const buf = await r.arrayBuffer();
              const base64 = arrayBufferToBase64(buf);
              const dataUrl = `data:image/png;base64,${base64}`;
              sendResponse({ success: true, dataUrl });
            })
            .catch((err) => {
              log("generateQr error", err?.message || err);
              sendResponse({
                success: false,
                error: String(err?.message || err),
              });
            });
          return true;
        }
        case "ping":
          log("pong");
          sendResponse({ pong: true, time: Date.now() });
          break;
        case "openFloatingToolbar":
          openFloatingToolbar();
          sendResponse({ success: true });
          break;
        case "toggleSidepanelTool": {
          const tool = message?.tool || "controller-testing";
          toggleSidePanelForTab(sender?.tab?.id, tool);
          sendResponse({ success: true });
          break;
        }
        case "previousTab": {
          // Switch to previous tab in current window
          chrome.tabs.query({ currentWindow: true }, (tabs) => {
            if (tabs.length < 2) {
              sendResponse({ success: false, error: "not_enough_tabs" });
              return;
            }
            const currentIndex = tabs.findIndex((t) => t.active);
            const prevIndex =
              currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
            const prevTab = tabs[prevIndex];
            if (prevTab?.id) {
              chrome.tabs.update(prevTab.id, { active: true });
              sendResponse({ success: true, tabId: prevTab.id });
            } else {
              sendResponse({ success: false, error: "no_prev_tab" });
            }
          });
          return true;
        }
        case "nextTab": {
          // Switch to next tab in current window
          chrome.tabs.query({ currentWindow: true }, (tabs) => {
            if (tabs.length < 2) {
              sendResponse({ success: false, error: "not_enough_tabs" });
              return;
            }
            const currentIndex = tabs.findIndex((t) => t.active);
            const nextIndex = (currentIndex + 1) % tabs.length;
            const nextTab = tabs[nextIndex];
            if (nextTab?.id) {
              chrome.tabs.update(nextTab.id, { active: true });
              sendResponse({ success: true, tabId: nextTab.id });
            } else {
              sendResponse({ success: false, error: "no_next_tab" });
            }
          });
          return true;
        }
        case "closeTab": {
          // Close current tab
          const tabId = sender?.tab?.id;
          if (tabId) {
            chrome.tabs.remove(tabId, () => {
              sendResponse({ success: true });
            });
            return true;
          } else {
            // If called from context menu without sender tab, close active tab
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs.length > 0 && tabs[0]?.id) {
                chrome.tabs.remove(tabs[0].id, () => {
                  sendResponse({ success: true });
                });
              } else {
                sendResponse({ success: false, error: "no_active_tab" });
              }
            });
            return true;
          }
        }
        case "downloadFile": {
          const url = message?.url;
          if (!url) {
            sendResponse({ success: false, error: "missing_url" });
            break;
          }
          try {
            chrome.downloads.download({ url }, (downloadId) => {
              if (chrome.runtime.lastError) {
                log("Download error:", chrome.runtime.lastError);
                sendResponse({
                  success: false,
                  error: chrome.runtime.lastError.message,
                });
              } else {
                sendResponse({ success: true, downloadId });
              }
            });
          } catch (error) {
            log("Download error:", error);
            sendResponse({ success: false, error: String(error) });
          }
          return true;
        }
        case "copyToClipboard": {
          const text = message?.text;
          if (!text) {
            sendResponse({ success: false, error: "missing_text" });
            break;
          }

          // Try offscreen document for clipboard operations
          handleClipboardWithOffscreen("copyToClipboard", text)
            .then((response) => {
              sendResponse(response);
            })
            .catch((err) => {
              log("copyToClipboard offscreen error:", err);
              // Fallback to navigator.clipboard in SW (requires permission)
              if (navigator.clipboard) {
                navigator.clipboard
                  .writeText(text)
                  .then(() => sendResponse({ success: true }))
                  .catch((e) =>
                    sendResponse({ success: false, error: String(e) })
                  );
              } else {
                sendResponse({ success: false, error: String(err) });
              }
            });
          return true;
        }
        case "readFromClipboard": {
          // Try offscreen document for clipboard operations
          handleClipboardWithOffscreen("readFromClipboard")
            .then((response) => {
              sendResponse(response);
            })
            .catch((err) => {
              log("readFromClipboard offscreen error:", err);
              // Fallback to navigator.clipboard in SW (requires permission)
              if (navigator.clipboard) {
                navigator.clipboard
                  .readText()
                  .then((text) => sendResponse({ success: true, text }))
                  .catch((e) =>
                    sendResponse({ success: false, error: String(e) })
                  );
              } else {
                sendResponse({ success: false, error: String(err) });
              }
            });
          return true;
        }
        case "openDevTools": {
          try {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              if (tabs.length > 0 && tabs[0]?.id) {
                const tabId = tabs[0].id;

                // Inject debugger statement - this will pause if DevTools is open
                chrome.scripting.executeScript(
                  {
                    target: { tabId },
                    func: () => {
                      console.log(
                        "%c[Scout] Debug Tools Activated",
                        "color: #00ff00; font-size: 16px; font-weight: bold;"
                      );
                      console.log(
                        "%cDevTools should now be visible. If not, press F12 or Cmd+Option+I (Mac) / Ctrl+Shift+I (Windows/Linux)",
                        "color: #ffaa00; font-size: 14px;"
                      );
                      debugger; // This will break if DevTools is already open
                    },
                  },
                  () => {
                    if (chrome.runtime.lastError) {
                      log("executeScript error:", chrome.runtime.lastError);
                    }
                    log("Debugger statement injected");
                    sendResponse({
                      success: true,
                      message:
                        "Debug tools activated. Check the Console tab in DevTools.",
                    });
                  }
                );
              } else {
                sendResponse({ success: false, error: "no_active_tab" });
              }
            });
          } catch (error) {
            log("openDevTools error:", error);
            sendResponse({
              success: false,
              error: String(error),
            });
          }
          return true;
        }
        case "goBackToPOS":
          goBackToPOS();
          sendResponse({ success: true });
          break;
        case "checkSiteStatus": {
          const domain = message?.domain;
          if (!domain) {
            sendResponse({ success: false, error: "missing_domain" });
            break;
          }

          chrome.storage.local.get(
            { disabledSites: [], globalEnabled: true },
            (cfg) => {
              const isDisabled =
                !cfg.globalEnabled ||
                cfg.disabledSites.some((site) => {
                  // Simple domain matching (can be enhanced with wildcard support)
                  return domain === site || domain.endsWith("." + site);
                });

              sendResponse({
                success: true,
                disabled: isDisabled,
                globalEnabled: cfg.globalEnabled,
                disabledSites: cfg.disabledSites,
              });
            }
          );
          return true; // Keep message channel open for async response
        }
        case "updateDisabledSites": {
          const sites = message?.sites;
          if (!Array.isArray(sites)) {
            sendResponse({ success: false, error: "invalid_sites_array" });
            break;
          }

          chrome.storage.local.set({ disabledSites: sites }, () => {
            // Broadcast settings change to all tabs
            chrome.tabs.query({}, (tabs) => {
              tabs.forEach((t) => {
                try {
                  chrome.tabs.sendMessage(t.id, {
                    action: "pm-settings-changed",
                    disabledSites: sites,
                  });
                } catch (_) {}
              });
            });

            sendResponse({ success: true });
          });
          return true; // Keep message channel open for async response
        }
        case "toggleCurrentSite": {
          const enabled = message?.enabled;
          const domain = message?.domain;

          if (typeof enabled !== "boolean" || !domain) {
            sendResponse({ success: false, error: "invalid_parameters" });
            break;
          }

          chrome.storage.local.get({ disabledSites: [] }, (cfg) => {
            let updatedSites;

            if (enabled) {
              // Remove domain from disabled list
              updatedSites = cfg.disabledSites.filter(
                (site) => site !== domain
              );
            } else {
              // Add domain to disabled list
              updatedSites = [...cfg.disabledSites, domain];
            }

            chrome.storage.local.set({ disabledSites: updatedSites }, () => {
              // Broadcast settings change to all tabs
              chrome.tabs.query({}, (tabs) => {
                tabs.forEach((t) => {
                  try {
                    chrome.tabs.sendMessage(t.id, {
                      action: "pm-settings-changed",
                      disabledSites: updatedSites,
                    });
                  } catch (_) {}
                });
              });

              sendResponse({ success: true, disabledSites: updatedSites });
            });
          });
          return true; // Keep message channel open for async response
        }
        default:
          log("Unknown action", message?.action);
          sendResponse({ ok: false, error: "unknown_action" });
      }
      return true; // keep the message channel open if needed
    });

    function openControllerTest() {
      log("Opening Controller Test");
      // Use sidebar instead of action popup
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const active = tabs && tabs[0];
        if (active?.id) {
          toggleSidePanelForTab(active.id, "controller-testing");
        } else {
          log("openControllerTest: no active tab id");
        }
      });
    }

    function openFloatingToolbar() {
      log("Opening Floating Toolbar");
      openInActionPopup("floating-toolbar");
    }

    function goBackToPOS() {
      log("Going back to POS tab");

      // Find the last tab with pos.paymore.tech URL
      chrome.tabs.query({}, (tabs) => {
        const posTabs = tabs.filter(
          (tab) => tab.url && tab.url.includes("pos.paymore.tech")
        );

        if (posTabs.length > 0) {
          // Sort by last accessed time (most recent first)
          const sortedTabs = posTabs.sort((a, b) => {
            const aTime = a.lastAccessed || 0;
            const bTime = b.lastAccessed || 0;
            return bTime - aTime;
          });

          const targetTab = sortedTabs[0];
          log("Found POS tab:", targetTab.id, targetTab.url);

          // Activate and focus the POS tab
          chrome.tabs.update(targetTab.id, { active: true });
          chrome.windows.update(targetTab.windowId, { focused: true });

          // Close the current toolbar tab
          chrome.tabs.query(
            { active: true, currentWindow: true },
            (activeTabs) => {
              if (activeTabs.length > 0) {
                chrome.tabs.remove(activeTabs[0].id);
              }
            }
          );
        } else {
          log("No POS tabs found, opening new one");
          // If no POS tab exists, open a new one
          chrome.tabs.create({
            url: "https://pos.paymore.tech",
            active: true,
          });
        }
      });
    }

    function toggleSidePanelForTab(tabId, tool) {
      if (!tool) {
        chrome.storage.local.get(
          { sidePanelTool: "controller-testing" },
          (res) => {
            toggleSidePanelForTab(
              tabId,
              res.sidePanelTool || "controller-testing"
            );
          }
        );
        return;
      }
      const desiredTool = tool;

      const asValidTabId = (value) => {
        if (typeof value === "number" && Number.isInteger(value) && value >= 0)
          return value;
        if (typeof value === "string") {
          const parsed = Number(value);
          if (Number.isInteger(parsed) && parsed >= 0) return parsed;
        }
        return null;
      };

      try {
        const openForTab = (id) => {
          const plan = planSidePanelAction(id, desiredTool);
          if (!plan) return;

          if (plan.mode === "close") {
            try {
              chrome.sidePanel.close({ tabId: id }, () => {
                const err = chrome.runtime.lastError;
                if (err) {
                  log("sidePanel close error", err.message);
                } else {
                  setSidePanelState(id, { open: false, tool: null });
                  log(`Sidepanel closed for tool: ${desiredTool}`);
                }
              });
            } catch (closeErr) {
              log("sidePanel close error", closeErr?.message || closeErr);
            }
            return;
          }

          if (plan.mode === "switch") {
            log(`Switched sidepanel to tool: ${desiredTool} on tab: ${id}`);
            return;
          }

          try {
            chrome.sidePanel.open({ tabId: id }, () => {
              const err = chrome.runtime.lastError;
              if (err) {
                log("sidePanel open lastError", err.message);
              } else {
                setSidePanelState(id, { open: true, tool: desiredTool });
                log(`Sidepanel opened for tool: ${desiredTool} on tab: ${id}`);
              }
            });
          } catch (openErr) {
            log("sidePanel open error", openErr?.message || openErr);
          }
        };

        const resolvedTabId =
          asValidTabId(tabId) ??
          asValidTabId(currentActiveTabId) ??
          asValidTabId(lastActiveTabId);

        if (resolvedTabId !== null) {
          openForTab(resolvedTabId);
          return;
        }

        log(
          "toggleSidePanelForTab: could not resolve tab id immediately; querying"
        );
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const active = tabs && tabs[0];
          const fallbackId = asValidTabId(active?.id);
          if (fallbackId !== null) {
            openForTab(fallbackId);
          } else {
            log(
              "toggleSidePanelForTab: unable to resolve active tab id for sidepanel"
            );
          }
        });
      } catch (e) {
        log("toggleSidePanelForTab error", e?.message || e);
      }
    }

    function arrayBufferToBase64(buffer) {
      let binary = "";
      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      // btoa works with binary strings
      return btoa(binary);
    }

    function toolToPath(tool) {
      switch (tool) {
        case "controller-testing":
          return "/tools/controller-testing";
        case "price-charting-tool":
          return "/tools/price-charting";
        case "upc-search":
          return "/tools/upc-search";
        case "scout":
          return "/tools/scout";
        case "settings":
          return "/tools/settings";
        case "floating-toolbar":
          return "/tools/floating-toolbar";
        case "help":
          return "/tools/help";
        case "min-reqs":
          return "/tools/min-reqs";
        case "shopify-search":
          return "/tools/shopify/search";
        case "shopify-storefront":
          return "/tools/shopify/storefront";
        case "ebay":
          return "/tools/ebay";
        case "links":
          return "/tools/links";
        default:
          return "/";
      }
    }

    function openInActionPopup(tool) {
      log("openInActionPopup redirecting to sidepanel", { tool });
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const active = tabs && tabs[0];
        if (active?.id) {
          toggleSidePanelForTab(active.id, tool);
        }
      });
    }

    let CURRENT_TOOL_POPUP_ID = null;
    let AUTOCLOSE_ON_BLUR = true;
    let FOCUS_LISTENER_ATTACHED = false;

    function ensureAutoCloseListener() {
      if (FOCUS_LISTENER_ATTACHED) return;
      try {
        chrome.windows.onFocusChanged.addListener((winId) => {
          try {
            if (!AUTOCLOSE_ON_BLUR) return;
            // If our popup is open and focus moved to another window (or to none), close it
            if (
              CURRENT_TOOL_POPUP_ID &&
              winId !== CURRENT_TOOL_POPUP_ID &&
              winId !== chrome.windows.WINDOW_ID_NONE
            ) {
              chrome.windows.remove(CURRENT_TOOL_POPUP_ID, () => {});
              CURRENT_TOOL_POPUP_ID = null;
            }
          } catch (_) {}
        });
        chrome.windows.onRemoved.addListener((winId) => {
          if (winId === CURRENT_TOOL_POPUP_ID) CURRENT_TOOL_POPUP_ID = null;
        });
        FOCUS_LISTENER_ATTACHED = true;
      } catch (_) {}
    }

    function openToolInCenteredWindow(tool, percent) {
      chrome.storage.local.get(
        {
          toolsPassword: "",
        },
        (cfg) => {
          const baseUrl = "https://scout-extension.vercel.app";
          const path = toolToPath(tool);
          let url = `${baseUrl}${path}${
            path.includes("?") ? "&" : "?"
          }pm_popup=1`;

          // Add password to all tool URLs if configured
          if (cfg?.toolsPassword) {
            try {
              const u = new URL(url);
              u.searchParams.set("password", cfg.toolsPassword);
              url = u.href;
            } catch (_) {
              url = `${url}${
                url.includes("?") ? "&" : "?"
              }password=${encodeURIComponent(cfg.toolsPassword)}`;
            }
          }
          try {
            chrome.system.display.getInfo((displays) => {
              // Use primary display workArea (excludes taskbars)
              const d = (displays && displays[0] && displays[0].workArea) || {
                left: 0,
                top: 0,
                width: 1280,
                height: 800,
              };
              const w = Math.max(500, Math.floor(d.width * (percent || 0.85)));
              const h = Math.max(400, Math.floor(d.height * (percent || 0.85)));
              const left = Math.max(0, d.left + Math.floor((d.width - w) / 2));
              const top = Math.max(0, d.top + Math.floor((d.height - h) / 2));
              chrome.windows.create(
                {
                  url,
                  type: "popup",
                  width: w,
                  height: h,
                  left,
                  top,
                  focused: true,
                },
                (win) => {
                  try {
                    CURRENT_TOOL_POPUP_ID = win?.id || null;
                    ensureAutoCloseListener();
                  } catch (_) {}
                }
              );
            });
          } catch (e) {
            log("openToolInCenteredWindow error", e?.message || e);
            chrome.windows.create(
              { url, type: "popup", focused: true },
              (win) => {
                try {
                  CURRENT_TOOL_POPUP_ID = win?.id || null;
                  ensureAutoCloseListener();
                } catch (_) {}
              }
            );
          }
        }
      );
    }

    function openToolNear(tool, anchor, percent) {
      chrome.storage.local.get(
        {
          toolsPassword: "",
        },
        (cfg) => {
          const baseUrl = "https://scout-extension.vercel.app";
          const path = toolToPath(tool);
          let url = `${baseUrl}${path}${
            path.includes("?") ? "&" : "?"
          }pm_window=1`;

          // Add password to all tool URLs if configured
          if (cfg?.toolsPassword) {
            try {
              const u = new URL(url);
              u.searchParams.set("password", cfg.toolsPassword);
              url = u.href;
            } catch (_) {
              url = `${url}${
                url.includes("?") ? "&" : "?"
              }password=${encodeURIComponent(cfg.toolsPassword)}`;
            }
          }
          const ax = Math.max(0, Number(anchor?.x || 0));
          const ay = Math.max(0, Number(anchor?.y || 0));
          try {
            chrome.system.display.getInfo((displays) => {
              const d = (displays && displays[0] && displays[0].workArea) || {
                left: 0,
                top: 0,
                width: 1280,
                height: 800,
              };
              const w = Math.max(420, Math.floor(d.width * (percent || 0.35)));
              const h = Math.max(360, Math.floor(d.height * (percent || 0.35)));
              const gap = 16;
              const openLeft = ax > d.left + d.width * 0.5; // anchor on right half
              let left = openLeft
                ? Math.floor(ax - w - gap)
                : Math.floor(ax + gap);
              let top = Math.floor(ay - Math.floor(h / 2));
              left = Math.min(Math.max(d.left, left), d.left + d.width - w);
              top = Math.min(Math.max(d.top, top), d.top + d.height - h);
              // Reuse existing popup window when possible
              const createWindow = () =>
                chrome.windows.create(
                  {
                    url,
                    type: "popup",
                    state: "normal",
                    width: w,
                    height: h,
                    left,
                    top,
                    focused: true,
                  },
                  (win) => {
                    CURRENT_TOOL_POPUP_ID = win?.id || null;
                    ensureAutoCloseListener();
                  }
                );
              if (CURRENT_TOOL_POPUP_ID) {
                try {
                  chrome.windows.update(
                    CURRENT_TOOL_POPUP_ID,
                    {
                      state: "normal",
                      width: w,
                      height: h,
                      left,
                      top,
                      focused: true,
                    },
                    (updated) => {
                      const err = chrome.runtime.lastError;
                      if (err || !updated) {
                        CURRENT_TOOL_POPUP_ID = null;
                        createWindow();
                      }
                    }
                  );
                } catch (_) {
                  CURRENT_TOOL_POPUP_ID = null;
                  createWindow();
                }
              } else {
                createWindow();
              }
            });
          } catch (e) {
            log("openToolNear error", e?.message || e);
            chrome.windows.create(
              { url, type: "popup", focused: true },
              (win) => {
                try {
                  CURRENT_TOOL_POPUP_ID = win?.id || null;
                  ensureAutoCloseListener();
                } catch (_) {}
              }
            );
          }
        }
      );
    }

    function resizeFocusedPopup(width, height) {
      try {
        chrome.windows.getCurrent((win) => {
          if (!win || win.type !== "popup") return;
          const update = {};
          if (width && Number.isFinite(width)) update.width = Math.floor(width);
          if (height && Number.isFinite(height))
            update.height = Math.floor(height);
          if (Object.keys(update).length) chrome.windows.update(win.id, update);
        });
      } catch (e) {
        log("resizeFocusedPopup error", e?.message || e);
      }
    }

    /**
     * Creates an offscreen document for gamepad detection
     * @returns {Promise<boolean>} Success status
     */
    async function createOffscreenDocument() {
      // Check if offscreen document already exists
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [chrome.runtime.getURL("offscreen.html")],
      });

      if (existingContexts.length > 0) {
        return true; // Already exists
      }

      try {
        await chrome.offscreen.createDocument({
          url: chrome.runtime.getURL("offscreen.html"),
          reasons: ["DOM_SCRAPING"],
          justification: "Gamepad detection requires access to Gamepad API",
        });
        log("Offscreen document created for gamepad detection");
        return true;
      } catch (error) {
        log("Failed to create offscreen document:", error);
        return false;
      }
    }

    /**
     * Starts monitoring for gamepad connections using offscreen document
     */
    async function startControllerDetection() {
      log("Starting improved controller detection");

      // Clear any existing interval
      if (CONTROLLER_CHECK_INTERVAL) {
        clearInterval(CONTROLLER_CHECK_INTERVAL);
      }

      // Create offscreen document for reliable gamepad detection
      const offscreenCreated = await createOffscreenDocument();
      if (!offscreenCreated) {
        log(
          "Failed to create offscreen document, controller detection may not work reliably"
        );
        // Fall back to the old method
        startFallbackControllerDetection();
        return;
      }

      // Initial check
      checkForControllersWithOffscreen();

      // Set up periodic checking
      CONTROLLER_CHECK_INTERVAL = setInterval(() => {
        checkForControllersWithOffscreen();
      }, 1000); // Check every second for better responsiveness
    }

    /**
     * Fallback controller detection method for when offscreen fails
     */
    function startFallbackControllerDetection() {
      log("Using fallback controller detection");

      // Set up periodic checking with the old method
      CONTROLLER_CHECK_INTERVAL = setInterval(() => {
        checkForControllersFallback();
      }, 2000);
    }

    /**
     * Checks for connected gamepads using offscreen document
     */
    async function checkForControllersWithOffscreen() {
      try {
        // Get the active tab
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tabs.length === 0) return;

        const activeTab = tabs[0];

        // Send message to offscreen document to check for gamepads
        const response = await chrome.runtime.sendMessage({
          action: "checkGamepads",
        });

        if (response && response.success) {
          const { connectedCount, controllerInfo } = response.data;

          // Check if a new controller was connected
          if (connectedCount > LAST_CONTROLLER_COUNT && connectedCount > 0) {
            log(`New controller detected: ${controllerInfo?.id || "Unknown"}`);
            LAST_CONTROLLER_COUNT = connectedCount;
            CONTROLLER_CONNECTED = true;

            // Controller detected but sidepanel auto-open is disabled
            log("Controller connected, but sidepanel auto-open is disabled");
          } else if (connectedCount === 0 && LAST_CONTROLLER_COUNT > 0) {
            log("All controllers disconnected");
            LAST_CONTROLLER_COUNT = 0;
            CONTROLLER_CONNECTED = false;
          }
        }
      } catch (error) {
        log("Error in checkForControllersWithOffscreen:", error);
        // Fall back to the old method
        if (CONTROLLER_CHECK_INTERVAL) {
          clearInterval(CONTROLLER_CHECK_INTERVAL);
          startFallbackControllerDetection();
        }
      }
    }

    /**
     * Fallback method to check for connected gamepads
     */
    function checkForControllersFallback() {
      try {
        // Get the active tab
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs.length === 0) return;

          const activeTab = tabs[0];

          // Inject a content script to check for gamepads
          chrome.scripting.executeScript(
            {
              target: { tabId: activeTab.id },
              func: () => {
                // This function runs in the content script context
                const gamepads = navigator.getGamepads?.() || [];
                let connectedCount = 0;
                let controllerInfo = null;

                for (let i = 0; i < gamepads.length; i++) {
                  if (gamepads[i]) {
                    connectedCount++;
                    if (!controllerInfo) {
                      controllerInfo = {
                        index: i,
                        id: gamepads[i].id,
                        mapping: gamepads[i].mapping,
                      };
                    }
                  }
                }

                return {
                  connectedCount,
                  controllerInfo,
                };
              },
            },
            (result) => {
              if (chrome.runtime.lastError) {
                log(
                  "Error checking for controllers:",
                  chrome.runtime.lastError
                );
                return;
              }

              if (result && result.length > 0) {
                const { connectedCount, controllerInfo } = result[0].result;

                // Check if a new controller was connected
                if (
                  connectedCount > LAST_CONTROLLER_COUNT &&
                  connectedCount > 0
                ) {
                  log(
                    `New controller detected: ${
                      controllerInfo?.id || "Unknown"
                    }`
                  );
                  LAST_CONTROLLER_COUNT = connectedCount;
                  CONTROLLER_CONNECTED = true;

                  // Controller detected but sidepanel auto-open is disabled
                  log(
                    "Controller connected, but sidepanel auto-open is disabled"
                  );
                } else if (connectedCount === 0 && LAST_CONTROLLER_COUNT > 0) {
                  log("All controllers disconnected");
                  LAST_CONTROLLER_COUNT = 0;
                  CONTROLLER_CONNECTED = false;
                }
              }
            }
          );
        });
      } catch (error) {
        log("Error in checkForControllersFallback:", error);
      }
    }

    /**
     * Stops the controller detection interval
     */
    function stopControllerDetection() {
      if (CONTROLLER_CHECK_INTERVAL) {
        clearInterval(CONTROLLER_CHECK_INTERVAL);
        CONTROLLER_CHECK_INTERVAL = null;
        log("Stopped controller detection");
      }
    }
  },
});
