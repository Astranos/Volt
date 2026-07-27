import { useEffect, useMemo, useState } from "react";
import { ClosedTabsPanel } from "../../src/components/newtab/ClosedTabsPanel";
import { QuickLinksColumn } from "../../src/components/newtab/QuickLinksColumn";
import { BookmarksColumn } from "../../src/components/newtab/BookmarksColumn";
import { HeroBlock } from "../../src/components/newtab/HeroBlock";
import type { SearchMode } from "../../src/components/newtab/NewTabHelp";
import { ExtensionAccountControl } from "../../src/components/access/ExtensionAccess";
import { Settings, Smartphone } from "lucide-react";
import { TabManager } from "../../src/utils/tab-manager";
import { extractShopifyStoreName } from "../../src/domain/search";
import {
  NEW_TAB_SEARCH_PROVIDERS,
  parseSearchPrefix,
  resolveNewTabSearchIntent,
} from "../../src/domain/search-intent";
import "../../src/components/cmdk-palette/styles.css";
import "../../src/components/newtab/column-styles.css";
import "../../src/components/newtab/closed-tabs-panel.css";
import "../../src/components/newtab/newtab-layout.css";

export default function NewTab() {
  const [activeMode, setActiveMode] = useState<SearchMode>("closed-tabs");
  const [shopifyStore, setShopifyStore] = useState<string | null>(null);
  const [resolvingShopifyStore, setResolvingShopifyStore] = useState(false);

  // Randomize the aurora blobs' starting offset + animation phase on every
  // new-tab load so the bg looks fresh each time.
  const auroraStyle = useMemo(() => {
    const rand = (min: number, max: number) =>
      Math.round(min + Math.random() * (max - min));
    return {
      "--blob1-x": `${rand(-200, 320)}px`,
      "--blob1-y": `${rand(-160, 220)}px`,
      "--blob1-delay": `${-rand(0, 22)}s`,
      "--blob2-x": `${rand(-320, 200)}px`,
      "--blob2-y": `${rand(-220, 160)}px`,
      "--blob2-delay": `${-rand(0, 28)}s`,
    } as React.CSSProperties;
  }, []);

  useEffect(() => {
    document.title = "Volt";
  }, []);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.get(
      ["scout_shopify_store"],
      (result: {
        scout_shopify_store?: string;
      }) => {
        if (result?.scout_shopify_store) {
          setShopifyStore(result.scout_shopify_store);
        }
      }
    );
  }, []);

  const toggleSearchMode = (mode: SearchMode) => {
    setActiveMode((current) => {
      return current === mode ? "closed-tabs" : mode;
    });
  };

  const setSearchMode = (mode: SearchMode) => {
    setActiveMode(mode);
  };

  const resolveShopifyStoreFromTabs = async (): Promise<string | null> => {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.tabs) {
        resolve(null);
        return;
      }

      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (!tab.url) continue;
          const storeName = extractShopifyStoreName(tab.url);
          if (storeName) {
            resolve(storeName);
            return;
          }
        }
        resolve(null);
      });
    });
  };

  const resolveShopifyStoreViaRedirect = async (): Promise<string | null> => {
    return new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.tabs) {
        resolve(null);
        return;
      }

      try {
        chrome.tabs.create(
          { url: "https://admin.shopify.com/", active: false },
          (tab) => {
            if (!tab || typeof tab.id !== "number") {
              resolve(null);
              return;
            }

            const createdTabId = tab.id;

            const timeoutId = setTimeout(() => {
              try {
                chrome.tabs.onUpdated.removeListener(listener);
                chrome.tabs.remove(createdTabId);
              } catch (_e) {
                // ignore cleanup errors
              }
              resolve(null);
            }, 15000);

            const listener = (
              tabId: number,
              changeInfo: any,
              updatedTab: any
            ) => {
              if (tabId !== createdTabId) return;
              if (changeInfo.status !== "complete" || !updatedTab.url) return;

              const storeName = extractShopifyStoreName(updatedTab.url);

              if (storeName) {
                clearTimeout(timeoutId);
                try {
                  chrome.tabs.onUpdated.removeListener(listener);
                  chrome.tabs.remove(createdTabId);
                } catch (_e) {
                  // ignore cleanup errors
                }
                resolve(storeName);
              }
            };

            chrome.tabs.onUpdated.addListener(listener);
          }
        );
      } catch (_e) {
        resolve(null);
      }
    });
  };

  const resolveShopifyStore = async (): Promise<string | null> => {
    if (shopifyStore) return shopifyStore;

    setResolvingShopifyStore(true);
    try {
      const fromTabs = await resolveShopifyStoreFromTabs();
      if (fromTabs) {
        setShopifyStore(fromTabs);
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.set({ scout_shopify_store: fromTabs });
        }
        return fromTabs;
      }

      const fromRedirect = await resolveShopifyStoreViaRedirect();
      if (fromRedirect) {
        setShopifyStore(fromRedirect);
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          chrome.storage.local.set({ scout_shopify_store: fromRedirect });
        }
        return fromRedirect;
      }

      return null;
    } finally {
      setResolvingShopifyStore(false);
    }
  };

  const handleSearchSubmit = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const prefixedSearch = parseSearchPrefix(trimmed);
    const effectiveMode = prefixedSearch.mode ?? activeMode;

    if (!prefixedSearch.query) return;

    if (prefixedSearch.mode && prefixedSearch.mode !== activeMode) {
      setSearchMode(prefixedSearch.mode);
    }

    const storeName =
      effectiveMode === "shopify" ? await resolveShopifyStore() : shopifyStore;
    const intent = resolveNewTabSearchIntent(trimmed, {
      activeMode,
      providers: NEW_TAB_SEARCH_PROVIDERS,
      shopifyStoreName: storeName,
    });

    if (!intent) return;
    if (intent.kind === "missing-shopify-store") {
      console.warn(
        "[NewTab] Unable to resolve Shopify store for inventory search."
      );
      return;
    }

    await TabManager.updateCurrentTab(intent.url);
  };

  return (
    <div className="newtab-root">
      {/* Decorative aurora background — pointer-events:none, sits behind everything */}
      <div
        className="newtab-aurora"
        aria-hidden="true"
        style={auroraStyle}
      >
        <span className="aurora-blob aurora-blob-1" />
        <span className="aurora-blob aurora-blob-2" />
      </div>

      <div className="newtab-container">
        {/* Compact header */}
        <header className="newtab-header">
          <div className="newtab-header-brand">
            <img
              src="/assets/icons/logo.png"
              alt=""
              className="newtab-header-logo"
            />
            <h1 className="newtab-header-title">Volt</h1>
          </div>
          <div className="newtab-header-actions">
            <button
              type="button"
              className="newtab-settings-button"
              onClick={() =>
                void chrome.runtime.sendMessage({ action: "openMobileCapturePopup" })
              }
              aria-label="Open Volt App Clip QR code"
              title="Connect Volt App Clip"
            >
              <Smartphone />
            </button>
            <button
              type="button"
              className="newtab-settings-button"
              onClick={() => void chrome.runtime.sendMessage({ action: "open-settings" })}
              aria-label="Open Volt settings"
              title="Open Volt settings"
            >
              <Settings />
            </button>
            <ExtensionAccountControl surface="newtab" />
          </div>
        </header>

        {/* Hero: greeting + clock */}
        <HeroBlock />

        {/* Search */}
        <section className="newtab-search-section">
          <div
            id="tour-search-history"
            className="newtab-search-panel"
          >
            <ClosedTabsPanel
              onSearchSubmit={handleSearchSubmit}
              activeMode={activeMode}
              onToggleSearchMode={toggleSearchMode}
              resolvingShopifyStore={resolvingShopifyStore}
            />
          </div>

        </section>

        {/* Side columns: Quick Links & Bookmarks */}
        <section className="newtab-side-columns">
          <QuickLinksColumn id="tour-quick-links" />
          <BookmarksColumn id="tour-bookmarks" />
        </section>
      </div>
    </div>
  );
}
