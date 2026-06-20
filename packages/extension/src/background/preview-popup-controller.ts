import type { RuntimeActionRegistry } from "./runtime-action-registry";
import type { LogFn } from "./runtime-action-registry";

type PreviewPopupControllerOptions = {
  chromeApi: typeof chrome;
  log: LogFn;
};

const POPUP_OPENING_GRACE_MS = 700;
const POPUP_FOCUS_ARM_MS = 150;

export function createPreviewPopupController({
  chromeApi,
  log,
}: PreviewPopupControllerOptions) {
  let previewPopupId: number | null = null;
  let previewSourceTabId: number | null = null;
  let previewOpenedAt = 0;
  let previewSourceWindowId: number | null = null;
  let previewHasFocused = false;
  let previewFocusedAt = 0;
  let focusListenerAttached = false;

  function clearPreviewPopupState() {
    previewPopupId = null;
    previewSourceTabId = null;
    previewOpenedAt = 0;
    previewSourceWindowId = null;
    previewHasFocused = false;
    previewFocusedAt = 0;
  }

  function markPreviewPopupFocused() {
    previewHasFocused = true;
    previewFocusedAt = Date.now();
  }

  function previewPopupCanAutoClose() {
    const now = Date.now();
    return (
      previewHasFocused &&
      now - previewOpenedAt >= POPUP_OPENING_GRACE_MS &&
      now - previewFocusedAt >= POPUP_FOCUS_ARM_MS
    );
  }

  function ensureAutoCloseListener() {
    if (focusListenerAttached) return;
    try {
      chromeApi.windows.onFocusChanged.addListener((winId) => {
        try {
          if (previewPopupId && winId === previewPopupId) {
            markPreviewPopupFocused();
          } else if (
            previewPopupId &&
            winId === previewSourceWindowId &&
            previewPopupCanAutoClose()
          ) {
            chromeApi.windows.remove(previewPopupId, () => {});
            clearPreviewPopupState();
          }
        } catch (_) {}
      });
      chromeApi.windows.onRemoved.addListener((winId) => {
        if (winId === previewPopupId) clearPreviewPopupState();
      });
      focusListenerAttached = true;
    } catch (_) {}
  }

  function promotePreviewToTab() {
    if (!previewPopupId) {
      log("No preview popup to promote");
      return;
    }

    chromeApi.windows.get(previewPopupId, { populate: true }, (win) => {
      if (
        chromeApi.runtime.lastError ||
        !win ||
        !win.tabs ||
        win.tabs.length === 0
      ) {
        log("Could not find preview window or tabs");
        previewPopupId = null;
        return;
      }

      const tab = win.tabs[0];
      const tabId = tab.id;
      if (typeof tabId !== "number") {
        log("Preview tab missing id");
        previewPopupId = null;
        return;
      }

      if (previewSourceTabId) {
        chromeApi.tabs.get(previewSourceTabId, (sourceTab) => {
          const windowId =
            sourceTab?.windowId || chromeApi.windows.WINDOW_ID_CURRENT;
          chromeApi.tabs.move(tabId, { windowId, index: -1 }, () => {
            chromeApi.tabs.update(tabId, { active: true });
            chromeApi.windows.update(windowId, { focused: true });
            previewPopupId = null;
            log("Promoted preview to tab in window:", windowId);
          });
        });
      } else {
        chromeApi.tabs.move(
          tabId,
          { windowId: chromeApi.windows.WINDOW_ID_CURRENT, index: -1 },
          () => {
            chromeApi.tabs.update(tabId, { active: true });
            previewPopupId = null;
          }
        );
      }
    });
  }

  function registerActions(registry: RuntimeActionRegistry) {
    registry.register("openPreviewPopup", (message, sender, sendResponse) => {
      const url = message.url;
      if (!url) {
        sendResponse({ success: false, error: "missing_url" });
        return true;
      }

      if (previewPopupId) {
        try {
          chromeApi.windows.remove(previewPopupId, () => {});
        } catch (_) {}
        clearPreviewPopupState();
      }

      previewSourceTabId = sender?.tab?.id ?? null;
      previewSourceWindowId = sender?.tab?.windowId ?? null;
      previewOpenedAt = Date.now();
      previewHasFocused = false;
      previewFocusedAt = 0;
      ensureAutoCloseListener();

      const width = 1100;
      const height = 800;
      chromeApi.windows.create(
        {
          url,
          type: "popup",
          width,
          height,
          left: Math.floor(message.x ? message.x - width / 2 : 100),
          top: Math.floor(message.y ? message.y - height / 2 : 100),
          focused: true,
        },
        (win) => {
          previewPopupId = win?.id || null;
          previewOpenedAt = Date.now();
          previewHasFocused = false;
          previewFocusedAt = 0;
          log("Preview popup created:", previewPopupId);
          sendResponse({ success: true });
        }
      );
      return true;
    });

    registry.register("parentWindowFocused", (_message, sender, sendResponse) => {
      if (previewPopupId) {
        const senderWindowId = sender?.tab?.windowId ?? null;
        if (
          senderWindowId !== previewSourceWindowId ||
          !previewPopupCanAutoClose()
        ) {
          sendResponse({ success: true, ignored: "opening_focus_grace" });
          return true;
        }
        log("Auto-dismissing preview popup due to parent focus");
        try {
          chromeApi.windows.remove(previewPopupId, () => {});
        } catch (_) {}
        clearPreviewPopupState();
      }
      sendResponse({ success: true });
      return true;
    });

    registry.register("promotePreviewToTab", (_message, _sender, sendResponse) => {
      promotePreviewToTab();
      sendResponse({ success: true });
      return true;
    });
  }

  return {
    promotePreviewToTab,
    registerActions,
  };
}
