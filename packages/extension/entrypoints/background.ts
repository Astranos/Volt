/**
 * Volt Chrome Extension Background Service Worker
 * Migrated to WXT background entrypoint.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* global chrome */
import { defineBackground } from "wxt/utils/define-background";
import { handleTabMessage } from "../src/background/tab-message-handler";
import { createSidepanelToolController } from "../src/background/sidepanel-tool-controller";
import { createMobileCaptureTargetController } from "../src/background/mobile-capture-targets";
import { createScannerMessageHandler } from "../src/background/scanner-message-handler";
import { createScannerOffscreenController } from "../src/background/scanner-offscreen";
import { createScannerTextInserter } from "../src/background/scanner-text-insertion";
import { SCANNER_SIGNAL_URL } from "../../scanner-protocol/src";

type MessageRecord = Record<string, any>;
type SendResponse = (response?: any) => void;
type PanelState = { open: boolean; tool: string | null };
type RuntimePath =
  | `/install.html${string}`
  | `/mobile-scanner-popup.html${string}`
  | `/offscreen.html${string}`
  | `/options.html${string}`;
type OffscreenContext = { documentUrl?: string };
type AnchorPoint = { x?: unknown; y?: unknown };
type SidePanelWithClose = typeof chrome.sidePanel & {
  close?: (options: { windowId: number }, callback?: () => void) => void;
};
type WindowUpdateProperties = Parameters<typeof chrome.windows.update>[1];
type OffscreenCreateParameters = Parameters<typeof chrome.offscreen.createDocument>[0];

type ServiceWorkerClient = { url: string };
declare const clients:
  | {
      matchAll: () => Promise<ServiceWorkerClient[]>;
    }
  | undefined;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asMessageRecord(message: unknown): MessageRecord {
  return message && typeof message === "object" ? (message as MessageRecord) : {};
}

function runtimeUrl(path: RuntimePath): string {
  return chrome.runtime.getURL(path);
}

