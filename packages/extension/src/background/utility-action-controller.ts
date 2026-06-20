import type { RuntimeActionRegistry } from "./runtime-action-registry";
import type { LogFn } from "./runtime-action-registry";

type RuntimePath =
  | `/install.html${string}`
  | `/mobile-scanner-popup.html${string}`
  | `/offscreen.html${string}`
  | `/options.html${string}`;

type UtilityActionOptions = {
  chromeApi: typeof chrome;
  getDebug: () => boolean;
  log: LogFn;
  openOptionsPage: () => Promise<boolean>;
  registry: RuntimeActionRegistry;
  runtimeUrl: (path: RuntimePath) => string;
  setDebug: (nextDebug: boolean) => void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function registerUtilityActions({
  chromeApi,
  getDebug,
  log,
  openOptionsPage,
  registry,
  runtimeUrl,
  setDebug,
}: UtilityActionOptions) {
  registry.register("fetchResource", (message, _sender, sendResponse) => {
    if (!message.url) {
      sendResponse({ ok: false, error: "missing_url" });
      return true;
    }
    const url = runtimeUrl(message.url as RuntimePath);
    fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }
        return response.text();
      })
      .then((text) => sendResponse({ ok: true, html: text }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  });

  registry.register("csReady", (message, _sender, sendResponse) => {
    log("content script ready", message.url);
    sendResponse({ ok: true });
    return true;
  });

  registry.register("openUrl", (message, _sender, sendResponse) => {
    const url = message.url;
    if (!url) {
      sendResponse({ success: false, error: "missing_url" });
      return true;
    }
    chromeApi.tabs.create({ url }, (tab) => {
      sendResponse({ success: true, tabId: tab?.id });
    });
    return true;
  });

  registry.register("OPEN_OPTIONS", (_message, _sender, sendResponse) => {
    openOptionsPage()
      .then((opened) => {
        sendResponse({ success: opened });
      })
      .catch((error) => {
        log("OPEN_OPTIONS handler error", error);
        sendResponse({ success: false, error: String(error) });
      });
    return true;
  });

  registry.register("open-settings", (message, _sender, sendResponse) => {
    const section = message.section || "";
    const url = section
      ? runtimeUrl(`/options.html#${encodeURIComponent(String(section))}`)
      : runtimeUrl("/options.html");
    chromeApi.tabs.create({ url, active: true }, (tab) => {
      sendResponse({ success: true, tabId: tab?.id });
    });
    return true;
  });

  registry.register("FETCH_CSV_LINKS", (message, _sender, sendResponse) => {
    const csvUrl = message.url;
    if (!csvUrl) {
      sendResponse({ success: false, error: "No URL provided" });
      return true;
    }
    fetch(csvUrl)
      .then((response) => response.text())
      .then((data) => {
        sendResponse({ success: true, data });
      })
      .catch((error) => {
        log("CSV fetch error:", error);
        sendResponse({ success: false, error: errorMessage(error) });
      });
    return true;
  });

  registry.register("toggleDebug", (message, _sender, sendResponse) => {
    setDebug(!!message.value);
    chromeApi.storage.local.set({ debugLogs: getDebug() });
    log("DEBUG toggled", getDebug());
    sendResponse({ success: true, debug: getDebug() });
    return true;
  });

  registry.register("generateQr", (message, _sender, sendResponse) => {
    const text = message.text || "";
    const size = Number(message.size || 256);
    if (!text) {
      sendResponse({ success: false, error: "missing_text" });
      return true;
    }
    const endpoint = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(
      text
    )}`;
    fetch(endpoint)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        sendResponse({
          success: true,
          dataUrl: `data:image/png;base64,${arrayBufferToBase64(buffer)}`,
        });
      })
      .catch((error) => {
        log("generateQr error", errorMessage(error));
        sendResponse({ success: false, error: errorMessage(error) });
      });
    return true;
  });

  registry.register("ping", (_message, _sender, sendResponse) => {
    log("pong");
    sendResponse({ pong: true, time: Date.now() });
    return true;
  });

  registry.register("downloadFile", (message, _sender, sendResponse) => {
    const url = message.url;
    if (!url) {
      sendResponse({ success: false, error: "missing_url" });
      return true;
    }
    try {
      chromeApi.downloads.download({ url }, (downloadId) => {
        if (chromeApi.runtime.lastError) {
          log("Download error:", chromeApi.runtime.lastError);
          sendResponse({
            success: false,
            error: chromeApi.runtime.lastError.message,
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
  });

  registry.register("openDevTools", (_message, _sender, sendResponse) => {
    try {
      chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0 && tabs[0]?.id) {
          const tabId = tabs[0].id;
          chromeApi.scripting.executeScript(
            {
              target: { tabId },
              func: () => {
                console.log(
                  "%c[Volt] Debug Tools Activated",
                  "color: #00ff00; font-size: 16px; font-weight: bold;"
                );
                console.log(
                  "%cDevTools should now be visible. If not, press F12 or Cmd+Option+I (Mac) / Ctrl+Shift+I (Windows/Linux)",
                  "color: #ffaa00; font-size: 14px;"
                );
                debugger;
              },
            },
            () => {
              if (chromeApi.runtime.lastError) {
                log("executeScript error:", chromeApi.runtime.lastError);
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
      sendResponse({ success: false, error: String(error) });
    }
    return true;
  });
}
