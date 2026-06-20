/* global chrome */
declare const chrome: any;

import React, { useEffect, useState, useRef } from "react";
import { Command } from "cmdk";
import { TabManager, TabInfo } from "@/src/utils/tab-manager";
import { fetchCSVLinks, filterCSVLinks, CSVLink } from "@/src/utils/csv-links";
import {
  getBookmarksFromMultipleFolders,
  filterBookmarks,
  Bookmark,
} from "@/src/utils/bookmarks";
import {
  getRecentHistory,
  filterHistory,
  HistoryItem,
} from "@/src/utils/history";
import {
  searchProviders,
  findProviderByTrigger,
  SearchProvider,
} from "./SearchProviders";
import { PaletteSourceGroups } from "./PaletteSourceGroups";
import {
  X,
  Search as SearchIcon,
  Gamepad2,
  Settings,
  ExternalLink,
  Boxes,
  Calculator,
  PanelRight,
  LayoutList,
} from "lucide-react";
import {
  SIDEPANEL_TOOLS,
  getToolLabel,
  type SidepanelToolId,
} from "@/src/lib/sidepanel-tools";
import { DEFAULT_SETTINGS, mergeSettings } from "@/src/domain/settings";
import {
  buildGoogleSearchUrl,
  getUrlFromInput,
} from "@/src/domain/search";
import { resolveProviderSearchIntent } from "@/src/domain/search-intent";
import "./styles.css";

interface LastAction {
  type: "search" | "url" | "tool" | "tab";
  value: string;
  label: string;
  timestamp: number;
  metadata?: any;
}

interface CMDKPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  noOverlay?: boolean; // When true, renders without the overlay wrapper (for popup use)
  defaultProviderId?: string;
  embedded?: boolean; // When true, renders just the content without any wrapper (for new tab use)
  ebayCondition?: string;
  onProviderChange?: (providerId: string | null) => void; // Callback when provider changes
}

