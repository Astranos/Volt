// @ts-nocheck
/* global chrome */
declare const chrome: any;

export const TAB_ACTIONS = {
  getTabs: "GET_TABS",
  getClosedTabs: "GET_CLOSED_TABS",
  restoreTab: "RESTORE_TAB",
  switchTab: "SWITCH_TAB",
  getPreviousTab: "GET_PREVIOUS_TAB",
  openTab: "OPEN_TAB",
  updateCurrentTab: "UPDATE_CURRENT_TAB",
} as const;

export interface TabMessageHandlerState {
  getPreviousActiveTabId: () => number | null;
}

export function handleTabMessage(
  message: any,
  sender: any,
  sendResponse: (response?: any) => void,
  state: TabMessageHandlerState
): boolean {
  switch (message?.action) {
    case TAB_ACTIONS.getTabs:
      chrome.tabs.query({}, (tabs) => {
        const tabInfo = tabs.map((tab) => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl,
          active: tab.active,
          windowId: tab.windowId,
        }));
        sendResponse({ tabs: tabInfo });
      });
      return true;

    case TAB_ACTIONS.getClosedTabs:
      try {
        chrome.sessions.getRecentlyClosed({ maxResults: 25 }, (sessions) => {
          const closedTabs = sessions
            .filter((session) => session.tab)
            .map((session) => ({
              id: session.tab?.sessionId,
              title: session.tab?.title,
              url: session.tab?.url,
              favIconUrl: session.tab?.favIconUrl,
              windowId: session.tab?.windowId,
              active: false,
            }));
          sendResponse({ tabs: closedTabs });
        });
      } catch (_e) {
        sendResponse({ tabs: [] });
      }
      return true;

    case TAB_ACTIONS.restoreTab:
      if (!message.sessionId) {
        sendResponse({ success: false, error: "No sessionId provided" });
        return true;
      }

      chrome.sessions.restore(message.sessionId, () => {
        if (message.closeTabId !== undefined) {
          chrome.tabs.remove(message.closeTabId);
        }
        sendResponse({ success: true });
      });
      return true;

    case TAB_ACTIONS.switchTab:
      if (!message.tabId) {
        sendResponse({ success: false, error: "No tabId provided" });
        return true;
      }

      chrome.tabs.update(message.tabId, { active: true }, (tab) => {
        if (tab) {
          chrome.windows.update(tab.windowId, { focused: true });
        }
        sendResponse({ success: true });
      });
      return true;

    case TAB_ACTIONS.getPreviousTab:
      sendResponse({ tabId: state.getPreviousActiveTabId() });
      return true;

    case TAB_ACTIONS.openTab:
      if (!message.url) {
        sendResponse({ success: false, error: "No URL provided" });
        return true;
      }

      chrome.tabs.create({ url: message.url }, (tab) => {
        sendResponse({ success: true, tabId: tab?.id });
      });
      return true;

    case TAB_ACTIONS.updateCurrentTab:
      if (!message.url || !sender.tab?.id) {
        sendResponse({
          success: false,
          error: "No URL or tab ID provided",
        });
        return true;
      }

      chrome.tabs.update(sender.tab.id, { url: message.url }, (tab) => {
        sendResponse({ success: true, tabId: tab?.id });
      });
      return true;

    default:
      return false;
  }
}
