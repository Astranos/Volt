import type { MobileCursorTarget } from "./scanner-text-insertion";

type LogFn = (...args: unknown[]) => void;

type MobileCaptureTargetControllerOptions = {
  chromeApi: typeof chrome;
  log: LogFn;
  sendScannerOffscreenMessage: (message: unknown) => Promise<unknown>;
};

type MessageSender = Parameters<typeof chrome.runtime.onMessage.addListener>[0] extends (
  message: unknown,
  sender: infer TSender,
  sendResponse: (...args: unknown[]) => void
) => unknown
  ? TSender
  : { tab?: { id?: number }; frameId?: number };

function clampString(value: unknown, maxLength = 300) {
  const str = typeof value === "string" ? value : "";
  return str.length > maxLength ? str.slice(0, maxLength) : str;
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

export function normalizeMobileCaptureMode(mode: unknown) {
  return mode === "ocr" || mode === "barcode" || mode === "dictation" || mode === "photo"
    ? mode
    : null;
}

export function createMobileCaptureTargetController({
  chromeApi,
  log,
  sendScannerOffscreenMessage,
}: MobileCaptureTargetControllerOptions) {
  const mobileCursorTargetsByTabId = new Map<number, MobileCursorTarget>();

  function getTrackedTarget(tabId: number) {
    return mobileCursorTargetsByTabId.get(tabId) ?? null;
  }

  function deleteTrackedTarget(tabId: number) {
    mobileCursorTargetsByTabId.delete(tabId);
  }

  async function getMobileCaptureTarget(): Promise<MobileCursorTarget> {
    try {
      const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        return {
          browser: "Chrome",
          cursor: "Last focused editable field",
        };
      }
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

  async function updateMobileCaptureTarget(target: unknown, sender: MessageSender | null) {
    const senderTabId = typeof sender?.tab?.id === "number" ? sender.tab.id : null;
    const normalizedTarget =
      target && typeof target === "object"
        ? {
            browser: clampString((target as MobileCursorTarget).browser || "Chrome", 80),
            tabTitle: clampString((target as MobileCursorTarget).tabTitle || "Current tab", 160),
            url: clampString((target as MobileCursorTarget).url || "", 600),
            cursor: clampString((target as MobileCursorTarget).cursor || "Last focused editable field", 120),
            frameId: typeof sender?.frameId === "number" ? sender.frameId : 0,
            updatedAt: toFiniteNumber((target as MobileCursorTarget).updatedAt, Date.now()),
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
      log("Failed to update mobile capture target", error instanceof Error ? error.message : error);
    }
  }

  return {
    deleteTrackedTarget,
    getMobileCaptureTarget,
    getTrackedTarget,
    updateMobileCaptureTarget,
  };
}