export function CMDKPalette({
  isOpen,
  onClose,
  noOverlay = false,
  defaultProviderId,
  embedded = false,
  ebayCondition,
  onProviderChange,
}: CMDKPaletteProps) {
  const [search, setSearch] = useState("");
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [previousTabId, setPreviousTabId] = useState<number | null>(null);
  const [csvLinks, setCSVLinks] = useState<CSVLink[]>([]);
  const [csvLinksLoading, setCSVLinksLoading] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeProvider, setActiveProvider] = useState<SearchProvider | null>(
    null
  );
  const [providerQuery, setProviderQuery] = useState("");
  const [userNavigated, setUserNavigated] = useState(false);
  const [selectedValue, setSelectedValue] = useState<string>("");
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef(search);
  const providerQueryRef = useRef(providerQuery);
  const [enabledSources, setEnabledSources] = useState({
    ...DEFAULT_SETTINGS.enabledSources,
  });
  const [sourceOrder, setSourceOrder] = useState<string[]>([
    ...DEFAULT_SETTINGS.sourceOrder,
  ]);
  const trimmedSearch = search.trim();

  const previousTab =
    previousTabId !== null
      ? tabs.find((tab) => tab.id === previousTabId) ?? null
      : null;

  const showLastActionHint =
    !activeProvider && !trimmedSearch && Boolean(lastAction);

  useEffect(() => {
    // Load settings from chrome storage
    chrome.storage.sync.get(["cmdkSettings"], (result: any) => {
      if (result.cmdkSettings) {
        const merged = mergeSettings(result.cmdkSettings);
        setEnabledSources(merged.enabledSources);
        setSourceOrder(merged.sourceOrder);
      }
    });

    // Load last action
    chrome.storage.local.get(["cmdkLastAction"], (result: any) => {
      if (result.cmdkLastAction) {
        setLastAction(result.cmdkLastAction);
      }
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      if (enabledSources.tabs) loadTabs();
      if (enabledSources.quickLinks) loadCSVLinks();
      if (enabledSources.bookmarks) loadBookmarks();
      if (enabledSources.history) loadHistory();
      setSearch("");

      setProviderQuery("");
      setUserNavigated(false);
      setSelectedValue("");
    }
  }, [isOpen, enabledSources]);

  // Keep refs in sync with state
  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  useEffect(() => {
    providerQueryRef.current = providerQuery;
  }, [providerQuery]);

  // Separate effect for defaultProviderId to avoid clearing search when toggling providers
  useEffect(() => {
    if (isOpen) {
      if (defaultProviderId) {
        const provider = searchProviders.find(
          (p) => p.id === defaultProviderId
        );
        if (provider) {
          // Preserve current input value when activating a provider
          const currentSearch = searchRef.current;
          const currentProviderQuery = providerQueryRef.current;

          setActiveProvider((prevProvider) => {
            if (!prevProvider) {
              // Switching from no provider to a provider: move search to providerQuery
              if (currentSearch) {
                setProviderQuery(currentSearch);
              }
            } else {
              // Switching between providers: preserve providerQuery (already set, no action needed)
            }
            return provider;
          });
        } else {
          setActiveProvider(null);
        }
      } else {
        // When deactivating provider, preserve providerQuery in search if search is empty
        const currentProviderQuery = providerQueryRef.current;
        const currentSearch = searchRef.current;

        setActiveProvider((prevProvider) => {
          if (prevProvider && currentProviderQuery && !currentSearch) {
            setSearch(currentProviderQuery);
          }
          return null;
        });
      }
    }
  }, [defaultProviderId, isOpen]);

  const loadTabs = async () => {
    const [allTabs, prevTabId] = await Promise.all([
      TabManager.getAllTabs(),
      TabManager.getPreviousTab(),
    ]);
    const sorted = TabManager.sortTabs(allTabs);
    setTabs(sorted);
    setPreviousTabId(prevTabId);
  };

  const loadCSVLinks = async () => {
    const { links, isInitialLoad } = await fetchCSVLinks();
    // Only show loading skeleton on initial load (when no cache exists)
    if (isInitialLoad) {
      setCSVLinksLoading(true);
    }
    setCSVLinks(links);
    setCSVLinksLoading(false);
  };

  const loadBookmarks = async () => {
    // Get the selected folder IDs from settings
    chrome.storage.sync.get(["cmdkSettings"], async (result: any) => {
      const folderIds = result.cmdkSettings?.bookmarkFolderIds || [];
      const allBookmarks = await getBookmarksFromMultipleFolders(folderIds);
      setBookmarks(allBookmarks);
    });
  };

  const loadHistory = async () => {
    const recentHistory = await getRecentHistory(30);
    setHistory(recentHistory);
  };

  const handleValueChange = (value: string) => {
    setSearch(value);

    // Reset scroll position to top when search changes
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }

    // Check if user is typing a provider trigger
    if (!activeProvider) {
      const provider = findProviderByTrigger(value);
      if (provider && value.toLowerCase().trim() === provider.trigger[0]) {
        // Don't auto-activate, wait for Tab key
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Track arrow key navigation
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      setUserNavigated(true);
    }

    // Backspace to deactivate provider when query is empty
    if (e.key === "Backspace" && activeProvider && providerQuery === "") {
      e.preventDefault();
      setActiveProvider(null);
      setProviderQuery("");
      setSearch("");
      onProviderChange?.(null);
    }

    // Tab key to activate provider
    if (e.key === "Tab" && !activeProvider) {
      const provider = findProviderByTrigger(search);
      if (provider) {
        e.preventDefault();
        // If the user typed the trigger followed by a query, preserve the remainder
        const lower = search.toLowerCase().trim();
        const matchedTrigger =
          provider.trigger.find((t) => lower.startsWith(t)) || "";
        const remainder = matchedTrigger
          ? search.slice(matchedTrigger.length).trim()
          : "";
        setActiveProvider(provider);
        setProviderQuery(remainder);
        setSearch("");
        onProviderChange?.(provider.id);
      }
    }

    // Escape to close or deactivate provider
    if (e.key === "Escape") {
      if (activeProvider) {
        setActiveProvider(null);
        setProviderQuery("");
        setSearch("");
        onProviderChange?.(null);
      } else {
        onClose();
      }
    }
  };

  const handleSelect = async (value: string) => {
    if (value.startsWith("tab-")) {
      const tabId = parseInt(value.replace("tab-", ""));

      // Save as last action
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        const action: LastAction = {
          type: "tab",
          value: value,
          label: tab.title || tab.url,
          timestamp: Date.now(),
        };
        chrome.storage.local.set({ cmdkLastAction: action });
      }

      await TabManager.switchToTab(tabId);
      onClose();
    } else if (value.startsWith("provider-switch-")) {
      // Handle switching between providers when one is already active
      const providerId = value.replace("provider-switch-", "");
      const provider = searchProviders.find((p) => p.id === providerId);
      if (provider) {
        // When switching providers, preserve the current query if one exists
        const currentQuery = activeProvider ? providerQuery : "";
        setActiveProvider(provider);
        setProviderQuery(currentQuery);
        setSearch("");
        onProviderChange?.(providerId);
      }
    } else if (value.startsWith("provider-")) {
      const providerId = value.replace("provider-", "");
      const provider = searchProviders.find((p) => p.id === providerId);
      if (provider) {
        // When switching providers, preserve the current query if one exists
        const currentQuery = activeProvider ? providerQuery : "";
        setActiveProvider(provider);
        setProviderQuery(currentQuery);
        setSearch("");
        onProviderChange?.(providerId);
      }
    } else if (value.startsWith("csv-link-")) {
      const linkId = value;
      const link = csvLinks.find((l) => l.id === linkId);
      if (link) {
        // Save as last action
        const action: LastAction = {
          type: "url",
          value: value,
          label: link.title,
          timestamp: Date.now(),
        };
        chrome.storage.local.set({ cmdkLastAction: action });

        if (embedded) {
          await TabManager.updateCurrentTab(link.url);
        } else {
          await TabManager.openNewTab(link.url);
        }
        onClose();
      }
    } else if (value.startsWith("bookmark-")) {
      const bookmarkId = value.replace("bookmark-", "");
      const bookmark = bookmarks.find((b) => b.id === bookmarkId);
      if (bookmark) {
        // Save as last action
        const action: LastAction = {
          type: "url",
          value: value,
          label: bookmark.title,
          timestamp: Date.now(),
        };
        chrome.storage.local.set({ cmdkLastAction: action });

        if (embedded) {
          await TabManager.updateCurrentTab(bookmark.url);
        } else {
          await TabManager.openNewTab(bookmark.url);
        }
        onClose();
      }
    } else if (value.startsWith("history-")) {
      const historyId = value.replace("history-", "");
      const historyItem = history.find((h) => h.id === historyId);
      if (historyItem) {
        // Save as last action
        const action: LastAction = {
          type: "url",
          value: value,
          label: historyItem.title || historyItem.url,
          timestamp: Date.now(),
        };
        chrome.storage.local.set({ cmdkLastAction: action });

        if (embedded) {
          await TabManager.updateCurrentTab(historyItem.url);
        } else {
          await TabManager.openNewTab(historyItem.url);
        }
        onClose();
      }
    } else if (value.startsWith("tool-")) {
      const toolId = value.replace("tool-", "");
      if (toolId === "mobile-scanner") {
        try {
          const response = await new Promise<any>((resolve) => {
            try {
              chrome.runtime.sendMessage(
                { action: "openInSidebar", tool: "mobile-scanner" },
                (resp: any) => resolve(resp)
              );
            } catch (err) {
              resolve({ success: false, error: String(err) });
            }
          });
          if (!response?.success && chrome.runtime.lastError) {
            console.error("Error opening sidebar:", chrome.runtime.lastError);
          }
        } finally {
          onClose();
        }
      }
    }
  };

  const handleSearchSubmit = async () => {
    if (activeProvider && providerQuery.trim()) {
      console.log("[CMDK] Opening search in new tab:", {
        provider: activeProvider.name,
        query: providerQuery,
      });
      const intent = resolveProviderSearchIntent(activeProvider, providerQuery, {
        ebayCondition,
      });
      if (!intent || intent.kind !== "search-provider") return;

      console.log("[CMDK] Search URL:", intent.url);

      // Save as last action
      const action: LastAction = {
        type: "search",
        value: providerQuery,
        label: `${providerQuery} (${activeProvider.name})`,
        timestamp: Date.now(),
        metadata: {
          providerId: activeProvider.id,
          ebayCondition:
            activeProvider.id === "ebay" ? ebayCondition : undefined,
        },
      };
      chrome.storage.local.set({ cmdkLastAction: action });

      if (embedded) {
        await TabManager.updateCurrentTab(intent.url);
      } else {
        await TabManager.openNewTab(intent.url);
      }
      onClose();
    } else if (!trimmedSearch && !activeProvider) {
      // Empty input + Enter = repeat last action if available, otherwise go back to previous tab
      if (lastAction) {
        if (lastAction.type === "search" && lastAction.metadata?.providerId) {
          const provider = searchProviders.find(
            (p) => p.id === lastAction.metadata.providerId
          );
          if (provider) {
            setActiveProvider(provider);
            setProviderQuery(lastAction.value);
            // Trigger search immediately
            setTimeout(() => handleSearchSubmit(), 0);
            return;
          }
        } else {
          handleSelect(lastAction.value);
          return;
        }
      }

      console.log("[CMDK] Returning to previous tab");
      const previousTabId = await TabManager.getPreviousTab();
      if (previousTabId) {
        await TabManager.switchToTab(previousTabId);
      }
      onClose();
    }
  };

  const filteredTabs =
    activeProvider || !enabledSources.tabs
      ? []
      : TabManager.filterTabs(tabs, search)
          .filter((tab) => !tab.active) // Exclude currently opened tabs
          .filter((tab) => !showLastActionHint || tab.id !== previousTabId);
  const filteredCSVLinks =
    activeProvider || !enabledSources.quickLinks
      ? []
      : filterCSVLinks(csvLinks, search);
  const filteredBookmarks =
    activeProvider || !enabledSources.bookmarks
      ? []
      : filterBookmarks(bookmarks, search);
  const filteredHistory =
    activeProvider || !enabledSources.history
      ? []
      : filterHistory(history, search);

  // Filter tools by search (only show specific tools in command palette)
  const commandPaletteToolIds: SidepanelToolId[] = ["mobile-scanner"];

  const filteredTools =
    activeProvider || !enabledSources.tools
      ? []
      : SIDEPANEL_TOOLS.filter(
          (tool) =>
            commandPaletteToolIds.includes(tool.id) &&
            (!trimmedSearch ||
              tool.label.toLowerCase().includes(trimmedSearch.toLowerCase()) ||
              tool.description
                .toLowerCase()
                .includes(trimmedSearch.toLowerCase()))
        );

  const openUrlAndClose = async (url: string) => {
    try {
      if (embedded) {
        await TabManager.updateCurrentTab(url);
      } else {
        await TabManager.openNewTab(url);
      }
    } finally {
      onClose();
    }
  };

  const openGoogleSearch = async (query: string) => {
    await openUrlAndClose(buildGoogleSearchUrl(query));
  };

  const openSettings = async () => {
    // Open settings page in a new tab
    const optionsUrl = chrome.runtime.getURL("options.html");
    if (embedded) {
      await TabManager.updateCurrentTab(optionsUrl);
    } else {
      await TabManager.openNewTab(optionsUrl);
    }
    onClose();
  };

  const toggleSidepanel = async () => {
    // Send message to toggle sidepanel
    try {
      await new Promise<any>((resolve) => {
        try {
          chrome.runtime.sendMessage(
            { action: "toggleSidepanelTool" },
            (resp: any) => resolve(resp)
          );
        } catch (err) {
          resolve({ success: false, error: String(err) });
        }
      });
    } finally {
      onClose();
    }
  };

  const executeLastAction = () => {
    if (!lastAction) return;

    if (lastAction.type === "search" && lastAction.metadata?.providerId) {
      const provider = searchProviders.find(
        (p) => p.id === lastAction.metadata.providerId
      );
      if (provider) {
        setActiveProvider(provider);
        setProviderQuery(lastAction.value);
        // We can't easily auto-submit here without state update, so we just prep the search
        // Or we could call handleSearchSubmit after a timeout, but user might want to edit
      }
    } else {
      handleSelect(lastAction.value);
    }
  };

  // Check if there are any visible items
  const hasVisibleItems =
    filteredTabs.length > 0 ||
    filteredCSVLinks.length > 0 ||
    filteredTools.length > 0 ||
    filteredBookmarks.length > 0 ||
    filteredHistory.length > 0;

  if (!isOpen) return null;

  // Set initial selected value when previous action is shown
  useEffect(() => {
    if (isOpen && showLastActionHint && lastAction && !selectedValue) {
      if (lastAction.type === "search") {
        // For search, we don't have a direct value in the list unless we add a special item
        // But we'll add a special item for last action
        setSelectedValue("last-action");
      } else {
        setSelectedValue(lastAction.value);
      }
    }
  }, [isOpen, showLastActionHint, lastAction, selectedValue]);

  const content = (
    <Command
      shouldFilter={false}
      filter={() => 1}
      onKeyDown={handleKeyDown}
      className="cmdk-root"
      value={selectedValue}
      onValueChange={setSelectedValue}
    >
      <div className="cmdk-input-wrapper">
        {activeProvider && (
          <div className={`cmdk-provider-badge ${activeProvider.color}`}>
            <activeProvider.icon className="w-3 h-3 text-white" />
            <span className="text-xs font-medium text-white">
              {activeProvider.name}
            </span>
            <button
              onClick={() => {
                setActiveProvider(null);
                setProviderQuery("");
                onProviderChange?.(null);
              }}
              className="ml-1 hover:bg-white/20 rounded p-0.5"
            >
              <X className="w-3 h-3 text-white" />
            </button>
          </div>
        )}
        <div className="cmdk-input-shell">
          <Command.Input
            value={activeProvider ? providerQuery : search}
            onValueChange={
              activeProvider ? setProviderQuery : handleValueChange
            }
            placeholder={
              activeProvider
                ? `Search ${activeProvider.name}...`
                : showLastActionHint
                ? `Press Enter to ${
                    lastAction?.type === "search" ? "search" : "open"
                  } "${lastAction?.label}"...`
                : "Search tabs or type a command..."
            }
            className="cmdk-input"
            autoFocus
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") {
                // Only handle Enter for search providers or empty searches WITHOUT user navigation
                if (activeProvider && providerQuery.trim()) {
                  e.preventDefault();
                  handleSearchSubmit();
                } else if (
                  !trimmedSearch &&
                  !activeProvider &&
                  !userNavigated
                ) {
                  // Empty input with no arrow key navigation - go to previous tab
                  e.preventDefault();
                  handleSearchSubmit();
                } else if (!activeProvider && trimmedSearch) {
                  const urlCandidate = getUrlFromInput(trimmedSearch);
                  if (urlCandidate) {
                    e.preventDefault();
                    void openUrlAndClose(urlCandidate);
                    return;
                  }

                  if (!hasVisibleItems) {
                    e.preventDefault();
                    void openGoogleSearch(trimmedSearch);
                  }
                }
                // Otherwise, let CMDK's default Enter behavior select the highlighted item
              }
            }}
          />
        </div>
        {!trimmedSearch && !activeProvider && (
          <div className="flex gap-2">
            <button
              onClick={toggleSidepanel}
              className="cmdk-settings-button"
              title="Toggle Sidepanel"
            >
              <PanelRight className="w-4 h-4" />
            </button>
            <button
              onClick={openSettings}
              className="cmdk-settings-button"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <Command.List className="cmdk-list" ref={listRef}>
        <Command.Empty className="cmdk-empty">
          <div className="flex flex-col items-center justify-center py-8 px-4">
            <SearchIcon className="w-12 h-12 text-gray-300 mb-3" />
            <p className="text-sm font-medium text-gray-500 mb-1">
              No results found
            </p>
            <p className="text-xs text-gray-400">
              {trimmedSearch ? (
                <>
                  Press <kbd className="cmdk-kbd">Enter</kbd> to search Google
                  or open the typed URL.
                </>
              ) : (
                "Try a different search term"
              )}
            </p>
          </div>
        </Command.Empty>

        {activeProvider && (
          <>
            {/* Show all search providers when one is active - for switching */}
            <Command.Group heading="Search Providers" className="cmdk-group">
              {searchProviders
                .filter((p: SearchProvider) => !p.hideInSwitcher)
                .map((provider: SearchProvider) => (
                  <Command.Item
                    key={provider.id}
                    value={`provider-switch-${provider.id}`}
                    onSelect={handleSelect}
                    keywords={[provider.name, ...provider.trigger]}
                    className="cmdk-item"
                  >
                    <div className="flex items-center gap-3 px-4 py-3">
                      <div className={`p-2 rounded ${provider.color}`}>
                        <provider.icon className="w-4 h-4 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {provider.name}
                          {provider.id === activeProvider?.id && (
                            <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                              Active
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500">
                          {provider.id === activeProvider?.id ? (
                            <>
                              Press <kbd className="cmdk-kbd">Enter</kbd> to
                              search
                            </>
                          ) : (
                            "Click to switch"
                          )}
                        </p>
                      </div>
                    </div>
                  </Command.Item>
                ))}
            </Command.Group>
          </>
        )}

        {!activeProvider && (
          <>
            {/* Previous Action - shown as first option when no search */}
            {showLastActionHint && lastAction && (
              <Command.Group heading="Previous Action" className="cmdk-group">
                <Command.Item
                  key="last-action"
                  value={
                    lastAction.type === "search"
                      ? "last-action"
                      : lastAction.value
                  }
                  onSelect={() => executeLastAction()}
                  className="cmdk-item"
                >
                  <div className="flex items-center gap-3 px-4 py-3 w-full">
                    <div className="p-2 rounded bg-gray-100">
                      {lastAction.type === "search" ? (
                        <SearchIcon className="w-4 h-4 text-gray-500" />
                      ) : lastAction.type === "tool" ? (
                        <PanelRight className="w-4 h-4 text-gray-500" />
                      ) : lastAction.type === "tab" ? (
                        <LayoutList className="w-4 h-4 text-gray-500" />
                      ) : (
                        <ExternalLink className="w-4 h-4 text-gray-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {lastAction.label}
                      </p>
                      <p className="text-xs text-gray-500">
                        {lastAction.type === "search"
                          ? "Search again"
                          : "Open again"}
                      </p>
                    </div>
                    <div className="cmdk-item-kbd-hint">
                      <kbd className="cmdk-kbd">↵</kbd>
                    </div>
                  </div>
                </Command.Item>
              </Command.Group>
            )}

            <PaletteSourceGroups
              sourceOrder={sourceOrder}
              trimmedSearch={trimmedSearch}
              search={search}
              enabledSearchProviders={enabledSources.searchProviders}
              csvLinksLoading={csvLinksLoading}
              filteredTabs={filteredTabs}
              filteredCSVLinks={filteredCSVLinks}
              filteredTools={filteredTools}
              filteredBookmarks={filteredBookmarks}
              filteredHistory={filteredHistory}
              onSelect={handleSelect}
            />
          </>
        )}
      </Command.List>
    </Command>
  );

  if (embedded) {
    return content;
  }

  if (noOverlay) {
    return (
      <div
        className="cmdk-container cmdk-fullscreen"
        style={{
          height: "100vh",
          maxHeight: "100vh",
          width: "100vw",
          maxWidth: "100vw",
          borderRadius: 0,
          boxShadow: "none",
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 999999,
        }}
      >
        {content}
      </div>
    );
  }

  return (
    <div className="cmdk-overlay" onClick={onClose}>
      <div className="cmdk-container" onClick={(e) => e.stopPropagation()}>
        {content}
      </div>
    </div>
  );
}
