// @ts-nocheck
/* global chrome */

type PanelState = {
  open: boolean;
  tool: string | null;
};

type SidepanelToolControllerOptions = {
  chromeApi: any;
  log: (...args: any[]) => void;
  getFallbackTabIds: () => Array<number | null | undefined>;
  panelPath?: string;
};

const SIDE_PANEL_OPEN_COOLDOWN_MS = 900;

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
            log("sidePanelStateSync sendMessage error", e?.message || e, tab.id);
          }
        });
      });
    } catch (e) {
      log("sidePanelStateSync broadcast error", e?.message || e, windowId);
    }
  }

  function configurePanelForWindow(windowId: number) {
    try {
      const options: any = {
        enabled: true,
        path: panelPath,
      };
      if (typeof windowId === "number") {
        options.windowId = windowId;
      }
      chromeApi.sidePanel.setOptions(options);
    } catch (setErr) {
      log("sidePanel setOptions error", setErr?.message || setErr);
    }
  }

  function updatePreferredTool(tool: string) {
    try {
      chromeApi.storage.local.set({
        sidePanelTool: tool,
        sidePanelUrl: null,
      });
    } catch (storageErr) {
      log("Failed to set chrome storage for tool:", storageErr?.message || storageErr);
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

  function toggleForWindow(windowId: unknown, tool?: string, mode = "toggle") {
    if (!tool) {
      chromeApi.storage.local.get({ sidePanelTool: "controller-testing" }, (res) => {
        toggleForWindow(windowId, res.sidePanelTool || "controller-testing", mode);
      });
      return;
    }

    const openForWindow = (id: number) => {
      const plan = planAction(id, tool, mode);
      if (!plan) return;

      if (plan.mode === "close") {
        try {
          chromeApi.sidePanel.close({ windowId: id }, () => {
            const err = chromeApi.runtime.lastError;
            if (err) {
              log("sidePanel close error", err.message);
            } else {
              setStateForWindow(id, { open: false, tool: null });
              log(`Sidepanel closed for tool: ${tool}`);
            }
          });
        } catch (closeErr) {
          log("sidePanel close error", closeErr?.message || closeErr);
        }
        return;
      }

      if (plan.mode === "switch") {
        log(`Switched sidepanel to tool: ${tool} on window: ${id}`);
        return;
      }

      const now = Date.now();
      const sinceLastOpen = now - (lastOpenAt.get(id) || 0);
      if (openInFlight.has(id)) {
        log(`sidePanel open skipped (already in-flight) for window: ${id}, tool: ${tool}`);
        return;
      }
      if (sinceLastOpen < SIDE_PANEL_OPEN_COOLDOWN_MS) {
        log(
          `sidePanel open skipped (cooldown ${SIDE_PANEL_OPEN_COOLDOWN_MS}ms) for window: ${id}, tool: ${tool}`
        );
        return;
      }

      try {
        openInFlight.add(id);
        chromeApi.sidePanel.open({ windowId: id }, () => {
          openInFlight.delete(id);
          lastOpenAt.set(id, Date.now());
          const err = chromeApi.runtime.lastError;
          if (err) {
            log("sidePanel open lastError", err.message);
          } else {
            setStateForWindow(id, { open: true, tool });
            log(`Sidepanel opened for tool: ${tool} on window: ${id}`);
          }
        });
        setTimeout(() => openInFlight.delete(id), 2000);
      } catch (openErr) {
        openInFlight.delete(id);
        log("sidePanel open error", openErr?.message || openErr);
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
      }
    });
  }

  function toggleForTab(tabId?: unknown, tool?: string, mode = "toggle") {
    const fallbackTabId = getFallbackTabIds().map(asValidId).find((id) => id !== null);
    const resolvedTabId = asValidId(tabId) ?? fallbackTabId;

    if (resolvedTabId !== null) {
      chromeApi.tabs.get(resolvedTabId, (tab) => {
        if (tab?.windowId) {
          toggleForWindow(tab.windowId, tool, mode);
        } else {
          log("toggleSidePanelForTab: could not get windowId for tab", resolvedTabId);
        }
      });
      return;
    }

    chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const active = tabs && tabs[0];
      if (active?.windowId) {
        toggleForWindow(active.windowId, tool, mode);
      } else {
        log("toggleSidePanelForTab: unable to resolve window id for sidepanel");
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
