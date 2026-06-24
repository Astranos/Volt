/**
 * Volt Chrome Extension Background Service Worker
 * Migrated to WXT background entrypoint.
 */
/* global chrome */
import { defineBackground } from "wxt/utils/define-background";
import { createActiveTabTracker } from "../src/background/active-tab-tracker";
import { createClipboardController } from "../src/background/clipboard-controller";
import { createContextMenuController } from "../src/background/context-menu-controller";
import { registerDisabledSiteActions } from "../src/background/disabled-site-controller";
import { createMobileCaptureTargetController } from "../src/background/mobile-capture-targets";
import { registerNavigationActions } from "../src/background/navigation-controller";
import { createOffscreenDocumentController } from "../src/background/offscreen-document-controller";
import { createPreviewPopupController } from "../src/background/preview-popup-controller";
import { createPriceChartingController } from "../src/background/price-charting-controller";
import {
  createRuntimeActionRegistry,
  type LogFn,
} from "../src/background/runtime-action-registry";
import { createScannerMessageHandler } from "../src/background/scanner-message-handler";
import { createScannerOffscreenController } from "../src/background/scanner-offscreen";
import { createScannerTextInserter } from "../src/background/scanner-text-insertion";
import { registerSidepanelMessageActions } from "../src/background/sidepanel-message-controller";
import { createSidepanelToolController } from "../src/background/sidepanel-tool-controller";
import { createTabDeliveryController } from "../src/background/tab-delivery";
import { createToolPopupController } from "../src/background/tool-popup-controller";
import { registerUtilityActions } from "../src/background/utility-action-controller";
import { handleTabMessage } from "../src/background/tab-message-handler";
import { installEditableTracker } from "../src/components/sidepanel/mobile-scanner-page-bridge";
import {
  getMessageAction,
  isScannerOffscreenRuntimeMessage,
  parseMessageRecord,
  parseRuntimeMessage,
  type RuntimeMessageSender,
  type RuntimeSendResponse,
} from "../src/background/messages";
import { EXTENSION_SCANNER_SIGNAL_URL } from "../src/domain/mobile-scanner-signal-url";

type RuntimePath =
  | `/mobile-scanner-popup.html${string}`
  | `/newtab.html${string}`
  | `/offscreen.html${string}`
  | `/options.html${string}`;

const SCANNER_RECONNECT_ALARM_NAME = "volt.mobileScanner.reconnectPoll";
const MOBILE_SCANNER_POPUP_PATH = "mobile-scanner-popup.html";

function asMessageRecord(message: unknown) {
  return parseMessageRecord(message) ?? {};
}

function runtimeUrl(path: RuntimePath): string {
  return chrome.runtime.getURL(path);
}

