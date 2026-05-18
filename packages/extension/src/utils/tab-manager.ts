import { TAB_ACTIONS } from "../background/tab-message-handler";

export interface TabInfo {
  id: number | string;
  title: string;
  url: string;
  favIconUrl?: string;
  active: boolean;
  windowId: number;
}

export class TabManager {
  /**
   * Get all tabs across all windows
   */
  static async getAllTabs(): Promise<TabInfo[]> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: TAB_ACTIONS.getTabs }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error getting tabs:", chrome.runtime.lastError);
          resolve([]);
          return;
        }
        resolve(response?.tabs || []);
      });
    });
  }

  /**
   * Get recently closed tabs
   */
  static async getClosedTabs(): Promise<TabInfo[]> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: TAB_ACTIONS.getClosedTabs }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error getting closed tabs:", chrome.runtime.lastError);
          resolve([]);
          return;
        }
        resolve(response?.tabs || []);
      });
    });
  }

  /**
   * Switch to a specific tab
   */
  static async switchToTab(tabId: number): Promise<void> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: TAB_ACTIONS.switchTab, tabId }, () => {
        if (chrome.runtime.lastError) {
          console.error("Error switching tab:", chrome.runtime.lastError);
        }
        resolve();
      });
    });
  }

  /**
   * Restore a recently closed tab
   */
  static async restoreTab(
    sessionId: string,
    closeTabId?: number
  ): Promise<void> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: TAB_ACTIONS.restoreTab, sessionId, closeTabId },
        () => {
          if (chrome.runtime.lastError) {
            console.error("Error restoring tab:", chrome.runtime.lastError);
          }
          resolve();
        }
      );
    });
  }

  /**
   * Get the previous active tab ID
   */
  static async getPreviousTab(): Promise<number | null> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: TAB_ACTIONS.getPreviousTab }, (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "Error getting previous tab:",
            chrome.runtime.lastError
          );
          resolve(null);
          return;
        }
        resolve(response?.tabId || null);
      });
    });
  }

  /**
   * Open a new tab with the given URL
   */
  static async openNewTab(url: string): Promise<void> {
    console.log("[TabManager] Opening new tab:", url);
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: TAB_ACTIONS.openTab, url }, (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "[TabManager] Error opening tab:",
            chrome.runtime.lastError
          );
        } else {
          console.log("[TabManager] Tab opened successfully:", response);
        }
        resolve();
      });
    });
  }

  /**
   * Update the current tab's URL (for new tab override)
   */
  static async updateCurrentTab(url: string): Promise<void> {
    console.log("[TabManager] Updating current tab:", url);
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: TAB_ACTIONS.updateCurrentTab, url }, (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "[TabManager] Error updating tab:",
            chrome.runtime.lastError
          );
        } else {
          console.log("[TabManager] Tab updated successfully:", response);
        }
        resolve();
      });
    });
  }

  /**
   * Filter tabs by search query
   */
  static filterTabs(tabs: TabInfo[], query: string): TabInfo[] {
    if (!query.trim()) {
      return tabs;
    }

    const lowerQuery = query.toLowerCase();
    return tabs.filter((tab) => {
      const title = tab.title?.toLowerCase() || "";
      const url = tab.url?.toLowerCase() || "";
      return title.includes(lowerQuery) || url.includes(lowerQuery);
    });
  }

  /**
   * Sort tabs with active tab first
   */
  static sortTabs(tabs: TabInfo[]): TabInfo[] {
    return [...tabs].sort((a, b) => {
      if (a.active && !b.active) return -1;
      if (!a.active && b.active) return 1;
      return 0;
    });
  }
}
