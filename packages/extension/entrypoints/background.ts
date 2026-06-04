/**
 * Volt Chrome Extension Background Service Worker
 * Migrated to WXT background entrypoint.
 */
// @ts-nocheck
/* eslint-disable @typescript-eslint/no-explicit-any */
/* global chrome */
import { defineBackground } from "wxt/utils/define-background";
import { handleTabMessage } from "../src/background/tab-message-handler";
import { createSidepanelToolController } from "../src/background/sidepanel-tool-controller";
import {
  buildMobilePhotoDownloadFilename,
  normalizeMobilePhoto,
} from "../src/domain/mobile-photo";
import {
  saveMobileScannerPhoto,
  saveMobileScannerScan,
  shouldPersistScannerScan,
} from "../src/domain/mobile-scanner-results";
import { shouldInsertScannerMessage } from "../src/domain/scanner-message";

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
     * - Side panel state management per window for controller testing
     * - Basic storage configuration
     * - Tab communication and injection
     * - Controller detection and testing
     */

    // Paymore extension background service worker (MV3) with verbose debug logging

    /** @type {boolean} Debug mode flag for console logging */
    let DEBUG = true;

    const MAX_PENDING_PC_ITEMS = 250;

    function clampString(value, maxLength = 300) {
      const str = typeof value === "string" ? value : "";
      return str.length > maxLength ? str.slice(0, maxLength) : str;
    }

    function toFiniteNumber(value, fallback = 0) {
      const num = typeof value === "number" ? value : Number(value);
      return Number.isFinite(num) ? num : fallback;
    }

    function sanitizePriceChartingDetails(details) {
      if (!details || typeof details !== "object") return null;
      const entries = Object.entries(details).slice(0, 20);
      const sanitized = {};
      entries.forEach(([rawKey, rawValue]) => {
        const key = clampString(rawKey, 64).trim();
        if (!key) return;
        sanitized[key] = clampString(rawValue, 320);
      });
      return Object.keys(sanitized).length > 0 ? sanitized : null;
    }

    function sanitizePriceChartingItem(item) {
      if (!item || typeof item !== "object") return null;
      const price = Math.max(0, toFiniteNumber(item.price, 0));
      const quantity = Math.max(1, Math.floor(toFiniteNumber(item.quantity, 1)));
      return {
        id:
          clampString(item.id, 64) ||
          `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: clampString(item.title, 220),
        console: clampString(item.console, 120),
        price,
        condition: clampString(item.condition, 64),
        url: clampString(item.url, 500),
        saleTitle: clampString(item.saleTitle, 220),
        upc: clampString(item.upc, 64),
        imageUrl: clampString(item.imageUrl, 500),
        details: sanitizePriceChartingDetails(item.details),
        quantity,
      };
    }


    // Track controller connection state
    let CONTROLLER_CONNECTED = false;
    let CONTROLLER_CHECK_INTERVAL = null;
    let LAST_CONTROLLER_COUNT = 0;
    let OFFSCREEN_CREATE_PROMISE = null;

    const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
    const STORAGE_STATS_KEY = "grokStorageStats";
    const MOBILE_SCANNER_STORAGE_KEY = "volt.mobileScanner.scans";
    const MOBILE_PHOTOS_STORAGE_KEY = "volt.mobilePhotos.photos";
    const MOBILE_RELAY_STATE_STORAGE_KEY = "volt.mobileScanner.relaySession.v1";
    const MOBILE_SCANNER_MAX_SCANS = 100;
    const MOBILE_PHOTOS_MAX_PHOTOS = 80;
    const MOBILE_PHOTOS_MAX_PERSISTED_BYTES = 6_000_000;
    const MOBILE_CAPTURE_MODES = new Set(["ocr", "barcode", "dictation", "photo"]);
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

    function normalizeMobileCaptureMode(mode) {
      return MOBILE_CAPTURE_MODES.has(mode) ? mode : null;
    }

    function normalizeScannerMessage(message) {
      if (!message || typeof message.barcode !== "string" || !message.barcode) {
        return null;
      }

      return {
        ...message,
        dictationPhase:
          message.dictationPhase === "partial" || message.dictationPhase === "final"
            ? message.dictationPhase
            : undefined,
        dictationSessionId:
          typeof message.dictationSessionId === "string"
            ? message.dictationSessionId
            : undefined,
        id:
          typeof message.id === "string" && message.id
            ? message.id
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: message.kind === "text" ? "text" : "barcode",
        scannedAt:
          typeof message.scannedAt === "string"
            ? message.scannedAt
            : new Date().toISOString(),
      };
    }

    function downloadMobilePhoto(photo) {
      return new Promise((resolve) => {
        const filename = buildMobilePhotoDownloadFilename(photo);
        const url = photo.dataUrl || photo.downloadUrl;
        if (!url) {
          resolve({ success: false, error: "missing_download_url" });
          return;
        }
        chrome.downloads.download(
          {
            url,
            filename,
            conflictAction: "uniquify",
            saveAs: false,
          },
          (downloadId) => {
            if (chrome.runtime.lastError || typeof downloadId !== "number") {
              resolve({
                success: false,
                error: chrome.runtime.lastError?.message || "download_failed",
              });
              return;
            }

            resolve({ success: true, downloadId, filename });
          }
        );
      });
    }

    function stripMobilePhotoData(photo) {
      const { dataUrl, ...metadata } = photo;
      return metadata;
    }

    const liveDictationSourceLengths = new Map();
    const mobileCursorTargetsByTabId = new Map();

    function insertTextAtTrackedEditableFromBackground(value, options = {}) {
      const root = window;
      const liveSessionId =
        typeof options.dictationSessionId === "string" ? options.dictationSessionId : null;
      const livePhase =
        options.dictationPhase === "partial" || options.dictationPhase === "final"
          ? options.dictationPhase
          : null;
      const isLiveDictation = options.format === "dictation" && liveSessionId;
      const optionSourceLength =
        typeof options.dictationSourceLength === "number" && options.dictationSourceLength > 0
          ? options.dictationSourceLength
          : 0;
      const dictationResult = () =>
        isLiveDictation
          ? { dictationSessionId: liveSessionId, final: livePhase === "final", sourceLength: value.length }
          : null;

      const isEditable = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        return (
          element.tagName === "INPUT" ||
          element.tagName === "TEXTAREA" ||
          element.isContentEditable
        );
      };

      if (isEditable(document.activeElement)) {
        root.__voltLastEditable = document.activeElement;
      }

      if (!root.__voltEditableTrackerInstalled) {
        document.addEventListener(
          "focusin",
          (event) => {
            const target = event.target;
            const editableTarget = target instanceof Element ? target : null;
            if (isEditable(editableTarget)) {
              if (root.__voltLiveDictation?.target !== editableTarget) {
                root.__voltLiveDictation = root.__voltLiveDictation
                  ? {
                      sessionId: root.__voltLiveDictation.sessionId,
                      sourceStart: root.__voltLiveDictation.sourceLength ?? 0,
                      sourceLength: root.__voltLiveDictation.sourceLength ?? 0,
                    }
                  : null;
              }
              root.__voltLastEditable = editableTarget;
            }
          },
          true
        );
        root.__voltEditableTrackerInstalled = true;
      }

      const activeElement = document.activeElement;
      const target = isEditable(activeElement)
        ? activeElement
        : isEditable(root.__voltLastEditable ?? null)
        ? root.__voltLastEditable
        : null;

      if (!target) {
        if (isLiveDictation && livePhase === "partial") return dictationResult();
        navigator.clipboard.writeText(value).catch(() => {});
        return dictationResult();
      }

      target.focus();
      if (target.isContentEditable) {
        const selection = window.getSelection();
        const trackedRange =
          root.__voltLastEditable === target && root.__voltLastEditableRange?.commonAncestorContainer?.isConnected
            ? root.__voltLastEditableRange
            : null;
        if (trackedRange && selection) {
          selection.removeAllRanges();
          selection.addRange(trackedRange);
        }
        const live = root.__voltLiveDictation;
        const liveSourceLength =
          live?.sessionId === liveSessionId && typeof live.sourceLength === "number"
            ? live.sourceLength
            : optionSourceLength;
        const liveSourceStart =
          live?.sessionId === liveSessionId && typeof live.sourceStart === "number"
            ? live.sourceStart
            : 0;
        const selectionStillAtLiveNode = (() => {
          if (!selection || !live?.node?.isConnected || selection.rangeCount === 0) return false;
          const range = selection.getRangeAt(0);
          return (
            range.collapsed &&
            range.startContainer === live.node.parentNode &&
            range.startOffset === Array.prototype.indexOf.call(live.node.parentNode?.childNodes ?? [], live.node) + 1
          );
        })();
        if (
          isLiveDictation &&
          live?.sessionId === liveSessionId &&
          live.target === target &&
          live.node?.isConnected &&
          selectionStillAtLiveNode
        ) {
          live.node.nodeValue = value.slice(liveSourceStart).trimStart();
          live.sourceLength = value.length;
          const range = document.createRange();
          range.setStartAfter(live.node);
          range.collapse(true);
          selection?.removeAllRanges();
          selection?.addRange(range);
          if (livePhase === "final") root.__voltLiveDictation = null;
        } else if (isLiveDictation && selection) {
          const nextValue = live?.sessionId === liveSessionId ? value.slice(liveSourceLength).trimStart() : value;
          if (!nextValue) {
            root.__voltLiveDictation =
              livePhase === "final"
                ? null
                : { sessionId: liveSessionId, sourceStart: value.length, sourceLength: value.length };
            return dictationResult();
          }
          const range =
            selection.rangeCount > 0
              ? selection.getRangeAt(0)
              : document.createRange();
          if (selection.rangeCount === 0) {
            range.selectNodeContents(target);
            range.collapse(false);
          }
          range.deleteContents();
          const node = document.createTextNode(nextValue);
          range.insertNode(node);
          range.setStartAfter(node);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          root.__voltLiveDictation =
            livePhase === "final"
              ? null
              : { sessionId: liveSessionId, target, node, sourceStart: liveSourceLength, sourceLength: value.length };
        } else {
          document.execCommand("insertText", false, value);
        }
        target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
        root.__voltLastEditableRange = null;
        return dictationResult();
      }

      const input = target;
      const live = root.__voltLiveDictation;
      const replaceLiveInput =
        isLiveDictation &&
        live?.sessionId === liveSessionId &&
        live.target === input &&
        typeof live.start === "number" &&
        typeof live.end === "number" &&
        input.selectionStart === live.end &&
        input.selectionEnd === live.end;
      const trackedSelection =
        root.__voltLastEditable === input &&
        root.__voltLastEditableSelection &&
        root.__voltLastEditableSelection.isContentEditable !== true
          ? root.__voltLastEditableSelection
          : null;
      const liveSourceLength =
        live?.sessionId === liveSessionId && typeof live.sourceLength === "number"
          ? live.sourceLength
          : optionSourceLength;
      const liveSourceStart =
        live?.sessionId === liveSessionId && typeof live.sourceStart === "number"
          ? live.sourceStart
          : 0;
      const nextValue =
        isLiveDictation && live?.sessionId === liveSessionId
          ? value.slice(replaceLiveInput ? liveSourceStart : liveSourceLength).trimStart()
          : value;
      if (isLiveDictation && !nextValue) {
        root.__voltLiveDictation =
          livePhase === "final"
            ? null
            : { sessionId: liveSessionId, sourceStart: value.length, sourceLength: value.length };
        return dictationResult();
      }
      const start = replaceLiveInput
        ? live.start
        : typeof trackedSelection?.start === "number"
        ? trackedSelection.start
        : input.selectionStart ?? input.value.length;
      const end = replaceLiveInput
        ? live.end
        : typeof trackedSelection?.end === "number"
        ? trackedSelection.end
        : input.selectionEnd ?? input.value.length;
      if (typeof input.setRangeText === "function") {
        input.setRangeText(nextValue, start, end, "end");
      } else {
        input.value = input.value.slice(0, start) + nextValue + input.value.slice(end);
        input.selectionStart = input.selectionEnd = start + nextValue.length;
      }
      if (isLiveDictation) {
        root.__voltLiveDictation =
          livePhase === "final"
            ? null
            : {
                sessionId: liveSessionId,
                target: input,
                start,
                end: start + nextValue.length,
                sourceStart: replaceLiveInput ? liveSourceStart : liveSourceLength,
                sourceLength: value.length,
              };
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      root.__voltLastEditableSelection = null;
      return dictationResult();
    }

    async function insertScannerText(text, options = {}) {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });

        if (!tab?.id) {
          await handleClipboardWithOffscreen("copyToClipboard", text);
          return;
        }

        const injectionResults = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: insertTextAtTrackedEditableFromBackground,
          args: [
            text,
            {
              ...options,
              dictationSourceLength:
                typeof options.dictationSessionId === "string"
                  ? liveDictationSourceLengths.get(options.dictationSessionId) ?? 0
                  : 0,
            },
          ],
        });
        const injectionResult = injectionResults?.[0]?.result;
        if (injectionResult?.dictationSessionId) {
          if (injectionResult.final) {
            liveDictationSourceLengths.delete(injectionResult.dictationSessionId);
          } else if (typeof injectionResult.sourceLength === "number") {
            liveDictationSourceLengths.set(injectionResult.dictationSessionId, injectionResult.sourceLength);
          }
        }
      } catch (err) {
        log("scanner insert fallback", err?.message || err);
        try {
          await handleClipboardWithOffscreen("copyToClipboard", text);
        } catch (clipboardErr) {
          log("scanner clipboard fallback failed", clipboardErr?.message || clipboardErr);
        }
      }
    }

    function persistScannerScan(scan) {
      void saveMobileScannerScan(scan).catch((error) => {
        log("scanner IndexedDB scan persist failed", error?.message || error);
        chrome.storage.local.get(
          { [MOBILE_SCANNER_STORAGE_KEY]: [] },
          (stored) => {
            const current = Array.isArray(stored[MOBILE_SCANNER_STORAGE_KEY])
              ? stored[MOBILE_SCANNER_STORAGE_KEY]
              : [];
            const next = [scan, ...current].slice(0, MOBILE_SCANNER_MAX_SCANS);
            chrome.storage.local.set({ [MOBILE_SCANNER_STORAGE_KEY]: next });
          }
        );
      });
    }

    function trimMobilePhotosForStorage(photos) {
      const trimmed = [];
      let totalBytes = 0;

      for (const photo of photos.slice(0, MOBILE_PHOTOS_MAX_PHOTOS)) {
        const estimatedBytes = typeof photo?.dataUrl === "string" ? photo.dataUrl.length : 0;
        if (trimmed.length > 0 && totalBytes + estimatedBytes > MOBILE_PHOTOS_MAX_PERSISTED_BYTES) {
          continue;
        }
        trimmed.push(stripMobilePhotoData(photo));
        totalBytes += estimatedBytes;
      }

      return trimmed;
    }

    function persistMobilePhoto(photo) {
      return new Promise((resolve) => {
        chrome.storage.local.get(
          { [MOBILE_PHOTOS_STORAGE_KEY]: [] },
          (stored) => {
            const current = Array.isArray(stored[MOBILE_PHOTOS_STORAGE_KEY])
              ? stored[MOBILE_PHOTOS_STORAGE_KEY]
              : [];
            const next = trimMobilePhotosForStorage([
              photo,
              ...current.filter((item) => item?.id !== photo.id),
            ]);
            chrome.storage.local.set({ [MOBILE_PHOTOS_STORAGE_KEY]: next }, () => {
              resolve(!chrome.runtime.lastError);
            });
          }
        );
      });
    }

    function broadcastScannerMessage(message) {
      try {
        chrome.runtime.sendMessage(message, () => {
          void chrome.runtime.lastError;
        });
      } catch (_) {}
    }

    async function pingScannerOffscreen() {
      try {
        const response = await chrome.runtime.sendMessage({
          action: "scannerOffscreenPing",
        });
        return response?.ready === true;
      } catch (_) {
        return false;
      }
    }

    async function ensureScannerOffscreenDocument() {
      const offscreenCreated = await createOffscreenDocument();
      if (!offscreenCreated) return false;

      if (await pingScannerOffscreen()) return true;

      const existingContexts = await getOffscreenContexts();
      if (existingContexts.length > 0) {
        try {
          await chrome.offscreen.closeDocument();
        } catch (error) {
          log("Failed to close stale offscreen document", error?.message || error);
          return false;
        }
      }

      const recreated = await createOffscreenDocument();
      if (!recreated) return false;
      return pingScannerOffscreen();
    }

    async function sendScannerOffscreenMessage(message) {
      const offscreenReady = await ensureScannerOffscreenDocument();
      if (!offscreenReady) {
        throw new Error("Failed to initialize scanner offscreen document");
      }
      return chrome.runtime.sendMessage(message);
    }

    async function getMobileCaptureTarget() {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return null;
        const trackedTarget =
          typeof tab.id === "number" ? mobileCursorTargetsByTabId.get(tab.id) : null;
        if (trackedTarget) {
          return {
            ...trackedTarget,
            tabTitle: clampString(tab.title || trackedTarget.tabTitle || "Current tab", 160),
            url: clampString(tab.url || trackedTarget.url || "", 600),
          };
        }
        return {
          browser: "Chrome",
          tabTitle: clampString(tab.title || "Current tab", 140),
          url: clampString(tab.url || "", 500),
          cursor: "Last focused editable field",
        };
      } catch (_error) {
        return {
          browser: "Chrome",
          cursor: "Last focused editable field",
        };
      }
    }

    async function updateMobileCaptureTarget(target, sender) {
      const senderTabId = typeof sender?.tab?.id === "number" ? sender.tab.id : null;
      const normalizedTarget =
        target && typeof target === "object"
          ? {
              browser: clampString(target.browser || "Chrome", 80),
              tabTitle: clampString(target.tabTitle || "Current tab", 160),
              url: clampString(target.url || "", 600),
              cursor: clampString(target.cursor || "Last focused editable field", 120),
              frameId: typeof sender?.frameId === "number" ? sender.frameId : 0,
              updatedAt: toFiniteNumber(target.updatedAt, Date.now()),
            }
          : await getMobileCaptureTarget();
      if (senderTabId && normalizedTarget) {
        mobileCursorTargetsByTabId.set(senderTabId, normalizedTarget);
      }
      try {
        await sendScannerOffscreenMessage({
          action: "scannerOffscreenUpdateTarget",
          target: normalizedTarget,
        });
      } catch (error) {
        log("Failed to update mobile capture target", error?.message || error);
      }
    }

    async function handleScannerStart(message, sendResponse) {
      try {
        const state = await sendScannerOffscreenMessage({
          action: "scannerOffscreenStart",
          force: message?.force === true,
          mode: normalizeMobileCaptureMode(message?.mode),
          target: await getMobileCaptureTarget(),
        });
        sendResponse({ success: true, state });
      } catch (err) {
        sendResponse({ success: false, error: String(err?.message || err) });
      }
    }

    async function handleOpenMobileCapture(message, sender, sendResponse) {
      try {
        const state = await sendScannerOffscreenMessage({
          action: "scannerOffscreenStart",
          force: false,
          mode: normalizeMobileCaptureMode(message?.mode),
          target: await getMobileCaptureTarget(),
        });

        if (message?.surface === "popup") {
          await openMobileScannerPairingPopup(normalizeMobileCaptureMode(message?.mode), state);
        }

        sendResponse(
          state?.qrCodeUrl
            ? { success: true, state }
            : { success: false, state, error: "missing_app_clip_url" }
        );
      } catch (err) {
        sendResponse({ success: false, error: String(err?.message || err) });
      }
    }

    async function handleScannerDisconnect(sendResponse) {
      try {
        const state = await sendScannerOffscreenMessage({
          action: "scannerOffscreenDisconnect",
        });
        sendResponse({ success: true, state });
      } catch (err) {
        sendResponse({ success: false, error: String(err?.message || err) });
      }
    }

    async function handleScannerCloseJoinWindow(sendResponse) {
      try {
        const state = await sendScannerOffscreenMessage({
          action: "scannerOffscreenCloseJoinWindow",
        });
        sendResponse?.({ success: true, state });
      } catch (err) {
        sendResponse?.({ success: false, error: String(err?.message || err) });
      }
    }

    async function handleScannerPairingPopupClosed(sendResponse) {
      await resetMobileScannerActionPopup();
      await handleScannerCloseJoinWindow(sendResponse);
    }

    async function handleScannerGetState(sendResponse) {
      try {
        const state = await sendScannerOffscreenMessage({
          action: "scannerOffscreenGetState",
        });
        sendResponse({ success: true, state });
      } catch (err) {
        sendResponse({
          success: true,
          state: { status: "disconnected", qrCodeUrl: null, error: null },
        });
      }
    }

    function handleScannerScan(message) {
      const scan = normalizeScannerMessage(message?.scan);
      if (!scan) return;
      if (shouldPersistScannerScan(scan)) {
        persistScannerScan(scan);
        broadcastScannerMessage({ action: "scannerScan", scan });
      }

      if (shouldInsertScannerMessage(scan)) {
        void insertScannerText(scan.barcode, {
          dictationPhase: scan.dictationPhase,
          dictationSessionId: scan.dictationSessionId,
          format: scan.format,
          kind: scan.kind,
        });
      }
    }

    async function handleScannerPhoto(message) {
      const photo = normalizeMobilePhoto(message?.photo);
      if (!photo) return { success: false, error: "invalid_photo" };

      const downloadResult = await downloadMobilePhoto(photo);
      if (!downloadResult.success) return { success: false, error: downloadResult.error || "download_failed" };

      const downloadedPhoto = {
        ...photo,
        downloadId: downloadResult.downloadId,
        downloadFilename: downloadResult.filename,
      };
      const savedPhoto = await saveMobileScannerPhoto(downloadedPhoto).catch((error) => {
        log("scanner IndexedDB photo persist failed", error?.message || error);
        return null;
      });
      const persisted = savedPhoto ? true : await persistMobilePhoto(downloadedPhoto);
      if (!persisted) return { success: false, error: "storage_failed" };
      const { blob, ...savedPhotoMetadata } = savedPhoto?.photo ?? {};
      broadcastScannerMessage({
        action: "scannerPhoto",
        photo: savedPhoto
          ? { ...savedPhotoMetadata, dataUrl: downloadedPhoto.dataUrl }
          : downloadedPhoto,
      });
      return { success: true };
    }

    function handleScannerRelayStateGet(message, sendResponse) {
      if (message?.key !== MOBILE_RELAY_STATE_STORAGE_KEY) {
        sendResponse({ success: false, error: "invalid_key" });
        return;
      }
      chrome.storage.local.get({ [MOBILE_RELAY_STATE_STORAGE_KEY]: null }, (stored) => {
        sendResponse({ success: true, state: stored[MOBILE_RELAY_STATE_STORAGE_KEY] ?? null });
      });
    }

    function handleScannerRelayStateSet(message, sendResponse) {
      if (message?.key !== MOBILE_RELAY_STATE_STORAGE_KEY || !message?.state) {
        sendResponse({ success: false, error: "invalid_state" });
        return;
      }
      chrome.storage.local.set({ [MOBILE_RELAY_STATE_STORAGE_KEY]: message.state }, () => {
        sendResponse({ success: true });
      });
    }

    function handleScannerRelayStateRemove(message, sendResponse) {
      if (message?.key !== MOBILE_RELAY_STATE_STORAGE_KEY) {
        sendResponse({ success: false, error: "invalid_key" });
        return;
      }
      chrome.storage.local.remove(MOBILE_RELAY_STATE_STORAGE_KEY, () => {
        sendResponse({ success: true });
      });
    }

    log("Service worker booted", { time: new Date().toISOString() });

    // Track previous active tab for CMDK "return to previous tab" feature
    let previousActiveTabId = null;
    let lastActiveTabId = null;
    let currentActiveTabId = null;
    const sidepanelTools = createSidepanelToolController({
      chromeApi: chrome,
      log,
      getFallbackTabIds: () => [currentActiveTabId, lastActiveTabId],
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

    async function openMobileScannerPairingPopup(mode, state) {
      const popupUrl = new URL(chrome.runtime.getURL("mobile-scanner-popup.html"));
      if (mode) popupUrl.searchParams.set("mode", mode);
      if (state?.status) popupUrl.searchParams.set("status", state.status);

      await chrome.action.setPopup({
        popup: `${popupUrl.pathname.replace(/^\//, "")}${popupUrl.search}`,
      });
      await chrome.action.openPopup();
    }

    function getSidePanelState(windowId) {
      return sidepanelTools.getStateForWindow(windowId);
    }

    function setSidePanelState(windowId, nextState) {
      sidepanelTools.setStateForWindow(windowId, nextState);
    }

    function toggleSidePanelForWindow(windowId, tool, mode = "toggle") {
      sidepanelTools.toggleForWindow(windowId, tool, mode);
    }

    function toggleSidePanelForTab(tabId, tool, mode = "toggle") {
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
        void updateMobileCaptureTarget(mobileCursorTargetsByTabId.get(tabId) ?? null, null);
      } catch (_) {}
    });
    // Clean up tracking if tabs are closed
    try {
      chrome.tabs.onRemoved.addListener((closedTabId) => {
        if (previousActiveTabId === closedTabId) previousActiveTabId = null;
        if (lastActiveTabId === closedTabId) lastActiveTabId = null;
        mobileCursorTargetsByTabId.delete(closedTabId);
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
      if (
        [
          "scannerOffscreenPing",
          "scannerOffscreenStart",
          "scannerOffscreenDisconnect",
          "scannerOffscreenCloseJoinWindow",
          "scannerOffscreenGetState",
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
            const pendingItems = result.scout_pricecharting_pending_items || [];
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

      switch (message.action) {
        case "scannerRelayStateGet":
          handleScannerRelayStateGet(message, sendResponse);
          return true;
        case "scannerRelayStateSet":
          handleScannerRelayStateSet(message, sendResponse);
          return true;
        case "scannerRelayStateRemove":
          handleScannerRelayStateRemove(message, sendResponse);
          return true;
        case "scannerStart":
          handleScannerStart(message, sendResponse);
          return true;
        case "scannerStartForMode":
          handleScannerStart(message, sendResponse);
          return true;
        case "openMobileCapture":
          handleOpenMobileCapture(message, sender, sendResponse);
          return true;
        case "openMobileCapturePopup":
          handleOpenMobileCapture({ ...message, surface: "popup" }, sender, sendResponse);
          return true;
        case "scannerDisconnect":
          handleScannerDisconnect(sendResponse);
          return true;
        case "scannerCloseJoinWindow":
          handleScannerCloseJoinWindow(sendResponse);
          return true;
        case "scannerPairingPopupClosed":
          handleScannerPairingPopupClosed(sendResponse);
          return true;
        case "scannerGetState":
          handleScannerGetState(sendResponse);
          return true;
        case "mobileCursorTargetChanged":
          void updateMobileCaptureTarget(message?.target, sender);
          sendResponse({ success: true });
          return false;
        case "scannerStateChanged":
          if (message?.source !== "scanner-background") {
            broadcastScannerMessage({
              action: "scannerStateChanged",
              source: "scanner-background",
              state: message?.state,
            });
          }
          sendResponse({ success: true });
          break;
        case "scannerOffscreenScan":
          handleScannerScan(message);
          sendResponse({ success: true });
          break;
        case "scannerOffscreenPhoto":
          handleScannerPhoto(message).then(sendResponse);
          return true;
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
                  chrome.sidePanel.close({ windowId: tab.windowId }, () => {
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
                  log("sidePanel close error", e?.message || e);
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
                  chrome.sidePanel.close({ windowId: active.windowId }, () => {
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
                  log("sidePanel close error", e?.message || e);
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

          PREVIEW_SOURCE_TAB_ID = sender?.tab?.id;
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

        // Try to move it back to the source window if possible,
        // otherwise just move it to the last focused window
        const targetWindowId = PREVIEW_SOURCE_TAB_ID
          ? null
          : chrome.windows.WINDOW_ID_CURRENT;

        if (PREVIEW_SOURCE_TAB_ID) {
          chrome.tabs.get(PREVIEW_SOURCE_TAB_ID, (sourceTab) => {
            const windowId =
              sourceTab?.windowId || chrome.windows.WINDOW_ID_CURRENT;
            chrome.tabs.move(tabId, { windowId, index: -1 }, (movedTab) => {
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
    let PREVIEW_POPUP_ID = null;
    let PREVIEW_SOURCE_TAB_ID = null;
    let PREVIEW_OPENED_AT = 0;
    let PREVIEW_SOURCE_WINDOW_ID = null;
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

    function trackCurrentToolPopup(id) {
      CURRENT_TOOL_POPUP_ID = id || null;
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
                    trackCurrentToolPopup(win?.id);
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
                  trackCurrentToolPopup(win?.id);
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
            log("openToolNear error", e?.message || e);
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
      if (OFFSCREEN_CREATE_PROMISE) {
        return OFFSCREEN_CREATE_PROMISE;
      }

      OFFSCREEN_CREATE_PROMISE = createOffscreenDocumentOnce().finally(() => {
        OFFSCREEN_CREATE_PROMISE = null;
      });
      return OFFSCREEN_CREATE_PROMISE;
    }

    async function getOffscreenContexts() {
      if (!chrome.runtime.getContexts) {
        const matchedClients = await clients.matchAll();
        return matchedClients
          .filter((client) => client.url.includes(chrome.runtime.id))
          .map((client) => ({ documentUrl: client.url }));
      }

      return chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
      });
    }

    async function createOffscreenDocumentOnce() {
      const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
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
        const createOptions = {
          url: OFFSCREEN_DOCUMENT_PATH,
          reasons: ["DOM_SCRAPING", "CLIPBOARD", "WEB_RTC"],
          justification:
            "Gamepad detection, clipboard fallback, and the mobile scanner connection run without visible extension UI",
        };
        try {
          await chrome.offscreen.createDocument(createOptions);
        } catch (reasonError) {
          if (
            String(reasonError?.message || reasonError).includes(
              "Only a single offscreen document"
            )
          ) {
            log("Offscreen document already exists");
            return true;
          }

          log(
            "Offscreen create with extended reasons failed, retrying with DOM_SCRAPING",
            reasonError?.message || reasonError
          );
          try {
            await chrome.offscreen.createDocument({
              ...createOptions,
              reasons: ["DOM_SCRAPING"],
            });
          } catch (fallbackError) {
            if (
              String(fallbackError?.message || fallbackError).includes(
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