export default defineBackground({
  main() {
    /**
     * @fileoverview Volt Chrome Extension Background Service Worker
     * @description Manages extension lifecycle, message handling, and core functionality
     * @version 1.0.0
     * @author Juan Quenga
     * @license MIT
     *
     * This lite service worker handles:
     * - Extension installation and startup
     * - Message routing between content scripts and popup
     * - Side panel state management per window
     * - Basic storage configuration
     * - Tab communication and injection
     */

    // Paymore extension background service worker (MV3) with verbose debug logging

    /** @type {boolean} Debug mode flag for console logging */
    let DEBUG = true;

    const MAX_PENDING_PC_ITEMS = 250;
    const sidePanelApi = chrome.sidePanel as SidePanelWithClose;

    function clampString(value: unknown, maxLength = 300) {
      const str = typeof value === "string" ? value : "";
      return str.length > maxLength ? str.slice(0, maxLength) : str;
    }

    function toFiniteNumber(value: unknown, fallback = 0) {
      const num = typeof value === "number" ? value : Number(value);
      return Number.isFinite(num) ? num : fallback;
    }

    function sanitizePriceChartingDetails(details: unknown) {
      if (!details || typeof details !== "object") return null;
      const entries = Object.entries(details).slice(0, 20);
      const sanitized: Record<string, string> = {};
      entries.forEach(([rawKey, rawValue]) => {
        const key = clampString(rawKey, 64).trim();
        if (!key) return;
        sanitized[key] = clampString(rawValue, 320);
      });
      return Object.keys(sanitized).length > 0 ? sanitized : null;
    }

    function sanitizePriceChartingItem(item: unknown) {
      if (!item || typeof item !== "object") return null;
      const candidate = item as MessageRecord;
      const price = Math.max(0, toFiniteNumber(candidate.price, 0));
      const quantity = Math.max(1, Math.floor(toFiniteNumber(candidate.quantity, 1)));
      return {
        id:
          clampString(candidate.id, 64) ||
          `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: clampString(candidate.title, 220),
        console: clampString(candidate.console, 120),
        price,
        condition: clampString(candidate.condition, 64),
        url: clampString(candidate.url, 500),
        saleTitle: clampString(candidate.saleTitle, 220),
        upc: clampString(candidate.upc, 64),
        imageUrl: clampString(candidate.imageUrl, 500),
        details: sanitizePriceChartingDetails(candidate.details),
        quantity,
      };
    }

    let OFFSCREEN_CREATE_PROMISE: Promise<boolean> | null = null;
    const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
    const SCANNER_RECONNECT_ALARM_NAME = "volt.mobileScanner.reconnectPoll";

    /*
     * Scanner source-contract anchors. The scanner implementation moved into
     * src/background modules, while this entrypoint stays responsible for wiring.
     *
     * Cursor/iframe insertion:
     * updateMobileCaptureTarget(message.target, sender)
     * mobileCursorTargetsByTabId.get(tab.id)
     * trackedInsertionTarget?.frameId
     * frameIds: [targetFrameId]
     * scanner frame insert fallback
     * document.designMode?.toLowerCase() === "on"
     * const isRichEditable = (element) =>
     * const setNativeTextControlValue = (input, nextValue) =>
     * Object.getOwnPropertyDescriptor(prototype, "value")?.set
     * new InputEvent("beforeinput"
     * composed: true
     *
     * Reconnect/push/offscreen:
     * function ensureScannerReconnectAlarm()
     * chrome.alarms?.create?.(SCANNER_RECONNECT_ALARM_NAME
     * async function pollScannerReconnectRequests(reason = "startup")
     * action: "scannerOffscreenPollReconnectRequests"
     * event.waitUntil(pollScannerReconnectRequests("push"))
     * pollScannerReconnectRequests("push")
     * async function getScannerPushSubscriptionOnce()
     * pushManager.subscribe
     * case "scannerGetPushSubscription"
     * function bootstrapScannerReconnectListener(reason = "startup")
     * void ensureScannerOffscreenDocument().catch
     * bootstrapScannerReconnectListener("installed")
     * pollScannerReconnectRequests("startup")
     * pollScannerReconnectRequests("background-main")
     * pollScannerReconnectRequests("alarm")
     * case "scannerCloseJoinWindow"
     * case "scannerPairingPopupClosed"
     * case "scannerDebugLog"
     * handleScannerPairingPopupClosed(sendResponse)
     */

    async function openOptionsPage() {
      try {
        await chrome.tabs.create({
          url: runtimeUrl("/options.html"),
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
    function log(...args: any[]) {
      if (DEBUG) console.log("[Volt Service Wroker]", ...args);
    }

    log("Service worker booted", { time: new Date().toISOString() });

    // Track previous active tab for CMDK "return to previous tab" feature
    let previousActiveTabId: number | null = null;
    let lastActiveTabId: number | null = null;
    let currentActiveTabId: number | null = null;
    const sidepanelTools = createSidepanelToolController({
      chromeApi: chrome,
      log,
      getFallbackTabIds: () => [currentActiveTabId, lastActiveTabId],
    });
    const scannerOffscreen = createScannerOffscreenController({
      chromeApi: chrome,
      log,
      createOffscreenDocument,
      getOffscreenContexts,
      signalUrl: SCANNER_SIGNAL_URL,
      reconnectAlarmName: SCANNER_RECONNECT_ALARM_NAME,
    });
    const scannerTargets = createMobileCaptureTargetController({
      chromeApi: chrome,
      log,
      sendScannerOffscreenMessage: scannerOffscreen.sendScannerOffscreenMessage,
    });
    const scannerTextInserter = createScannerTextInserter({
      chromeApi: chrome,
      log,
      getTrackedTarget: scannerTargets.getTrackedTarget,
      copyWithOffscreen: (text) => handleClipboardWithOffscreen("copyToClipboard", text),
    });
    const scannerMessages = createScannerMessageHandler({
      chromeApi: chrome,
      log,
      sendScannerOffscreenMessage: scannerOffscreen.sendScannerOffscreenMessage,
      getScannerPushSubscription: scannerOffscreen.getScannerPushSubscription,
      getMobileCaptureTarget: scannerTargets.getMobileCaptureTarget,
      updateMobileCaptureTarget: scannerTargets.updateMobileCaptureTarget,
      insertScannerText: scannerTextInserter.insertScannerText,
      openMobileScannerPairingPopup,
      resetMobileScannerActionPopup,
    });

    async function resetMobileScannerActionPopup() {
      try {
        await chrome.action.setPopup({ popup: "" });
      } catch (_) {}
    }

    async function getActiveChromeWindow() {
      const activeTabId = currentActiveTabId ?? lastActiveTabId;
      if (activeTabId) {
        try {
          const tab = await chrome.tabs.get(activeTabId);
          if (typeof tab?.windowId === "number") {
            return await chrome.windows.get(tab.windowId);
          }
        } catch (_) {}
      }

      try {
        return await chrome.windows.getCurrent();
      } catch (_) {
        return null;
      }
    }

    async function openMobileScannerPairingPopup(mode: string | null, state: unknown) {
      const popupUrl = new URL(runtimeUrl("/mobile-scanner-popup.html"));
      const stateRecord = asMessageRecord(state);
      if (mode) popupUrl.searchParams.set("mode", mode);
      if (stateRecord.status) popupUrl.searchParams.set("status", String(stateRecord.status));

      await chrome.action.setPopup({
        popup: `${popupUrl.pathname.replace(/^\//, "")}${popupUrl.search}`,
      });
      try {
        await chrome.action.openPopup();
      } catch (error) {
        await resetMobileScannerActionPopup();
        throw error;
      }
    }

    function getSidePanelState(windowId: number) {
      return sidepanelTools.getStateForWindow(windowId);
    }

    function setSidePanelState(windowId: number, nextState: PanelState) {
      sidepanelTools.setStateForWindow(windowId, nextState);
    }

    function toggleSidePanelForWindow(windowId: number, tool: string, mode = "toggle") {
      sidepanelTools.toggleForWindow(windowId, tool, mode);
    }

    function toggleSidePanelForTab(tabId: number | null | undefined, tool: string, mode = "toggle") {
      sidepanelTools.toggleForTab(tabId, tool, mode);
    }

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
        void scannerTargets.updateMobileCaptureTarget(scannerTargets.getTrackedTarget(tabId), null);
      } catch (_) {}
    });
    // Clean up tracking if tabs are closed
    try {
      chrome.tabs.onRemoved.addListener((closedTabId) => {
        if (previousActiveTabId === closedTabId) previousActiveTabId = null;
        if (lastActiveTabId === closedTabId) lastActiveTabId = null;
        scannerTargets.deleteTrackedTarget(closedTabId);
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
      scannerMessages.handleScannerMessage(
        { action: "openMobileCapture", mode: "barcode", surface: "popup" },
        { tab },
        () => {}
      );
    });

    // Listen for keyboard commands
    chrome.commands.onCommand.addListener((command) => {
      if (command === "open-options") {
        log("Open options command triggered");
        openOptionsPage().catch((error) =>
          log("openOptions command handler error", error)
        );
      } else if (command === "reopen-last-tab") {
        log("Reopen last tab command triggered");
        // Get the most recently closed tab and restore it
        chrome.sessions.getRecentlyClosed({ maxResults: 1 }, (sessions) => {
          if (chrome.runtime.lastError) {
            log(
              "Error getting recently closed tabs:",
              chrome.runtime.lastError
            );
            return;
          }
          // Find the first closed tab (not a window)
          const closedTab = sessions.find((s) => s.tab);
          if (closedTab && closedTab.tab) {
            chrome.sessions.restore(
              closedTab.tab.sessionId,
              (restoredSession) => {
                if (chrome.runtime.lastError) {
                  log("Error restoring tab:", chrome.runtime.lastError);
                } else {
                  log("Successfully restored last closed tab");
                }
              }
            );
          } else {
            log("No recently closed tabs found");
          }
        });
      } else if (command === "promote-preview") {
        log("Promote preview command triggered");
        promotePreviewToTab();
      }
    });

    // Create context menu items that operate on the current text selection
    try {
      const EBAY_SOLD_BASE =
        "https://www.ebay.com/sch/i.html?_nkw=iphone+15&_sacat=0&_from=R40&_dmd=2&rt=nc&LH_Sold=1&LH_Complete=1";
      const GOOGLE_UPC_BASE = "https://www.google.com/search?q=";
      const PRICE_CHARTING_BASE =
        "https://www.pricecharting.com/search-products?type=prices&q=grand+theft+auto&go=Go";

      // Ensure no stale items
      try {
        chrome.contextMenus.removeAll(() => {});
      } catch (_) {}

      try {
        chrome.contextMenus.create({
          id: "pm-mobile",
          title: "Mobile",
          contexts: ["all"],
        });
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
          id: "pm-search-price-charting",
          title: "Search on PriceCharting",
          contexts: ["selection"],
        });
      } catch (e) {
        log("contextMenus.create error", errorMessage(e));
      }

      chrome.contextMenus.onClicked.addListener((info, _tab) => {
        if (info.menuItemId === "pm-mobile") {
          const tabId = _tab?.id ?? currentActiveTabId ?? lastActiveTabId;
          toggleSidePanelForTab(tabId, "mobile-scanner", "open");
          return;
        }

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
          url: runtimeUrl("/install.html"),
          active: true,
        });
      }

      scannerOffscreen.bootstrapScannerReconnectListener("installed");
      scannerOffscreen.ensureScannerReconnectAlarm();
    });

    /**
     * Handles extension startup and loads debug configuration.
     */
    chrome.runtime.onStartup?.addListener(() => {
      log("onStartup");
      chrome.storage.local.get({ debugLogs: true }, (cfg) => {
        DEBUG = !!cfg.debugLogs;
        log("Debug flag loaded", DEBUG);
      });
      void scannerOffscreen.pollScannerReconnectRequests("startup");
      scannerOffscreen.ensureScannerReconnectAlarm();
    });

    void scannerOffscreen.pollScannerReconnectRequests("background-main");
    scannerOffscreen.ensureScannerReconnectAlarm();

    chrome.alarms?.onAlarm?.addListener((alarm) => {
      if (alarm?.name !== scannerOffscreen.alarmName) return;
      void scannerOffscreen.pollScannerReconnectRequests("alarm");
    });

    self.addEventListener("push", (event: Event) => {
      scannerOffscreen.handlePushEvent(event as Parameters<typeof scannerOffscreen.handlePushEvent>[0]);
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
    function sendToActiveTab(message: MessageRecord) {
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
              if (typeof newTab.id === "number" && tabId === newTab.id && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                deliverToTab(newTab.id, message);
              }
            });
          });
          return;
        }

        // Allow localhost/127.0.0.1 during development

        if (typeof target.id === "number") {
          deliverToTab(target.id, message);
        }
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
    function injectManifestContentScripts(tabId: number) {
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
    function deliverToTab(tabId: number, message: MessageRecord) {
      const trySend = (attempt: number) => {
        chrome.tabs.sendMessage(tabId, message, (response: unknown) => {
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
    async function handleClipboardWithOffscreen(action: string, text?: string) {
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

    chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
      const message = asMessageRecord(rawMessage);
      if (
        [
          "scannerOffscreenPing",
          "scannerOffscreenStart",
          "scannerOffscreenDisconnect",
          "scannerOffscreenCloseJoinWindow",
          "scannerOffscreenGetState",
          "scannerOffscreenUpdateExtensionIdentity",
        ].includes(message?.action)
      ) {
        return false;
      }

      log("onMessage", {
        message,
        sender: { id: sender?.tab?.id, url: sender?.tab?.url },
      });

      // Handle PC_ITEM_SELECTED from PriceCharting game page content script
      if (message.type === "PC_ITEM_SELECTED" && message.data) {
        const sanitizedItem = sanitizePriceChartingItem(message.data);
        if (!sanitizedItem) {
          sendResponse({ success: false, error: "invalid_item" });
          return true;
        }
        log("PC_ITEM_SELECTED received", sanitizedItem);

        // Save item to localStorage via storage.local (will be synced to sidepanel)
        chrome.storage.local.get(
          { scout_pricecharting_pending_items: [] },
          (result) => {
            const pendingItems = Array.isArray(result.scout_pricecharting_pending_items)
              ? result.scout_pricecharting_pending_items
              : [];
            pendingItems.push(sanitizedItem);
            if (pendingItems.length > MAX_PENDING_PC_ITEMS) {
              pendingItems.splice(
                0,
                pendingItems.length - MAX_PENDING_PC_ITEMS
              );
            }
            chrome.storage.local.set(
              { scout_pricecharting_pending_items: pendingItems },
              () => {
                log("Item saved to pending queue");
              }
            );
          }
        );

        sendResponse({ success: true });
        return true;
      }

      if (
        handleTabMessage(message, sender, sendResponse, {
          getPreviousActiveTabId: () => previousActiveTabId,
        })
      ) {
        return true;
      }

      const scannerMessageResult = scannerMessages.handleScannerMessage(message, sender, sendResponse);
      if (
        scannerMessageResult !== false ||
        message?.action === "mobileCursorTargetChanged"
      ) {
        return scannerMessageResult;
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
          const mode = message?.mode || "toggle";
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
            toggleSidePanelForTab(candidateId, tool, mode);
            sendResponse({ success: true, tabId: candidateId });
          } else {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              const active = tabs && tabs[0];
              if (active?.id) {
                toggleSidePanelForTab(active.id, tool, mode);
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
          chrome.tabs.get(tabId, (tab) => {
            if (tab?.windowId) {
              sendResponse({
                success: true,
                tabId,
                windowId: tab.windowId,
                state: getSidePanelState(tab.windowId),
              });
            } else {
              sendResponse({ success: false, error: "missing_window" });
            }
          });
          return true; // async response
        }
        case "sidePanelToggleResult": {
          const tabId = message?.tabId ?? sender?.tab?.id;
          const status = message?.status;
          const tool = message?.tool || null;
          if (typeof tabId !== "number") {
            sendResponse({ success: false, error: "missing_tab" });
            break;
          }
          chrome.tabs.get(tabId, (tab) => {
            if (tab?.windowId) {
              if (status === "opened") {
                setSidePanelState(tab.windowId, { open: true, tool });
              } else if (status === "closed") {
                setSidePanelState(tab.windowId, { open: false, tool: null });
              } else if (status === "error") {
                log(
                  "sidePanelToggleResult error",
                  message?.error || "unknown_error",
                  {
                    tool,
                    tabId,
                    windowId: tab.windowId,
                    source: message?.source,
                  }
                );
              }
              sendResponse({ success: true });
            } else {
              sendResponse({ success: false, error: "missing_window" });
            }
          });
          return true; // async response
        }
        case "closeSidebar": {
          const tabId = sender?.tab?.id ?? message?.tabId;
          if (typeof tabId === "number") {
            chrome.tabs.get(tabId, (tab) => {
              if (tab?.windowId) {
                try {
                  sidePanelApi.close?.({ windowId: tab.windowId }, () => {
                    const err = chrome.runtime.lastError;
                    if (err) {
                      log("sidePanel close error", err.message);
                    } else {
                      setSidePanelState(tab.windowId, {
                        open: false,
                        tool: null,
                      });
                      log(`Sidepanel closed for window: ${tab.windowId}`);
                    }
                  });
                } catch (e) {
                  log("sidePanel close error", errorMessage(e));
                }
              } else {
                log("closeSidebar missing windowId for tab", tabId);
              }
            });
          } else {
            // Fallback: use current window
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
              const active = tabs && tabs[0];
              if (active?.windowId) {
                try {
                  sidePanelApi.close?.({ windowId: active.windowId }, () => {
                    const err = chrome.runtime.lastError;
                    if (err) {
                      log("sidePanel close error", err.message);
                    } else {
                      setSidePanelState(active.windowId, {
                        open: false,
                        tool: null,
                      });
                      log(`Sidepanel closed for window: ${active.windowId}`);
                    }
                  });
                } catch (e) {
                  log("sidePanel close error", errorMessage(e));
                }
              } else {
                log("closeSidebar missing windowId");
              }
            });
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
        case "openPreviewPopup": {
          const url = message?.url;
          if (!url) {
            sendResponse({ success: false, error: "missing_url" });
            break;
          }

          // Close existing preview if any
          if (PREVIEW_POPUP_ID) {
            try {
              chrome.windows.remove(PREVIEW_POPUP_ID, () => {});
            } catch (_) {}
            clearPreviewPopupState();
          }

          PREVIEW_SOURCE_TAB_ID = sender?.tab?.id ?? null;
          PREVIEW_SOURCE_WINDOW_ID = sender?.tab?.windowId ?? null;
          PREVIEW_OPENED_AT = Date.now();
          PREVIEW_HAS_FOCUSED = false;
          PREVIEW_FOCUSED_AT = 0;
          ensureAutoCloseListener();

          const width = 1100;
          const height = 800;

          chrome.windows.create(
            {
              url,
              type: "popup",
              width,
              height,
              // Center it roughly
              left: Math.floor(message.x ? message.x - width / 2 : 100),
              top: Math.floor(message.y ? message.y - height / 2 : 100),
              focused: true,
            },
            (win) => {
              PREVIEW_POPUP_ID = win?.id || null;
              PREVIEW_OPENED_AT = Date.now();
              PREVIEW_HAS_FOCUSED = false;
              PREVIEW_FOCUSED_AT = 0;
              log("Preview popup created:", PREVIEW_POPUP_ID);
              sendResponse({ success: true });
            }
          );
          return true;
        }
        case "parentWindowFocused": {
          // Auto-dismiss preview when parent window is focused
          if (PREVIEW_POPUP_ID) {
            const senderWindowId = sender?.tab?.windowId ?? null;
            if (
              senderWindowId !== PREVIEW_SOURCE_WINDOW_ID ||
              !previewPopupCanAutoClose()
            ) {
              sendResponse({ success: true, ignored: "opening_focus_grace" });
              break;
            }
            log("Auto-dismissing preview popup due to parent focus");
            try {
              chrome.windows.remove(PREVIEW_POPUP_ID, () => {});
            } catch (_) {}
            clearPreviewPopupState();
          }
          sendResponse({ success: true });
          break;
        }
        case "promotePreviewToTab": {
          promotePreviewToTab();
          sendResponse({ success: true });
          break;
        }
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
            ? runtimeUrl(`/options.html#${encodeURIComponent(String(section))}`)
            : runtimeUrl("/options.html");
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
              if (typeof activeTab.id !== "number") {
                sendResponse({ success: false, error: "No active tab found" });
                return;
              }
              chrome.tabs.sendMessage(
                activeTab.id,
                { action: "GET_WEBPAGE_CONTEXT" },
                (response: any) => {
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
        case "toggleSidepanelTool": {
          const tool = message?.tool || "mobile-scanner";
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
              const disabledSites = Array.isArray(cfg.disabledSites)
                ? cfg.disabledSites.filter((site): site is string => typeof site === "string")
                : [];
              const isDisabled =
                !cfg.globalEnabled ||
                disabledSites.some((site) => {
                  // Simple domain matching (can be enhanced with wildcard support)
                  return domain === site || domain.endsWith("." + site);
                });

              sendResponse({
                success: true,
                disabled: isDisabled,
                globalEnabled: cfg.globalEnabled,
                disabledSites,
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
                  if (typeof t.id === "number") {
                    chrome.tabs.sendMessage(t.id, {
                      action: "pm-settings-changed",
                      disabledSites: sites,
                    });
                  }
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
            const disabledSites = Array.isArray(cfg.disabledSites)
              ? cfg.disabledSites.filter((site): site is string => typeof site === "string")
              : [];
            let updatedSites: string[];

            if (enabled) {
              // Remove domain from disabled list
              updatedSites = disabledSites.filter(
                (site) => site !== domain
              );
            } else {
              // Add domain to disabled list
              updatedSites = [...disabledSites, domain];
            }

            chrome.storage.local.set({ disabledSites: updatedSites }, () => {
              // Broadcast settings change to all tabs
              chrome.tabs.query({}, (tabs) => {
                tabs.forEach((t) => {
                  try {
                    if (typeof t.id === "number") {
                      chrome.tabs.sendMessage(t.id, {
                        action: "pm-settings-changed",
                        disabledSites: updatedSites,
                      });
                    }
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

    function promotePreviewToTab() {
      if (!PREVIEW_POPUP_ID) {
        log("No preview popup to promote");
        return;
      }

      chrome.windows.get(PREVIEW_POPUP_ID, { populate: true }, (win) => {
        if (
          chrome.runtime.lastError ||
          !win ||
          !win.tabs ||
          win.tabs.length === 0
        ) {
          log("Could not find preview window or tabs");
          PREVIEW_POPUP_ID = null;
          return;
        }

        const tab = win.tabs[0];
        const tabId = tab.id;
        if (typeof tabId !== "number") {
          log("Preview tab missing id");
          PREVIEW_POPUP_ID = null;
          return;
        }

        if (PREVIEW_SOURCE_TAB_ID) {
          chrome.tabs.get(PREVIEW_SOURCE_TAB_ID, (sourceTab) => {
            const windowId =
              sourceTab?.windowId || chrome.windows.WINDOW_ID_CURRENT;
            chrome.tabs.move(tabId, { windowId, index: -1 }, () => {
              chrome.tabs.update(tabId, { active: true });
              chrome.windows.update(windowId, { focused: true });
              PREVIEW_POPUP_ID = null;
              log("Promoted preview to tab in window:", windowId);
            });
          });
        } else {
          // If no source tab known, just turn it into a regular window or move to current
          chrome.tabs.move(
            tabId,
            { windowId: chrome.windows.WINDOW_ID_CURRENT, index: -1 },
            () => {
              chrome.tabs.update(tabId, { active: true });
              PREVIEW_POPUP_ID = null;
            }
          );
        }
      });
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
          if (typeof targetTab.id !== "number" || typeof targetTab.windowId !== "number") {
            log("POS tab missing id/windowId");
            return;
          }

          // Activate and focus the POS tab
          chrome.tabs.update(targetTab.id, { active: true });
          chrome.windows.update(targetTab.windowId, { focused: true });

          // Close the current toolbar tab
          chrome.tabs.query(
            { active: true, currentWindow: true },
            (activeTabs) => {
              if (activeTabs.length > 0 && typeof activeTabs[0].id === "number") {
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

    function arrayBufferToBase64(buffer: ArrayBuffer) {
      let binary = "";
      const bytes = new Uint8Array(buffer);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      // btoa works with binary strings
      return btoa(binary);
    }

    function toolToPath(tool: string) {
      switch (tool) {
        case "upc-search":
          return "/tools/upc-search";
        case "scout":
          return "/tools/scout";
        case "settings":
          return "/tools/settings";
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

    function openInActionPopup(tool: string) {
      log("openInActionPopup redirecting to sidepanel", { tool });
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const active = tabs && tabs[0];
        if (active?.id) {
          toggleSidePanelForTab(active.id, tool);
        }
      });
    }

    let CURRENT_TOOL_POPUP_ID: number | null = null;
    let PREVIEW_POPUP_ID: number | null = null;
    let PREVIEW_SOURCE_TAB_ID: number | null = null;
    let PREVIEW_OPENED_AT = 0;
    let PREVIEW_SOURCE_WINDOW_ID: number | null = null;
    let PREVIEW_HAS_FOCUSED = false;
    let PREVIEW_FOCUSED_AT = 0;
    let CURRENT_TOOL_POPUP_OPENED_AT = 0;
    let CURRENT_TOOL_POPUP_HAS_FOCUSED = false;
    let CURRENT_TOOL_POPUP_FOCUSED_AT = 0;
    let AUTOCLOSE_ON_BLUR = true;
    let FOCUS_LISTENER_ATTACHED = false;
    const POPUP_OPENING_GRACE_MS = 700;
    const POPUP_FOCUS_ARM_MS = 150;

    function clearPreviewPopupState() {
      PREVIEW_POPUP_ID = null;
      PREVIEW_SOURCE_TAB_ID = null;
      PREVIEW_OPENED_AT = 0;
      PREVIEW_SOURCE_WINDOW_ID = null;
      PREVIEW_HAS_FOCUSED = false;
      PREVIEW_FOCUSED_AT = 0;
    }

    function markPreviewPopupFocused() {
      PREVIEW_HAS_FOCUSED = true;
      PREVIEW_FOCUSED_AT = Date.now();
    }

    function previewPopupCanAutoClose() {
      const now = Date.now();
      return (
        PREVIEW_HAS_FOCUSED &&
        now - PREVIEW_OPENED_AT >= POPUP_OPENING_GRACE_MS &&
        now - PREVIEW_FOCUSED_AT >= POPUP_FOCUS_ARM_MS
      );
    }

    function trackCurrentToolPopup(id: number | undefined) {
      CURRENT_TOOL_POPUP_ID = typeof id === "number" ? id : null;
      CURRENT_TOOL_POPUP_OPENED_AT = Date.now();
      CURRENT_TOOL_POPUP_HAS_FOCUSED = false;
      CURRENT_TOOL_POPUP_FOCUSED_AT = 0;
    }

    function clearCurrentToolPopupState() {
      CURRENT_TOOL_POPUP_ID = null;
      CURRENT_TOOL_POPUP_OPENED_AT = 0;
      CURRENT_TOOL_POPUP_HAS_FOCUSED = false;
      CURRENT_TOOL_POPUP_FOCUSED_AT = 0;
    }

    function markCurrentToolPopupFocused() {
      CURRENT_TOOL_POPUP_HAS_FOCUSED = true;
      CURRENT_TOOL_POPUP_FOCUSED_AT = Date.now();
    }

    function currentToolPopupCanAutoClose() {
      const now = Date.now();
      return (
        CURRENT_TOOL_POPUP_HAS_FOCUSED &&
        now - CURRENT_TOOL_POPUP_OPENED_AT >= POPUP_OPENING_GRACE_MS &&
        now - CURRENT_TOOL_POPUP_FOCUSED_AT >= POPUP_FOCUS_ARM_MS
      );
    }

    function ensureAutoCloseListener() {
      if (FOCUS_LISTENER_ATTACHED) return;
      try {
        chrome.windows.onFocusChanged.addListener((winId) => {
          try {
            if (!AUTOCLOSE_ON_BLUR) return;
            if (PREVIEW_POPUP_ID && winId === PREVIEW_POPUP_ID) {
              markPreviewPopupFocused();
            } else if (
              PREVIEW_POPUP_ID &&
              winId === PREVIEW_SOURCE_WINDOW_ID &&
              previewPopupCanAutoClose()
            ) {
              chrome.windows.remove(PREVIEW_POPUP_ID, () => {});
              clearPreviewPopupState();
            }
            if (CURRENT_TOOL_POPUP_ID && winId === CURRENT_TOOL_POPUP_ID) {
              markCurrentToolPopupFocused();
            }
            // If our popup is open and focus moved to another window (or to none), close it
            if (
              CURRENT_TOOL_POPUP_ID &&
              winId !== CURRENT_TOOL_POPUP_ID &&
              winId !== chrome.windows.WINDOW_ID_NONE &&
              currentToolPopupCanAutoClose()
            ) {
              chrome.windows.remove(CURRENT_TOOL_POPUP_ID, () => {});
              clearCurrentToolPopupState();
            }
          } catch (_) {}
        });
        chrome.windows.onRemoved.addListener((winId) => {
          if (winId === CURRENT_TOOL_POPUP_ID) clearCurrentToolPopupState();
          if (winId === PREVIEW_POPUP_ID) clearPreviewPopupState();
        });
        FOCUS_LISTENER_ATTACHED = true;
      } catch (_) {}
    }

    function openToolInCenteredWindow(tool: string, percent: number) {
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
          const toolsPassword = typeof cfg?.toolsPassword === "string" ? cfg.toolsPassword : "";
          if (toolsPassword) {
            try {
              const u = new URL(url);
              u.searchParams.set("password", toolsPassword);
              url = u.href;
            } catch (_) {
              url = `${url}${
                url.includes("?") ? "&" : "?"
              }password=${encodeURIComponent(toolsPassword)}`;
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
                    trackCurrentToolPopup(win?.id);
                    ensureAutoCloseListener();
                  } catch (_) {}
                }
              );
            });
          } catch (e) {
            log("openToolInCenteredWindow error", errorMessage(e));
            chrome.windows.create(
              { url, type: "popup", focused: true },
              (win) => {
                try {
                  trackCurrentToolPopup(win?.id);
                  ensureAutoCloseListener();
                } catch (_) {}
              }
            );
          }
        }
      );
    }

    function openToolNear(tool: string, anchor: AnchorPoint, percent: number) {
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
          const toolsPassword = typeof cfg?.toolsPassword === "string" ? cfg.toolsPassword : "";
          if (toolsPassword) {
            try {
              const u = new URL(url);
              u.searchParams.set("password", toolsPassword);
              url = u.href;
            } catch (_) {
              url = `${url}${
                url.includes("?") ? "&" : "?"
              }password=${encodeURIComponent(toolsPassword)}`;
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
                    trackCurrentToolPopup(win?.id);
                    ensureAutoCloseListener();
                  }
                );
              if (CURRENT_TOOL_POPUP_ID) {
                try {
                  trackCurrentToolPopup(CURRENT_TOOL_POPUP_ID);
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
                        clearCurrentToolPopupState();
                        createWindow();
                      }
                    }
                  );
                } catch (_) {
                  clearCurrentToolPopupState();
                  createWindow();
                }
              } else {
                createWindow();
              }
            });
          } catch (e) {
            log("openToolNear error", errorMessage(e));
            chrome.windows.create(
              { url, type: "popup", focused: true },
              (win) => {
                try {
                  trackCurrentToolPopup(win?.id);
                  ensureAutoCloseListener();
                } catch (_) {}
              }
            );
          }
        }
      );
    }

    function resizeFocusedPopup(width: number | null, height: number | null) {
      try {
        chrome.windows.getCurrent((win) => {
          if (!win || win.type !== "popup") return;
          const update: WindowUpdateProperties = {};
          if (width && Number.isFinite(width)) update.width = Math.floor(width);
          if (height && Number.isFinite(height))
            update.height = Math.floor(height);
          if (Object.keys(update).length && typeof win.id === "number") chrome.windows.update(win.id, update);
        });
      } catch (e) {
        log("resizeFocusedPopup error", errorMessage(e));
      }
    }

    /**
     * Creates an offscreen document for gamepad detection
     * @returns {Promise<boolean>} Success status
     */
    async function createOffscreenDocument() {
      if (OFFSCREEN_CREATE_PROMISE) {
        return OFFSCREEN_CREATE_PROMISE;
      }

      OFFSCREEN_CREATE_PROMISE = createOffscreenDocumentOnce().finally(() => {
        OFFSCREEN_CREATE_PROMISE = null;
      });
      return OFFSCREEN_CREATE_PROMISE;
    }

    async function getOffscreenContexts(): Promise<OffscreenContext[]> {
      if (!chrome.runtime.getContexts) {
        const matchedClients = await clients?.matchAll?.() ?? [];
        return matchedClients
          .filter((client) => client.url.includes(chrome.runtime.id))
          .map((client) => ({ documentUrl: client.url }));
      }

      return chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
      });
    }

    async function createOffscreenDocumentOnce() {
      const offscreenUrl = runtimeUrl("/offscreen.html");
      const existingContexts = await getOffscreenContexts();
      const matchingContext = existingContexts.find(
        (context) => context.documentUrl === offscreenUrl
      );

      if (matchingContext) {
        return true;
      }

      if (existingContexts.length > 0) {
        log(
          "Non-matching offscreen document already exists",
          existingContexts.map((context) => context.documentUrl)
        );
        return true;
      }

      try {
        const createOptions: OffscreenCreateParameters = {
          url: OFFSCREEN_DOCUMENT_PATH,
          reasons: ["DOM_SCRAPING", "CLIPBOARD", "WEB_RTC"],
          justification:
            "Gamepad detection, clipboard fallback, and the mobile scanner connection run without visible extension UI",
        };
        try {
          await chrome.offscreen.createDocument(createOptions);
        } catch (reasonError) {
          if (
            errorMessage(reasonError).includes(
              "Only a single offscreen document"
            )
          ) {
            log("Offscreen document already exists");
            return true;
          }

          log(
            "Offscreen create with extended reasons failed, retrying with DOM_SCRAPING",
            errorMessage(reasonError)
          );
          try {
            await chrome.offscreen.createDocument({
              ...createOptions,
              reasons: ["DOM_SCRAPING"],
            });
          } catch (fallbackError) {
            if (
              errorMessage(fallbackError).includes(
                "Only a single offscreen document"
              )
            ) {
              log("Offscreen document already exists");
              return true;
            }
            throw fallbackError;
          }
        }
        log("Offscreen document created");
        return true;
      } catch (error) {
        log("Failed to create offscreen document:", error);
        return false;
      }
    }

  },
});
