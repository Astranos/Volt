import { useEffect, useMemo, useState } from "react";
import { ClosedTabsPanel } from "../../src/components/newtab/ClosedTabsPanel";
import { QuickLinksColumn } from "../../src/components/newtab/QuickLinksColumn";
import { BookmarksColumn } from "../../src/components/newtab/BookmarksColumn";
import { HeroBlock } from "../../src/components/newtab/HeroBlock";
import type { SearchMode } from "../../src/components/newtab/NewTabHelp";
import { Button } from "../../src/components/ui/button";
import type { ScannerConnectionStatus } from "@volt/scanner-protocol";
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
import { Loader2, QrCode, Smartphone } from "lucide-react";
import { triggerSidepanelToolFromContentScript } from "../../src/lib/sidepanel-gesture";
import { searchProviders } from "../../src/components/cmdk-palette/SearchProviders";
import { TabManager } from "../../src/utils/tab-manager";
import type { SyncStorageResult } from "../../src/types/settings";
import { extractShopifyStoreName } from "../../src/domain/search";
import {
  parseSearchPrefix,
  resolveNewTabSearchIntent,
  type NewTabSearchMode,
} from "../../src/domain/search-intent";
import "../../src/components/cmdk-palette/styles.css";
import "../../src/components/newtab/column-styles.css";
import "../../src/components/newtab/closed-tabs-panel.css";
import "../../src/components/newtab/newtab-layout.css";

export default function NewTab() {
  const [activeMode, setActiveMode] = useState<SearchMode>("google");
  const [shopifyStore, setShopifyStore] = useState<string | null>(null);
  const [resolvingShopifyStore, setResolvingShopifyStore] = useState(false);
  const [overrideEnabled, setOverrideEnabled] = useState<boolean | null>(null);
  const [scannerStatus, setScannerStatus] =
    useState<ScannerConnectionStatus>("disconnected");

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
    if (
      typeof chrome === "undefined" ||
      !chrome.storage?.sync ||
      !chrome.tabs
    ) {
      // If we can't read settings or tabs, fall back to rendering Volt.
      setOverrideEnabled(true);
      return;
    }

    chrome.storage.sync.get(["cmdkSettings"], (result: SyncStorageResult) => {
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
      (result: {
        scout_shopify_store?: string;
        scout_search_mode?: SearchMode;
      }) => {
        if (result?.scout_shopify_store) {
          setShopifyStore(result.scout_shopify_store);
        }
        if (result?.scout_search_mode) {
          setActiveMode(result.scout_search_mode as SearchMode);
        }
      }
    );
  }, []);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime) return;

    chrome.runtime.sendMessage({ action: "scannerGetState" }, (response) => {
      if (chrome.runtime.lastError) return;
      if (response?.state?.status) {
        setScannerStatus(response.state.status as ScannerConnectionStatus);
      }
    });

    const listener = (message: any) => {
      if (message?.action !== "scannerStateChanged") return;
      if (message?.state?.status) {
        setScannerStatus(message.state.status as ScannerConnectionStatus);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
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

  const setSearchMode = (mode: SearchMode) => {
    setActiveMode(mode);
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ scout_search_mode: mode });
    }
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

  const openMobilePairingPopup = () => {
    if (typeof chrome === "undefined" || !chrome.runtime) return;
    chrome.runtime.sendMessage({
      action: "openMobileCapturePopup",
    });
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
      activeMode: activeMode as NewTabSearchMode,
      providers: searchProviders,
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

  if (overrideEnabled === false) {
    // Let the redirect effect take over; render nothing to avoid flicker.
    return null;
  }

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
            <MobilePairingStatus
              status={scannerStatus}
              onClick={openMobilePairingPopup}
            />
          </div>
        </header>

        {/* Hero: greeting + clock */}
        <HeroBlock />

        {/* Search + sidepanel tools */}
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

          <TooltipProvider>
            <div id="tour-tools" className="newtab-tool-tiles">
              {SIDEPANEL_TOOLS.map((tool) => {
                const Icon = tool.icon;
                return (
                  <Tooltip key={tool.id}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        onClick={() => handleSidepanelToolClick(tool.id)}
                        className="newtab-tool-tile cursor-pointer"
                        aria-label={tool.label}
                      >
                        <Icon className="newtab-tool-tile-icon" />
                        <span className="newtab-tool-tile-label">
                          {tool.label}
                        </span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="border-gray-200">
                      <p>{tool.description}</p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </TooltipProvider>
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

function MobilePairingStatus({
  onClick,
  status,
}: {
  onClick: () => void;
  status: ScannerConnectionStatus;
}) {
  const isPaired = status === "connected";
  const isCreating = status === "creating";
  const isReady = status === "waiting";
  const label = isPaired ? "Connected" : isCreating ? "Connecting" : isReady ? "Pair Phone" : "Connect Phone";
  const Icon = isPaired ? Smartphone : isCreating ? Loader2 : isReady ? QrCode : Smartphone;
  const tone = isPaired
    ? "is-paired"
    : isReady
      ? "is-ready"
      : isCreating
        ? "is-creating"
        : "is-inactive";

  return (
    <button
      type="button"
      className={`newtab-mobile-status ${tone}`}
      onClick={onClick}
      aria-label="Open mobile pairing"
      title="Open mobile pairing"
    >
      <Icon className={isCreating ? "animate-spin" : undefined} />
      <span>{label}</span>
    </button>
  );
}
