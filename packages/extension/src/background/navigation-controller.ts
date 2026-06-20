import type { MessageRecord } from "./messages";
import type { RuntimeActionRegistry } from "./runtime-action-registry";
import type { LogFn } from "./runtime-action-registry";

type NavigationControllerOptions = {
  chromeApi: typeof chrome;
  log: LogFn;
  registry: RuntimeActionRegistry;
  sendToActiveTab: (message: MessageRecord) => void;
};

export function registerNavigationActions({
  chromeApi,
  log,
  registry,
  sendToActiveTab,
}: NavigationControllerOptions) {
  function goBackToPOS() {
    log("Going back to POS tab");

    chromeApi.tabs.query({}, (tabs) => {
      const posTabs = tabs.filter(
        (tab) => tab.url && tab.url.includes("pos.paymore.tech")
      );

      if (posTabs.length > 0) {
        const sortedTabs = posTabs.sort((a, b) => {
          const aTime = a.lastAccessed || 0;
          const bTime = b.lastAccessed || 0;
          return bTime - aTime;
        });

        const targetTab = sortedTabs[0];
        log("Found POS tab:", targetTab.id, targetTab.url);
        if (
          typeof targetTab.id !== "number" ||
          typeof targetTab.windowId !== "number"
        ) {
          log("POS tab missing id/windowId");
          return;
        }

        chromeApi.tabs.update(targetTab.id, { active: true });
        chromeApi.windows.update(targetTab.windowId, { focused: true });
        chromeApi.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
          if (activeTabs.length > 0 && typeof activeTabs[0].id === "number") {
            chromeApi.tabs.remove(activeTabs[0].id);
          }
        });
      } else {
        log("No POS tabs found, opening new one");
        chromeApi.tabs.create({
          url: "https://pos.paymore.tech",
          active: true,
        });
      }
    });
  }

  registry.register("hideControllerModal", (_message, _sender, sendResponse) => {
    sendToActiveTab({ action: "hideControllerModal" });
    sendResponse({ success: true });
    return true;
  });

  registry.register("GET_WEBPAGE_CONTEXT", (_message, _sender, sendResponse) => {
    chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        const activeTab = tabs[0];
        if (typeof activeTab.id !== "number") {
          sendResponse({ success: false, error: "No active tab found" });
          return;
        }
        chromeApi.tabs.sendMessage(
          activeTab.id,
          { action: "GET_WEBPAGE_CONTEXT" },
          (response: unknown) => {
            if (chromeApi.runtime.lastError) {
              log("Error getting webpage context:", chromeApi.runtime.lastError);
              sendResponse({
                success: false,
                error: "Failed to get webpage context",
              });
            } else {
              const responseRecord =
                response && typeof response === "object"
                  ? (response as MessageRecord)
                  : null;
              if (responseRecord?.success) {
                sendResponse({ success: true, data: responseRecord.data });
              } else {
                sendResponse({
                  success: false,
                  error: "No webpage context available",
                });
              }
            }
          }
        );
      } else {
        sendResponse({ success: false, error: "No active tab found" });
      }
    });
    return true;
  });

  registry.register("getActiveTab", (_message, _sender, sendResponse) => {
    log("getActiveTab requested");
    chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        log("getActiveTab: found tab", tabs[0]);
        sendResponse({ tab: tabs[0] });
      } else {
        log("getActiveTab: no tabs found");
        sendResponse({ error: "No active tab found" });
      }
    });
    return true;
  });

  registry.register("previousTab", (_message, _sender, sendResponse) => {
    chromeApi.tabs.query({ currentWindow: true }, (tabs) => {
      if (tabs.length < 2) {
        sendResponse({ success: false, error: "not_enough_tabs" });
        return;
      }
      const currentIndex = tabs.findIndex((tab) => tab.active);
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
      const prevTab = tabs[prevIndex];
      if (prevTab?.id) {
        chromeApi.tabs.update(prevTab.id, { active: true });
        sendResponse({ success: true, tabId: prevTab.id });
      } else {
        sendResponse({ success: false, error: "no_prev_tab" });
      }
    });
    return true;
  });

  registry.register("nextTab", (_message, _sender, sendResponse) => {
    chromeApi.tabs.query({ currentWindow: true }, (tabs) => {
      if (tabs.length < 2) {
        sendResponse({ success: false, error: "not_enough_tabs" });
        return;
      }
      const currentIndex = tabs.findIndex((tab) => tab.active);
      const nextIndex = (currentIndex + 1) % tabs.length;
      const nextTab = tabs[nextIndex];
      if (nextTab?.id) {
        chromeApi.tabs.update(nextTab.id, { active: true });
        sendResponse({ success: true, tabId: nextTab.id });
      } else {
        sendResponse({ success: false, error: "no_next_tab" });
      }
    });
    return true;
  });

  registry.register("closeTab", (_message, sender, sendResponse) => {
    const tabId = sender?.tab?.id;
    if (tabId) {
      chromeApi.tabs.remove(tabId, () => {
        sendResponse({ success: true });
      });
      return true;
    }

    chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0]?.id) {
        chromeApi.tabs.remove(tabs[0].id, () => {
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: false, error: "no_active_tab" });
      }
    });
    return true;
  });

  registry.register("goBackToPOS", (_message, _sender, sendResponse) => {
    goBackToPOS();
    sendResponse({ success: true });
    return true;
  });
}