export default defineBackground({
  main() {
    let DEBUG = true;
    const log: LogFn = (...args) => {
      if (DEBUG) console.log("[Volt Service Wroker]", ...args);
    };

    log("Service worker booted", { time: new Date().toISOString() });

    const registry = createRuntimeActionRegistry();
    const activeTabs = createActiveTabTracker({
      chromeApi: chrome,
      onActivated: (tabId) => {
        void scannerTargets.updateMobileCaptureTarget(
          scannerTargets.getTrackedTarget(tabId),
          null
        );
      },
      onRemoved: (tabId) => scannerTargets.deleteTrackedTarget(tabId),
    });
    const sidepanelTools = createSidepanelToolController({
      chromeApi: chrome,
      log,
      getFallbackTabIds: activeTabs.getFallbackTabIds,
    });
    const offscreenDocument = createOffscreenDocumentController({
      chromeApi: chrome,
      log,
      runtimeUrl,
    });
    const scannerOffscreen = createScannerOffscreenController({
      chromeApi: chrome,
      log,
      createOffscreenDocument: offscreenDocument.createOffscreenDocument,
      getOffscreenContexts: offscreenDocument.getOffscreenContexts,
      signalUrl: EXTENSION_SCANNER_SIGNAL_URL,
      reconnectAlarmName: SCANNER_RECONNECT_ALARM_NAME,
    });
    const scannerTargets = createMobileCaptureTargetController({
      chromeApi: chrome,
      log,
      sendScannerOffscreenMessage: scannerOffscreen.sendScannerOffscreenMessage,
    });
    const clipboard = createClipboardController({
      chromeApi: chrome,
      createOffscreenDocument: offscreenDocument.createOffscreenDocument,
      log,
    });
    const scannerTextInserter = createScannerTextInserter({
      chromeApi: chrome,
      log,
      getTrackedTarget: scannerTargets.getTrackedTarget,
      copyWithOffscreen: (text) =>
        clipboard.handleClipboardWithOffscreen("copyToClipboard", text),
    });
    const tabDelivery = createTabDeliveryController({ chromeApi: chrome, log });
    const previewPopups = createPreviewPopupController({ chromeApi: chrome, log });
    const toolPopups = createToolPopupController({
      chromeApi: chrome,
      log,
      toggleSidePanelForTab: sidepanelTools.toggleForTab,
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
    const priceCharting = createPriceChartingController({ chromeApi: chrome, log });

    async function resetMobileScannerActionPopup() {
      try {
        await chrome.action.setPopup({ popup: MOBILE_SCANNER_POPUP_PATH });
      } catch (_) {}
    }

    async function openMobileScannerPairingPopup(mode: string | null, state: unknown) {
      const popupUrl = new URL(runtimeUrl("/mobile-scanner-popup.html"));
      const stateRecord = asMessageRecord(state);
      if (mode) popupUrl.searchParams.set("mode", mode);
      if (stateRecord.status) {
        popupUrl.searchParams.set("status", String(stateRecord.status));
      }

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

    async function primeActiveTabCursorTarget(tab?: { id?: number } | null) {
      const targetTab =
        typeof tab?.id === "number"
          ? tab
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (typeof targetTab?.id !== "number") return null;

      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: targetTab.id, allFrames: true },
          func: installEditableTracker,
        });
        const match = results.find((result) => result.result);
        if (!match?.result) return null;
        const sender = {
          tab: { id: targetTab.id },
          frameId: match.frameId,
        } as Parameters<typeof scannerTargets.updateMobileCaptureTarget>[1];
        await scannerTargets.updateMobileCaptureTarget(match.result, sender);
        return match.result;
      } catch (error) {
        log("Failed to prime mobile cursor target", error instanceof Error ? error.message : error);
        return null;
      }
    }

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

    activeTabs.initialize();
    disableActionClickSidepanel();
    void resetMobileScannerActionPopup();
    registerActions();
    registerListeners();

    function disableActionClickSidepanel() {
      try {
        chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
      } catch (error) {
        log("Failed to disable side panel action click behavior:", error);
      }
    }

    function registerActions() {
      registerSidepanelMessageActions({
        chromeApi: chrome,
        getCurrentTabId: activeTabs.getCurrentActiveTabId,
        getLastTabId: activeTabs.getLastActiveTabId,
        getSidePanelState: sidepanelTools.getStateForWindow,
        log,
        registry,
        setSidePanelState: sidepanelTools.setStateForWindow,
        toggleSidePanelForTab: sidepanelTools.toggleForTab,
      });
      toolPopups.registerActions(registry);
      previewPopups.registerActions(registry);
      clipboard.registerActions(registry);
      registerNavigationActions({
        chromeApi: chrome,
        log,
        registry,
        sendToActiveTab: tabDelivery.sendToActiveTab,
      });
      registerUtilityActions({
        chromeApi: chrome,
        getDebug: () => DEBUG,
        log,
        openOptionsPage,
        registry,
        runtimeUrl,
        setDebug: (nextDebug) => {
          DEBUG = nextDebug;
        },
      });
      registerDisabledSiteActions({ chromeApi: chrome, registry });
    }

    function registerListeners() {
      createContextMenuController({
        chromeApi: chrome,
        getFallbackTabId: () =>
          activeTabs.getCurrentActiveTabId() ?? activeTabs.getLastActiveTabId(),
        log,
        toggleSidePanelForTab: sidepanelTools.toggleForTab,
      }).register();

      chrome.action.onClicked.addListener((tab) => {
        void primeActiveTabCursorTarget(tab).then((target) => {
          scannerMessages.handleScannerMessage(
            { action: "openMobileCapture", surface: "popup", target },
            { tab },
            () => {}
          );
        });
      });

      chrome.commands.onCommand.addListener((command) => {
        if (command === "open-options") {
          log("Open options command triggered");
          openOptionsPage().catch((error) =>
            log("openOptions command handler error", error)
          );
        } else if (command === "reopen-last-tab") {
          log("Reopen last tab command triggered");
          chrome.sessions.getRecentlyClosed({ maxResults: 1 }, (sessions) => {
            if (chrome.runtime.lastError) {
              log("Error getting recently closed tabs:", chrome.runtime.lastError);
              return;
            }
            const closedTab = sessions.find((session) => session.tab);
            if (closedTab?.tab) {
              chrome.sessions.restore(closedTab.tab.sessionId, () => {
                if (chrome.runtime.lastError) {
                  log("Error restoring tab:", chrome.runtime.lastError);
                } else {
                  log("Successfully restored last closed tab");
                }
              });
            } else {
              log("No recently closed tabs found");
            }
          });
        } else if (command === "promote-preview") {
          log("Promote preview command triggered");
          previewPopups.promotePreviewToTab();
        }
      });

      chrome.runtime.onInstalled.addListener((details) => {
        log("onInstalled", details);
        chrome.storage.local.set({
          isEnabled: true,
          autoShowModal: true,
          vibrationEnabled: true,
          debugLogs: true,
        });

        disableActionClickSidepanel();

        if (details.reason === "install") {
          log("First installation detected, opening Volt new tab");
          chrome.tabs.create({
            url: runtimeUrl("/newtab.html"),
            active: true,
          });
        }

        scannerOffscreen.bootstrapScannerReconnectListener("installed");
        scannerOffscreen.ensureScannerReconnectAlarm();
      });

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
        scannerOffscreen.handlePushEvent(
          event as Parameters<typeof scannerOffscreen.handlePushEvent>[0]
        );
      });

      chrome.runtime.onSuspend?.addListener(() => {
        log("Extension suspended, cleaning up resources");
      });

      chrome.runtime.onMessage.addListener(handleRuntimeMessage);
    }

    function handleRuntimeMessage(
      rawMessage: unknown,
      sender: RuntimeMessageSender,
      sendResponse: RuntimeSendResponse
    ) {
      const message = parseRuntimeMessage(rawMessage);

      if (message && isScannerOffscreenRuntimeMessage(message)) {
        return false;
      }

      if (message && "type" in message && message.type === "EXTENSION_HEALTH_CHECK") {
        log("Extension health check received from tab:", sender.tab?.id);
        sendResponse({ status: "healthy", timestamp: Date.now() });
        return true;
      }

      if (message && "type" in message && message.type === "CONTENT_SCRIPT_READY") {
        log("Content script ready notification from tab:", sender.tab?.id);
        sendResponse({ status: "acknowledged" });
        return true;
      }

      log("onMessage", {
        message: message ?? rawMessage,
        sender: { id: sender?.tab?.id, url: sender?.tab?.url },
      });

      if (!message) {
        log("Unknown action", getMessageAction(rawMessage));
        sendResponse({ ok: false, error: "unknown_action" });
        return true;
      }

      if (priceCharting.handleMessage(message, sendResponse)) return true;
      if (!("action" in message)) return false;

      if (
        handleTabMessage(message, sender, sendResponse, {
          getPreviousActiveTabId: activeTabs.getPreviousActiveTabId,
        })
      ) {
        return true;
      }

      const scannerMessageResult = scannerMessages.handleScannerMessage(
        message,
        sender,
        sendResponse
      );
      if (
        scannerMessageResult !== false ||
        ("action" in message && message.action === "mobileCursorTargetChanged")
      ) {
        return scannerMessageResult;
      }

      if (registry.handle(message, sender, sendResponse)) return true;

      log("Unknown action", "action" in message ? message.action : null);
      sendResponse({ ok: false, error: "unknown_action" });
      return true;
    }
  },
});
