import React, { useEffect, useState } from "react";
import { ClosedTabsPanel } from "../../src/components/newtab/ClosedTabsPanel";
import { QuickLinksColumn } from "../../src/components/newtab/QuickLinksColumn";
import { BookmarksColumn } from "../../src/components/newtab/BookmarksColumn";
import { NewTabHelp } from "../../src/components/newtab/NewTabHelp";
import { Button } from "../../src/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../src/components/ui/tooltip";
import {
  SIDEPANEL_TOOLS,
  type SidepanelToolId,
} from "../../src/lib/sidepanel-tools";
import { triggerSidepanelToolFromContentScript } from "../../src/lib/sidepanel-gesture";
import { searchProviders } from "../../src/components/cmdk-palette/SearchProviders";
import { TabManager } from "../../src/utils/tab-manager";
import "../../src/components/cmdk-palette/styles.css";
import "../../src/components/newtab/column-styles.css";
import "../../src/components/newtab/closed-tabs-panel.css";
import "../../src/components/newtab/newtab-layout.css";

type SearchMode =
  | "google"
  | "ebay"
  | "pricecharting"
  | "barcodelookup"
  | "shopify";

export default function NewTab() {
  const [activeMode, setActiveMode] = useState<SearchMode>("google");
  const [shopifyStore, setShopifyStore] = useState<string | null>(null);
  const [resolvingShopifyStore, setResolvingShopifyStore] = useState(false);
  const [overrideEnabled, setOverrideEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    document.title = "Volt";
  }, []);

  useEffect(() => {
    if (
      typeof chrome === "undefined" ||
      !chrome.storage?.sync ||
      !chrome.tabs
    ) {
      // If we can't read settings or tabs, fall back to rendering Volt.
      setOverrideEnabled(true);
      return;
    }

    chrome.storage.sync.get(["cmdkSettings"], (result) => {
      const enabled = result?.cmdkSettings?.newTabOverride?.enabled ?? true;

      if (!enabled) {
        setOverrideEnabled(false);

        try {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs[0];
            if (!currentTab?.id) {
              return;
            }

            // When the new tab override is disabled in settings, we can't
            // restore Chrome's real `chrome://newtab` while this extension
            // still owns the override. Redirect to Google instead and avoid
            // an infinite loop caused by re-loading this override page.
            chrome.tabs.update(currentTab.id, {
              url: "https://www.google.com",
            });
          });
        } catch (e) {
          console.error(
            "[NewTab] Failed to redirect after disabling override:",
            e
          );
        }
      } else {
        setOverrideEnabled(true);
      }
    });
  }, []);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.get(
      ["scout_shopify_store", "scout_search_mode"],
      (result) => {
        if (result?.scout_shopify_store) {
          setShopifyStore(result.scout_shopify_store);
        }
        if (result?.scout_search_mode) {
          setActiveMode(result.scout_search_mode as SearchMode);
        }
      }
    );
  }, []);

  const toggleSearchMode = (mode: SearchMode) => {
    setActiveMode((current) => {
      const newMode = current === mode ? "google" : mode;
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ scout_search_mode: newMode });
      }
      return newMode;
    });
  };

  const handleSidepanelToolClick = (toolId: SidepanelToolId) => {
    try {
      triggerSidepanelToolFromContentScript(toolId, {
        source: "newtab",
      }).catch((err) => {
        console.error("[NewTab] Failed to open sidepanel tool:", err);
        // Fallback to message-based approach
        if (typeof chrome !== "undefined" && chrome.runtime) {
          chrome.runtime.sendMessage({
            action: "openInSidebar",
            tool: toolId,
          });
        }
      });
    } catch (e) {
      console.error("[NewTab] Failed to open sidepanel tool:", e);
      if (typeof chrome !== "undefined" && chrome.runtime) {
        chrome.runtime.sendMessage({
          action: "openInSidebar",
          tool: toolId,
        });
      }
    }
  };

  const getUrlFromInput = (input: string): string | null => {
    const value = input.trim();
    if (!value) return null;

    try {
      const hasScheme = /^[a-z][\w+.-]*:/i.test(value);
      if (hasScheme) {
        return new URL(value).href;
      }

      const looksLikeLocalhost = /^localhost(?:[:][0-9]+)?(?:\/.*)?$/i.test(
        value
      );
      const looksLikeDomain = /^[\w.-]+\.[a-z]{2,}(?::[0-9]+)?(?:\/.*)?$/i.test(
        value
      );

      if (looksLikeLocalhost || looksLikeDomain) {
        return new URL(`https://${value}`).href;
      }
    } catch (_e) {
      // ignore URL parsing errors
    }

    return null;
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
          const unifiedMatch = tab.url.match(
            /admin\.shopify\.com\/store\/([^/?]+)/
          );
          if (unifiedMatch && unifiedMatch[1]) {
            resolve(unifiedMatch[1]);
            return;
          }

          const legacyMatch = tab.url.match(/([^/.]+)\.myshopify\.com/);
          if (legacyMatch && legacyMatch[1]) {
            resolve(legacyMatch[1]);
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

              const unifiedMatch = updatedTab.url.match(
                /admin\.shopify\.com\/store\/([^/?]+)/
              );
              const legacyMatch = updatedTab.url.match(
                /([^/.]+)\.myshopify\.com/
              );

              const storeName =
                (unifiedMatch && unifiedMatch[1]) ||
                (legacyMatch && legacyMatch[1]) ||
                null;

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

    if (activeMode === "google") {
      // Treat as URL or Google search
      const directUrl = getUrlFromInput(trimmed);
      const finalUrl =
        directUrl ||
        `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
      await TabManager.updateCurrentTab(finalUrl);
      return;
    }

    if (
      activeMode === "ebay" ||
      activeMode === "pricecharting" ||
      activeMode === "barcodelookup"
    ) {
      const provider = searchProviders.find((p) => p.id === activeMode);
      if (!provider) return;

      const url = provider.searchUrl.replace(
        "{query}",
        encodeURIComponent(trimmed)
      );
      await TabManager.updateCurrentTab(url);
      return;
    }

    if (activeMode === "shopify") {
      const storeName = await resolveShopifyStore();
      if (!storeName) {
        console.warn(
          "[NewTab] Unable to resolve Shopify store for inventory search."
        );
        return;
      }

      const url = `https://admin.shopify.com/store/${storeName}/products?query=${encodeURIComponent(
        trimmed
      )}&order=inventory_total%20desc`;
      await TabManager.updateCurrentTab(url);
      return;
    }
  };

  if (overrideEnabled === false) {
    // Let the redirect effect take over; render nothing to avoid flicker.
    return null;
  }

  return (
    <div className="newtab-root">
      <div className="newtab-container">
        {/* Header with logo and toolbar */}
        <div className="newtab-header">
          <div className="newtab-header-content">
            <img
              src="/assets/icons/logo.png"
              alt="Logo"
              className="newtab-header-logo"
            />
            <h1 className="newtab-header-title">Volt Resale</h1>
            <NewTabHelp />

            {/* Toolbar buttons for sidepanel tools */}
            <TooltipProvider>
              <div id="tour-tools" className="newtab-toolbar-buttons">
                {SIDEPANEL_TOOLS.map((tool) => {
                  const Icon = tool.icon;
                  return (
                    <Tooltip key={tool.id}>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          onClick={() => handleSidepanelToolClick(tool.id)}
                          className="newtab-toolbar-button cursor-pointer flex items-center justify-center"
                          aria-label={tool.label}
                        >
                          <Icon className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="border-gray-200">
                        <p>{tool.label}</p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </TooltipProvider>
          </div>
        </div>

        {/* Main layout with three columns */}
        <div className="newtab-main">
          {/* Left column: Closed Tabs & History */}
          <div
            id="tour-search-history"
            className="newtab-column newtab-column-center"
          >
            <ClosedTabsPanel
              onSearchSubmit={handleSearchSubmit}
              activeMode={activeMode}
              onToggleSearchMode={toggleSearchMode}
              resolvingShopifyStore={resolvingShopifyStore}
            />
          </div>

          {/* Right columns: Quick Links & Bookmarks */}
          <div className="newtab-right-columns">
            <QuickLinksColumn id="tour-quick-links" />
            <BookmarksColumn id="tour-bookmarks" />
          </div>
        </div>
      </div>
    </div>
  );
}
