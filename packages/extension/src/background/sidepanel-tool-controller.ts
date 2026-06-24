type PanelState = {
  open: boolean;
  tool: string | null;
};

type SidePanelActionMode = "close" | "open" | "skipped" | "switch";

export type SidePanelOperationResult =
  | {
      success: true;
      mode: SidePanelActionMode;
      tool: string;
      windowId: number;
      reason?: string;
    }
  | {
      success: false;
      error: string;
      mode?: SidePanelActionMode;
      tool?: string;
      windowId?: number;
    };

export type SidePanelOperationCallback = (
  result: SidePanelOperationResult
) => void;

type SidePanelWithClose = typeof chrome.sidePanel & {
  close?: (options: { windowId: number }, callback?: () => void) => void;
};
type SidePanelSetOptions = Parameters<typeof chrome.sidePanel.setOptions>[0] & {
  windowId?: number;
};

type SidepanelChromeApi = Pick<typeof chrome, "runtime" | "storage" | "tabs"> & {
  sidePanel: SidePanelWithClose;
};

type SidepanelToolControllerOptions = {
  chromeApi: SidepanelChromeApi;
  log: (...args: unknown[]) => void;
  getFallbackTabIds: () => Array<number | null | undefined>;
  panelPath?: string;
};

const SIDE_PANEL_OPEN_COOLDOWN_MS = 900;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSidepanelToolController({
  chromeApi,
  log,
  getFallbackTabIds,
  panelPath = "sidepanel.html",
}: SidepanelToolControllerOptions) {
  const stateByWindow = new Map<number, PanelState>();
  const openInFlight = new Set<number>();
  const lastOpenAt = new Map<number, number>();

  function getStateForWindow(windowId: number): PanelState {
    return stateByWindow.get(windowId) || { open: false, tool: null };
  }

  function setStateForWindow(windowId: number, nextState: PanelState) {
    if (typeof windowId !== "number") return;
    const prevState = stateByWindow.get(windowId);
    if (
      prevState &&
      prevState.open === Boolean(nextState?.open) &&
      (prevState.tool || null) === (nextState?.tool || null)
    ) {
      return;
    }
    stateByWindow.set(windowId, nextState);
    broadcastState(windowId, nextState);
  }

  function broadcastState(windowId: number, state?: PanelState) {
    if (typeof windowId !== "number") return;
    const payload = state || getStateForWindow(windowId);
    try {
      chromeApi.tabs.query({ windowId }, (tabs) => {
        tabs.forEach((tab) => {
          if (typeof tab.id !== "number") return;
          try {
            chromeApi.tabs.sendMessage(
              tab.id,
              { action: "sidePanelStateSync", state: payload },
              () => {
                const err = chromeApi.runtime.lastError;
                if (err && !String(err.message || "").includes("Receiving end")) {
                  log("sidePanelStateSync delivery issue", err.message);
                }
              }
            );
          } catch (e) {
            log("sidePanelStateSync sendMessage error", errorMessage(e), tab.id);
          }
        });
      });
    } catch (e) {
      log("sidePanelStateSync broadcast error", errorMessage(e), windowId);
    }
  }

  function configurePanelForWindow(windowId: number) {
    try {
      const options: SidePanelSetOptions = {
        enabled: true,
        path: panelPath,
      };
      if (typeof windowId === "number") {
        options.windowId = windowId;
      }
      chromeApi.sidePanel.setOptions(options);
    } catch (setErr) {
      log("sidePanel setOptions error", errorMessage(setErr));
    }
  }

  function updatePreferredTool(tool: string) {
    try {
      chromeApi.storage.local.set({
        sidePanelTool: tool,
        sidePanelUrl: null,
      });
    } catch (storageErr) {
      log("Failed to set chrome storage for tool:", errorMessage(storageErr));
    }
  }

  function planAction(windowId: number, desiredTool: string, mode = "toggle") {
    if (typeof windowId !== "number" || !desiredTool) return null;
    const prev = getStateForWindow(windowId);

    if (mode === "toggle" && prev.open && prev.tool === desiredTool) {
      return { mode: "close", windowId, tool: desiredTool };
    }

    updatePreferredTool(desiredTool);

    if (mode === "toggle" && prev.open && prev.tool !== desiredTool) {
      setStateForWindow(windowId, { open: true, tool: desiredTool });
      return { mode: "switch", windowId, tool: desiredTool };
    }

    configurePanelForWindow(windowId);
    return { mode: "open", windowId, tool: desiredTool };
  }

  function asValidId(value: unknown) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed >= 0) return parsed;
    }
    return null;
  }

  function report(
    callback: SidePanelOperationCallback | undefined,
    result: SidePanelOperationResult
  ) {
    callback?.(result);
  }

  function toggleForWindow(
    windowId: unknown,
    tool?: string,
    mode = "toggle",
    callback?: SidePanelOperationCallback
  ) {
    if (!tool) {
      chromeApi.storage.local.get({ sidePanelTool: "mobile-scanner" }, (res) => {
        const storedTool =
          typeof res.sidePanelTool === "string" && res.sidePanelTool
            ? res.sidePanelTool
            : "mobile-scanner";
        toggleForWindow(windowId, storedTool, mode, callback);
      });
      return;
    }

    const openForWindow = (id: number) => {
      const plan = planAction(id, tool, mode);
      if (!plan) {
        report(callback, {
          success: false,
          error: "invalid_sidepanel_request",
          tool,
          windowId: id,
        });
        return;
      }

      if (plan.mode === "close") {
        try {
          if (!chromeApi.sidePanel.close) {
            report(callback, {
              success: false,
              error: "sidepanel_close_unavailable",
              mode: "close",
              tool,
              windowId: id,
            });
            return;
          }
          chromeApi.sidePanel.close?.({ windowId: id }, () => {
            const err = chromeApi.runtime.lastError;
            if (err) {
              log("sidePanel close error", err.message);
              report(callback, {
                success: false,
                error: err.message || "sidepanel_close_failed",
                mode: "close",
                tool,
                windowId: id,
              });
            } else {
              setStateForWindow(id, { open: false, tool: null });
              log(`Sidepanel closed for tool: ${tool}`);
              report(callback, {
                success: true,
                mode: "close",
                tool,
                windowId: id,
              });
            }
          });
        } catch (closeErr) {
          log("sidePanel close error", errorMessage(closeErr));
          report(callback, {
            success: false,
            error: errorMessage(closeErr),
            mode: "close",
            tool,
            windowId: id,
          });
        }
        return;
      }

      if (plan.mode === "switch") {
        log(`Switched sidepanel to tool: ${tool} on window: ${id}`);
        report(callback, {
          success: true,
          mode: "switch",
          tool,
          windowId: id,
        });
        return;
      }

      const now = Date.now();
      const sinceLastOpen = now - (lastOpenAt.get(id) || 0);
      const explicitOpen = mode === "open";
      if (openInFlight.has(id)) {
        log(`sidePanel open skipped (already in-flight) for window: ${id}, tool: ${tool}`);
        report(callback, {
          success: true,
          mode: "skipped",
          reason: "already_in_flight",
          tool,
          windowId: id,
        });
        return;
      }
      if (!explicitOpen && sinceLastOpen < SIDE_PANEL_OPEN_COOLDOWN_MS) {
        log(
          `sidePanel open skipped (cooldown ${SIDE_PANEL_OPEN_COOLDOWN_MS}ms) for window: ${id}, tool: ${tool}`
        );
        report(callback, {
          success: true,
          mode: "skipped",
          reason: "cooldown",
          tool,
          windowId: id,
        });
        return;
      }

      try {
        if (!chromeApi.sidePanel.open) {
          report(callback, {
            success: false,
            error: "sidepanel_open_unavailable",
            mode: "open",
            tool,
            windowId: id,
          });
          return;
        }
        openInFlight.add(id);
        chromeApi.sidePanel.open?.({ windowId: id }, () => {
          openInFlight.delete(id);
          const err = chromeApi.runtime.lastError;
          if (err) {
            log("sidePanel open lastError", err.message);
            report(callback, {
              success: false,
              error: err.message || "sidepanel_open_failed",
              mode: "open",
              tool,
              windowId: id,
            });
          } else {
            lastOpenAt.set(id, Date.now());
            setStateForWindow(id, { open: true, tool });
            log(`Sidepanel opened for tool: ${tool} on window: ${id}`);
            report(callback, {
              success: true,
              mode: "open",
              tool,
              windowId: id,
            });
          }
        });
        setTimeout(() => openInFlight.delete(id), 2000);
      } catch (openErr) {
        openInFlight.delete(id);
        log("sidePanel open error", errorMessage(openErr));
        report(callback, {
          success: false,
          error: errorMessage(openErr),
          mode: "open",
          tool,
          windowId: id,
        });
      }
    };

    const resolvedWindowId = asValidId(windowId);
    if (resolvedWindowId !== null) {
      openForWindow(resolvedWindowId);
      return;
    }

    log("toggleSidePanelForWindow: could not resolve window id immediately; querying");
    chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const active = tabs && tabs[0];
      if (active?.windowId) {
        openForWindow(active.windowId);
      } else {
        log("toggleSidePanelForWindow: unable to resolve active window id for sidepanel");
        report(callback, {
          success: false,
          error: "missing_window",
          tool,
        });
      }
    });
  }

  function toggleForTab(
    tabId?: unknown,
    tool?: string,
    mode = "toggle",
    callback?: SidePanelOperationCallback
  ) {
    const fallbackTabId = getFallbackTabIds().map(asValidId).find((id) => id !== null);
    const resolvedTabId = asValidId(tabId) ?? fallbackTabId;

    if (typeof resolvedTabId === "number") {
      chromeApi.tabs.get(resolvedTabId, (tab) => {
        if (typeof tab?.windowId === "number") {
          toggleForWindow(tab.windowId, tool, mode, callback);
        } else {
          log("toggleSidePanelForTab: could not get windowId for tab", resolvedTabId);
          report(callback, {
            success: false,
            error: "missing_window",
            tool,
          });
        }
      });
      return;
    }

    chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const active = tabs && tabs[0];
      if (active?.windowId) {
        toggleForWindow(active.windowId, tool, mode, callback);
      } else {
        log("toggleSidePanelForTab: unable to resolve window id for sidepanel");
        report(callback, {
          success: false,
          error: "missing_window",
          tool,
        });
      }
    });
  }

  return {
    getStateForWindow,
    setStateForWindow,
    toggleForTab,
    toggleForWindow,
  };
}
