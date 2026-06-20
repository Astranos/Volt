type ActiveTabTrackerOptions = {
  chromeApi: typeof chrome;
  onActivated?: (tabId: number) => void;
  onRemoved?: (tabId: number) => void;
};

export function createActiveTabTracker({
  chromeApi,
  onActivated,
  onRemoved,
}: ActiveTabTrackerOptions) {
  let previousActiveTabId: number | null = null;
  let lastActiveTabId: number | null = null;
  let currentActiveTabId: number | null = null;

  function initialize() {
    try {
      chromeApi.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const active = tabs && tabs[0];
        if (active?.id) {
          lastActiveTabId = active.id;
          currentActiveTabId = active.id;
        }
      });
    } catch (_) {}

    chromeApi.tabs.onActivated.addListener(({ tabId }) => {
      try {
        if (lastActiveTabId && lastActiveTabId !== tabId) {
          previousActiveTabId = lastActiveTabId;
        }
        lastActiveTabId = tabId;
        currentActiveTabId = tabId;
        onActivated?.(tabId);
      } catch (_) {}
    });

    try {
      chromeApi.tabs.onRemoved.addListener((closedTabId) => {
        if (previousActiveTabId === closedTabId) previousActiveTabId = null;
        if (lastActiveTabId === closedTabId) lastActiveTabId = null;
        onRemoved?.(closedTabId);
        if (currentActiveTabId === closedTabId) {
          currentActiveTabId = null;
          try {
            chromeApi.tabs.query(
              { active: true, lastFocusedWindow: true },
              (tabs) => {
                const active = tabs && tabs[0];
                if (active?.id) currentActiveTabId = active.id;
              }
            );
          } catch (_) {}
        }
      });
    } catch (_) {}
  }

  return {
    getCurrentActiveTabId: () => currentActiveTabId,
    getFallbackTabIds: () => [currentActiveTabId, lastActiveTabId],
    getLastActiveTabId: () => lastActiveTabId,
    getPreviousActiveTabId: () => previousActiveTabId,
    initialize,
  };
}
