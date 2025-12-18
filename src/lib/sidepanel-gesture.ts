/* eslint-disable @typescript-eslint/no-explicit-any */
/* global chrome */

type PanelState = {
  open: boolean;
  tool: string | null;
};

type PanelContext = {
  tabId?: number;
  state: PanelState;
  listenersAttached?: boolean;
};

const PANEL_PATH = "sidepanel.html";
const GLOBAL_KEY = "__scoutSidePanelCtx__";

function getGlobalContext(): PanelContext {
  const root = globalThis as any;
  if (!root[GLOBAL_KEY]) {
    root[GLOBAL_KEY] = {
      state: { open: false, tool: null },
      listenersAttached: false,
    } satisfies PanelContext;
    // Defer priming to initialization or usage
  }
  return root[GLOBAL_KEY] as PanelContext;
}

function primeContext(ctx: PanelContext) {
  if (ctx.tabId !== undefined) return; // Already primed

  const fetchState = () => {
    if (ctx.tabId !== undefined) return;
    try {
      chrome.runtime.sendMessage(
        { action: "getSidePanelStateForTab" },
        (response) => {
          const lastError = chrome.runtime.lastError;
          if (!lastError && response?.success) {
            if (typeof response?.tabId === "number") {
              ctx.tabId = response.tabId;
              // Log success for debugging
              console.log(`[Scout] Sidepanel context initialized with tabId: ${ctx.tabId}`);
            }
            if (response?.state) {
              ctx.state = normalizeState(response.state);
            }
          } else {
            // Retry on failure (e.g. SW waking up)
            setTimeout(fetchState, 1000);
          }
        }
      );
    } catch (_) {
      // Ignore bootstrap failures; helper will fallback gracefully.
      // Retry later
      setTimeout(fetchState, 2000);
    }
  };

  fetchState();
  attachSyncListener(ctx);
}

function attachSyncListener(ctx: PanelContext) {
  if (ctx.listenersAttached) return;
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.action === "sidePanelStateSync") {
        ctx.state = normalizeState(message?.state);
        sendResponse({ ok: true });
        return false; // Synchronous response
      }
      return false;
    });
  } catch (_) {
    // Silently ignore if listener cannot be attached (content script not ready, etc.)
  }
  ctx.listenersAttached = true;
}

function normalizeState(value: any): PanelState {
  if (!value || typeof value !== "object") {
    return { open: false, tool: null };
  }
  return {
    open: Boolean(value.open),
    tool: typeof value.tool === "string" ? value.tool : null,
  };
}

function ensureSidePanelOptions(tabId?: number) {
  if (!chrome?.sidePanel?.setOptions) return;
  try {
    const options: any = {
      enabled: true,
      path: PANEL_PATH,
    };
    if (typeof tabId === "number") options.tabId = tabId;
    chrome.sidePanel.setOptions(options, () => {
        const err = chrome.runtime.lastError;
        if (err) console.warn("[Scout] setOptions warning:", err.message);
    });
  } catch (_) {
    // Non-fatal; fallback open attempt will surface any errors.
  }
}

function execOpen(tabId?: number) {
  return new Promise<void>((resolve, reject) => {
    if (!chrome?.sidePanel?.open) {
      reject(new Error("sidePanel API unavailable"));
      return;
    }
    try {
      const options: any = {};
      if (typeof tabId === "number") options.tabId = tabId;
      // If no tabId is available, we rely on default behavior (which might fail for content scripts if tabId is required)
      chrome.sidePanel.open(options, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(err);
        else resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function execClose(tabId?: number) {
  return new Promise<void>((resolve, reject) => {
    if (!(chrome?.sidePanel as any)?.close) {
      reject(new Error("sidePanel API unavailable"));
      return;
    }
    try {
      const options: any = {};
      if (typeof tabId === "number") options.tabId = tabId;
      (chrome.sidePanel as any).close(options, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(err);
        else resolve();
      });
    } catch (error) {
      reject(error);
    }
  });
}

function notifyBackground(
  status: "opened" | "closed" | "error",
  tabId: number | undefined,
  tool: string,
  source?: string,
  errorMessage?: string
) {
  try {
    chrome.runtime.sendMessage(
      {
        action: "sidePanelToggleResult",
        status,
        tabId,
        tool,
        source,
        error: errorMessage,
      },
      () => {
        void chrome.runtime.lastError;
      }
    );
  } catch (_) {
    // Ignore notification errors.
  }
}

export function isSidePanelApiAvailable() {
  const available = Boolean(chrome?.sidePanel?.open);
  // Always log availability for now to debug
  console.log(`[Scout] sidePanel API available: ${available}, tabId: ${getGlobalContext().tabId}`);
  return available;
}

export type SidePanelTriggerResult =
  | "opened"
  | "closed"
  | "switched"
  | "noop";

/**
 * Initialize the side panel context early to fetch tabId.
 * Should be called in the main content script execution path.
 */
export function initializeSidePanelContext() {
  try {
    const ctx = getGlobalContext();
    primeContext(ctx);
  } catch (_) {}
}

export function triggerSidepanelToolFromContentScript(
  toolId: string,
  options?: { source?: string; mode?: "toggle" | "open" }
): Promise<SidePanelTriggerResult> {
  if (!isSidePanelApiAvailable()) {
    return Promise.reject(new Error("sidePanel API unavailable"));
  }

  const ctx = getGlobalContext();
  // Ensure priming in case initialization was missed
  primeContext(ctx);
  
  const tabId = ctx.tabId;
  const currentState = ctx.state || { open: false, tool: null };
  const mode = options?.mode ?? "toggle";
  const shouldClose = mode === "toggle" && currentState.open && currentState.tool === toolId;

  return new Promise<SidePanelTriggerResult>((resolve, reject) => {
    if (shouldClose) {
      execClose(tabId)
        .then(() => {
          ctx.state = { open: false, tool: null };
          notifyBackground("closed", tabId, toolId, options?.source);
          resolve("closed");
        })
        .catch((error) => {
          notifyBackground(
            "error",
            tabId,
            toolId,
            options?.source,
            error?.message
          );
          reject(error);
        });
      return;
    }

    try {
      chrome.storage?.local?.set?.({
        sidePanelTool: toolId,
        sidePanelUrl: null,
      });
    } catch (_) {
      // Non-blocking.
    }

    ctx.state = { open: true, tool: toolId };
    ensureSidePanelOptions(tabId);
    execOpen(tabId)
      .then(() => {
        notifyBackground("opened", tabId, toolId, options?.source);
        resolve("opened");
      })
      .catch((error) => {
        console.error("[Scout] execOpen failed:", error);
        ctx.state = { open: false, tool: null };
        notifyBackground(
          "error",
          tabId,
          toolId,
          options?.source,
          error?.message
        );
        reject(error);
      });
  });
}
