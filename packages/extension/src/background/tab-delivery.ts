import type { MessageRecord } from "./messages";
import type { LogFn } from "./runtime-action-registry";

type TabDeliveryOptions = {
  chromeApi: typeof chrome;
  log: LogFn;
};

export function createTabDeliveryController({
  chromeApi,
  log,
}: TabDeliveryOptions) {
  function sendToActiveTab(message: MessageRecord) {
    log("sendToActiveTab", message);
    chromeApi.tabs.query({ lastFocusedWindow: true }, (tabs) => {
      const isInjectable = (url = "") => /^(https?:|file:|ftp:)/.test(url);
      const active = tabs.find((tab) => tab.active);
      const target =
        active && isInjectable(active.url)
          ? active
          : tabs.find((tab) => isInjectable(tab.url));

      if (!target) {
        log("No injectable tab in currentWindow; creating a new one");
        chromeApi.tabs.create({ url: "https://example.com" }, (newTab) => {
          chromeApi.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (
              typeof newTab.id === "number" &&
              tabId === newTab.id &&
              info.status === "complete"
            ) {
              chromeApi.tabs.onUpdated.removeListener(listener);
              deliverToTab(newTab.id, message);
            }
          });
        });
        return;
      }

      if (typeof target.id === "number") {
        deliverToTab(target.id, message);
      }
    });
  }

  function getManifestContentScripts() {
    try {
      return chromeApi.runtime.getManifest()?.content_scripts || [];
    } catch (_) {
      return [];
    }
  }

  function injectManifestContentScripts(tabId: number) {
    const entries = getManifestContentScripts();
    entries.forEach((entry) => {
      const target = { tabId, allFrames: Boolean(entry.all_frames) };
      (entry.css || []).forEach((file) => {
        try {
          chromeApi.scripting.insertCSS({ target, files: [file] });
        } catch (_) {}
      });
      (entry.js || []).forEach((file) => {
        try {
          chromeApi.scripting.executeScript({ target, files: [file] });
        } catch (_) {}
      });
    });
  }

  function deliverToTab(tabId: number, message: MessageRecord) {
    const trySend = (attempt: number) => {
      chromeApi.tabs.sendMessage(tabId, message, (response: unknown) => {
        const lastErr = chromeApi.runtime.lastError;
        if (lastErr) {
          log(`send attempt ${attempt} failed`, lastErr.message);
          if (attempt === 1) {
            log("injecting content script via scripting API");
            injectManifestContentScripts(tabId);
            setTimeout(() => trySend(2), 500);
          } else if (attempt === 2) {
            log("final fallback: postMessage showControllerModal");
            chromeApi.scripting.executeScript({
              target: { tabId, allFrames: true },
              func: () =>
                window.postMessage(
                  { source: "volt", action: "showControllerModal" },
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

  return {
    deliverToTab,
    sendToActiveTab,
  };
}
