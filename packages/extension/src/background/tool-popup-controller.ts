import type { AnchorPoint } from "./messages";
import type { RuntimeActionRegistry } from "./runtime-action-registry";
import type { LogFn } from "./runtime-action-registry";

type WindowUpdateProperties = Parameters<typeof chrome.windows.update>[1];

type ToolPopupControllerOptions = {
  chromeApi: typeof chrome;
  log: LogFn;
  toggleSidePanelForTab: (
    tabId: number | null | undefined,
    tool: string,
    mode?: string
  ) => void;
};

const POPUP_OPENING_GRACE_MS = 700;
const POPUP_FOCUS_ARM_MS = 150;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toolToPath(tool: string) {
  switch (tool) {
    case "upc-search":
      return "/tools/upc-search";
    case "volt":
      return "/tools/volt";
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

export function createToolPopupController({
  chromeApi,
  log,
  toggleSidePanelForTab,
}: ToolPopupControllerOptions) {
  let currentToolPopupId: number | null = null;
  let currentToolPopupOpenedAt = 0;
  let currentToolPopupHasFocused = false;
  let currentToolPopupFocusedAt = 0;
  let focusListenerAttached = false;

  function trackCurrentToolPopup(id: number | undefined) {
    currentToolPopupId = typeof id === "number" ? id : null;
    currentToolPopupOpenedAt = Date.now();
    currentToolPopupHasFocused = false;
    currentToolPopupFocusedAt = 0;
  }

  function clearCurrentToolPopupState() {
    currentToolPopupId = null;
    currentToolPopupOpenedAt = 0;
    currentToolPopupHasFocused = false;
    currentToolPopupFocusedAt = 0;
  }

  function markCurrentToolPopupFocused() {
    currentToolPopupHasFocused = true;
    currentToolPopupFocusedAt = Date.now();
  }

  function currentToolPopupCanAutoClose() {
    const now = Date.now();
    return (
      currentToolPopupHasFocused &&
      now - currentToolPopupOpenedAt >= POPUP_OPENING_GRACE_MS &&
      now - currentToolPopupFocusedAt >= POPUP_FOCUS_ARM_MS
    );
  }

  function ensureAutoCloseListener() {
    if (focusListenerAttached) return;
    try {
      chromeApi.windows.onFocusChanged.addListener((winId) => {
        try {
          if (currentToolPopupId && winId === currentToolPopupId) {
            markCurrentToolPopupFocused();
          }
          if (
            currentToolPopupId &&
            winId !== currentToolPopupId &&
            winId !== chromeApi.windows.WINDOW_ID_NONE &&
            currentToolPopupCanAutoClose()
          ) {
            chromeApi.windows.remove(currentToolPopupId, () => {});
            clearCurrentToolPopupState();
          }
        } catch (_) {}
      });
      chromeApi.windows.onRemoved.addListener((winId) => {
        if (winId === currentToolPopupId) clearCurrentToolPopupState();
      });
      focusListenerAttached = true;
    } catch (_) {}
  }

  function buildToolUrl(tool: string, windowParam: "pm_window" | "pm_popup") {
    const baseUrl = "https://volt-extension.vercel.app";
    const path = toolToPath(tool);
    return `${baseUrl}${path}${path.includes("?") ? "&" : "?"}${windowParam}=1`;
  }

  function withToolsPassword(
    url: string,
    callback: (urlWithPassword: string) => void
  ) {
    chromeApi.storage.local.get({ toolsPassword: "" }, (cfg) => {
      let nextUrl = url;
      const toolsPassword =
        typeof cfg?.toolsPassword === "string" ? cfg.toolsPassword : "";
      if (toolsPassword) {
        try {
          const parsed = new URL(nextUrl);
          parsed.searchParams.set("password", toolsPassword);
          nextUrl = parsed.href;
        } catch (_) {
          nextUrl = `${nextUrl}${
            nextUrl.includes("?") ? "&" : "?"
          }password=${encodeURIComponent(toolsPassword)}`;
        }
      }
      callback(nextUrl);
    });
  }

  function openInActionPopup(tool: string) {
    log("openInActionPopup redirecting to sidepanel", { tool });
    chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const active = tabs && tabs[0];
      if (active?.id) {
        toggleSidePanelForTab(active.id, tool);
      }
    });
  }

  function openToolNear(tool: string, anchor: AnchorPoint, percent: number) {
    withToolsPassword(buildToolUrl(tool, "pm_window"), (url) => {
      const ax = Math.max(0, Number(anchor?.x || 0));
      const ay = Math.max(0, Number(anchor?.y || 0));
      try {
        chromeApi.system.display.getInfo((displays) => {
          const d = (displays && displays[0] && displays[0].workArea) || {
            left: 0,
            top: 0,
            width: 1280,
            height: 800,
          };
          const w = Math.max(420, Math.floor(d.width * (percent || 0.35)));
          const h = Math.max(360, Math.floor(d.height * (percent || 0.35)));
          const gap = 16;
          const openLeft = ax > d.left + d.width * 0.5;
          let left = openLeft ? Math.floor(ax - w - gap) : Math.floor(ax + gap);
          let top = Math.floor(ay - Math.floor(h / 2));
          left = Math.min(Math.max(d.left, left), d.left + d.width - w);
          top = Math.min(Math.max(d.top, top), d.top + d.height - h);
          const createWindow = () =>
            chromeApi.windows.create(
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
          if (currentToolPopupId) {
            try {
              trackCurrentToolPopup(currentToolPopupId);
              chromeApi.windows.update(
                currentToolPopupId,
                {
                  state: "normal",
                  width: w,
                  height: h,
                  left,
                  top,
                  focused: true,
                },
                (updated) => {
                  const err = chromeApi.runtime.lastError;
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
      } catch (error) {
        log("openToolNear error", errorMessage(error));
        chromeApi.windows.create({ url, type: "popup", focused: true }, (win) => {
          try {
            trackCurrentToolPopup(win?.id);
            ensureAutoCloseListener();
          } catch (_) {}
        });
      }
    });
  }

  function resizeFocusedPopup(width: number | null, height: number | null) {
    try {
      chromeApi.windows.getCurrent((win) => {
        if (!win || win.type !== "popup") return;
        const update: WindowUpdateProperties = {};
        if (width && Number.isFinite(width)) update.width = Math.floor(width);
        if (height && Number.isFinite(height)) update.height = Math.floor(height);
        if (Object.keys(update).length && typeof win.id === "number") {
          chromeApi.windows.update(win.id, update);
        }
      });
    } catch (error) {
      log("resizeFocusedPopup error", errorMessage(error));
    }
  }

  function registerActions(registry: RuntimeActionRegistry) {
    registry.register("openInActionPopup", (message, _sender, sendResponse) => {
      const tool = message.tool;
      if (!tool) {
        sendResponse({ success: false, error: "missing_tool" });
        return true;
      }
      openInActionPopup(tool);
      sendResponse({ success: true });
      return true;
    });

    registry.register("openToolWindow", (message, _sender, sendResponse) => {
      const tool = message.tool;
      if (!tool) {
        sendResponse({ success: false, error: "missing_tool" });
        return true;
      }
      try {
        chromeApi.system.display.getInfo((displays) => {
          const d = (displays && displays[0] && displays[0].workArea) || {
            left: 0,
            top: 0,
            width: 1280,
            height: 800,
          };
          openToolNear(
            tool,
            {
              x: d.left + d.width - 72,
              y: d.top + Math.floor(d.height / 2),
            },
            0.4
          );
        });
      } catch (_) {
        openToolNear(tool, { x: 1200, y: 600 }, 0.4);
      }
      sendResponse({ success: true });
      return true;
    });

    registry.register("openToolWindowAt", (message, _sender, sendResponse) => {
      const tool = message.tool;
      if (!tool) {
        sendResponse({ success: false, error: "missing_tool" });
        return true;
      }
      openToolNear(tool, message.anchor || {}, 0.4);
      sendResponse({ success: true });
      return true;
    });

    registry.register("resizeToolForTab", (message, _sender, sendResponse) => {
      const width = Number(message.width || 0);
      const height = Number(message.height || 0);
      resizeFocusedPopup(width || null, height || null);
      sendResponse({ success: true });
      return true;
    });
  }

  return {
    openToolNear,
    registerActions,
  };
}
