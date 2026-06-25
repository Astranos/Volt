import type { RuntimeActionRegistry } from "./runtime-action-registry";
import type { LogFn } from "./runtime-action-registry";
import type { SidePanelOperationCallback } from "./sidepanel-tool-controller";

type PanelState = { open: boolean; tool: string | null };
type SidePanelWithClose = typeof chrome.sidePanel & {
  close?: (options: { windowId: number }, callback?: () => void) => void;
};

type SidepanelMessageControllerOptions = {
  chromeApi: typeof chrome;
  getCurrentTabId: () => number | null;
  getLastTabId: () => number | null;
  getSidePanelState: (windowId: number) => PanelState;
  log: LogFn;
  setSidePanelState: (windowId: number, nextState: PanelState) => void;
  toggleSidePanelForTab: (
    tabId: number | null | undefined,
    tool: string,
    mode?: string,
    callback?: SidePanelOperationCallback
  ) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerSidepanelMessageActions({
  chromeApi,
  getCurrentTabId,
  getLastTabId,
  getSidePanelState,
  log,
  registry,
  setSidePanelState,
  toggleSidePanelForTab,
}: SidepanelMessageControllerOptions & { registry: RuntimeActionRegistry }) {
    const sidePanelApi = chromeApi.sidePanel as SidePanelWithClose;

    registry.register("openInSidebar", (message, sender, sendResponse) => {
      const tool = message.tool;
      const mode = message.mode || "toggle";
      if (!tool) {
        sendResponse({ success: false, error: "missing_tool" });
        return true;
      }

      const candidateId =
        message.tabId ?? sender?.tab?.id ?? getCurrentTabId() ?? getLastTabId();
      if (candidateId) {
        toggleSidePanelForTab(candidateId, tool, mode, (result) => {
          sendResponse({ ...result, tabId: candidateId });
        });
        return true;
      }

      chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const active = tabs && tabs[0];
        if (active?.id) {
          toggleSidePanelForTab(active.id, tool, mode, (result) => {
            sendResponse({ ...result, tabId: active.id });
          });
        } else {
          sendResponse({ success: false, error: "no_active_tab" });
        }
      });
      return true;
    });

    registry.register("getSidePanelStateForTab", (message, sender, sendResponse) => {
      const tabId = sender?.tab?.id ?? message.tabId ?? null;
      if (tabId === null) {
        sendResponse({ success: false, error: "missing_tab" });
        return true;
      }
      chromeApi.tabs.get(tabId, (tab) => {
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
      return true;
    });

    registry.register("sidePanelToggleResult", (message, sender, sendResponse) => {
      const tabId = message.tabId ?? sender?.tab?.id;
      const status = message.status;
      const tool = message.tool || null;
      if (typeof tabId !== "number") {
        sendResponse({ success: false, error: "missing_tab" });
        return true;
      }
      chromeApi.tabs.get(tabId, (tab) => {
        if (tab?.windowId) {
          if (status === "opened") {
            setSidePanelState(tab.windowId, { open: true, tool });
          } else if (status === "closed") {
            setSidePanelState(tab.windowId, { open: false, tool: null });
          } else if (status === "error") {
            log("sidePanelToggleResult error", message.error || "unknown_error", {
              tool,
              tabId,
              windowId: tab.windowId,
              source: message.source,
            });
          }
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: "missing_window" });
        }
      });
      return true;
    });

    registry.register("sidePanelDidClose", (message, _sender, sendResponse) => {
      const markClosed = (windowId: number) => {
        setSidePanelState(windowId, { open: false, tool: null });
        log(`Sidepanel closed for window: ${windowId}`);
      };

      if (typeof message.windowId === "number") {
        markClosed(message.windowId);
        sendResponse({ success: true, windowId: message.windowId });
        return true;
      }

      chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const active = tabs && tabs[0];
        if (typeof active?.windowId === "number") {
          markClosed(active.windowId);
          sendResponse({ success: true, windowId: active.windowId });
        } else {
          sendResponse({ success: false, error: "missing_window" });
        }
      });
      return true;
    });

    registry.register("closeSidebar", (message, sender, sendResponse) => {
      const tabId = sender?.tab?.id ?? message.tabId;
      if (typeof tabId === "number") {
        chromeApi.tabs.get(tabId, (tab) => {
          if (tab?.windowId) {
            try {
              sidePanelApi.close?.({ windowId: tab.windowId }, () => {
                const err = chromeApi.runtime.lastError;
                if (err) {
                  log("sidePanel close error", err.message);
                } else {
                  setSidePanelState(tab.windowId, { open: false, tool: null });
                  log(`Sidepanel closed for window: ${tab.windowId}`);
                }
              });
            } catch (error) {
              log("sidePanel close error", errorMessage(error));
            }
          } else {
            log("closeSidebar missing windowId for tab", tabId);
          }
        });
      } else {
        chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const active = tabs && tabs[0];
          if (active?.windowId) {
            try {
              sidePanelApi.close?.({ windowId: active.windowId }, () => {
                const err = chromeApi.runtime.lastError;
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
            } catch (error) {
              log("sidePanel close error", errorMessage(error));
            }
          } else {
            log("closeSidebar missing windowId");
          }
        });
      }
      sendResponse({ success: true });
      return true;
    });

    registry.register("toggleSidepanelTool", (message, sender, sendResponse) => {
      const tool = message.tool || "mobile-scanner";
      toggleSidePanelForTab(sender?.tab?.id, tool);
      sendResponse({ success: true });
      return true;
    });
}
