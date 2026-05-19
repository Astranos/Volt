import React, { useState, useEffect, useRef } from "react";
import { Command } from "cmdk";
import { TabManager, TabInfo } from "@/src/utils/tab-manager";
import { TabItem } from "../cmdk-palette/TabItem";
import { RecentTabTiles } from "./RecentTabTiles";
import { ScrollArea } from "@/src/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/src/components/ui/toggle-group";
import { Search as SearchIcon, Clock } from "lucide-react";
import { searchProviders } from "../cmdk-palette/SearchProviders";
import { type SearchMode } from "./NewTabHelp";
import "./closed-tabs-panel.css";

interface ClosedTabsPanelProps {
  onSearchSubmit?: (query: string) => void;
  activeMode?: SearchMode;
  onToggleSearchMode?: (mode: SearchMode) => void;
  resolvingShopifyStore?: boolean;
}

const SEARCH_MODE_OPTIONS: Array<{
  mode: SearchMode;
  label: string;
  id: string;
}> = [
  { mode: "google", label: "Google", id: "tour-search-google" },
  {
    mode: "pricecharting",
    label: "PriceCharting",
    id: "tour-search-pricecharting",
  },
  { mode: "barcodelookup", label: "UPC", id: "tour-search-upc" },
  { mode: "ebay", label: "eBay", id: "tour-search-ebay" },
  { mode: "shopify", label: "Shopify", id: "tour-search-shopify" },
];

const SEARCH_PREFIXES: Record<string, SearchMode> = {
  g: "google",
  p: "pricecharting",
  u: "barcodelookup",
  e: "ebay",
  s: "shopify",
};

function parseSearchPrefix(input: string): {
  mode: SearchMode | null;
  query: string;
} {
  const match = input.match(/^([a-z])\s+(.+)$/i);
  if (!match) {
    return { mode: null, query: input };
  }

  const mode = SEARCH_PREFIXES[match[1].toLowerCase()];
  if (!mode) {
    return { mode: null, query: input };
  }

  return { mode, query: match[2].trim() };
}

export function ClosedTabsPanel({
  onSearchSubmit,
  activeMode = "google",
  onToggleSearchMode,
  resolvingShopifyStore = false,
}: ClosedTabsPanelProps) {
  const [search, setSearch] = useState("");
  const [closedTabs, setClosedTabs] = useState<TabInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedValue, setSelectedValue] = useState<string>("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmedSearch = search.trim();
  const prefixedSearch = parseSearchPrefix(trimmedSearch);
  const displayedMode = prefixedSearch.mode ?? activeMode;
  const displayedQuery = prefixedSearch.mode ? prefixedSearch.query : trimmedSearch;

  // Treat clicks anywhere on the search row's padding/icon area as a
  // request to focus the input, except when they land on a real control.
  const focusInputFromRow = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target === inputRef.current) return;
    if (target.closest('button, input, [role="button"], a')) return;
    e.preventDefault();
    inputRef.current?.focus();
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const tabs = await TabManager.getClosedTabs();
      // Filter out newtab pages and empty URLs
      const filtered = tabs.filter(
        (tab) =>
          tab.url &&
          !tab.url.startsWith("chrome://newtab") &&
          !tab.url.startsWith("about:blank")
      );
      setClosedTabs(filtered);
    } finally {
      setLoading(false);
    }
  };

  const filteredTabs = TabManager.filterTabs(closedTabs, search);
  // Top tiles show the 4 most-recently-closed tabs, only when no search active.
  const showTiles = !trimmedSearch && closedTabs.length > 0;
  const topTiles = showTiles ? closedTabs.slice(0, 4) : [];
  const listTabs = showTiles ? closedTabs.slice(4) : filteredTabs;

  // Build a single intermixed list of closed tabs
  const combinedItems: Array<
    | { type: "tab"; tab: TabInfo; value: string }
  > = [
    ...listTabs.map((tab) => ({
      type: "tab" as const,
      tab,
      value: `tab-${tab.id}`,
    })),
  ];

  const getSearchProviderTitle = () => {
    if (displayedMode === "shopify") {
      return "Shopify (Available Inventory)";
    }

    const provider = searchProviders.find((p) => p.id === displayedMode);
    return provider?.name || "Google";
  };

  const getSearchPlaceholder = () => {
    switch (activeMode) {
      case "google":
        return "Search on Google";
      case "ebay":
        return "Search on eBay (sold prices)";
      case "pricecharting":
        return "Search on PriceCharting";
      case "barcodelookup":
        return "Search on BarcodeLookup (UPC)";
      case "shopify":
        return "Search on Shopify (inventory search)";
      default:
        return "Search closed tabs...";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Arrow key navigation is handled by CMDK
    }
  };

  const handleSearchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && onSearchSubmit) {
      e.preventDefault();
      onSearchSubmit(search);
    }
  };

  const handleSelect = async (value: string) => {
    if (value.startsWith("tab-")) {
      const sessionId = value.replace("tab-", "");
      restoreSession(sessionId);
    }
  };

  const restoreSession = (sessionId: string) => {
    // Get current tab ID to close it after restoration
    chrome.tabs.getCurrent(async (currentTab) => {
      await TabManager.restoreTab(sessionId, currentTab?.id);
    });
  };

  return (
    <div className="closed-tabs-panel">
      <div
        className="closed-tabs-search-container"
        onMouseDown={focusInputFromRow}
      >
        <div className="closed-tabs-search">
          <SearchIcon className="w-4 h-4 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            placeholder={getSearchPlaceholder()}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (listRef.current) {
                listRef.current.scrollTop = 0;
              }
            }}
            onKeyDown={handleSearchInputKeyDown}
            className="closed-tabs-search-input"
            autoFocus
            tabIndex={1}
          />
        </div>

        {/* Integrated search mode toggle */}
        <ToggleGroup
          type="single"
          value={displayedMode}
          onValueChange={(value) => {
            if (value) {
              onToggleSearchMode?.(
                value as
                  | "google"
                  | "ebay"
                  | "pricecharting"
                  | "barcodelookup"
                  | "shopify"
              );
            }
          }}
          className="closed-tabs-search-toggle"
        >
          {SEARCH_MODE_OPTIONS.map((option) => (
            <ToggleGroupItem
              key={option.mode}
              id={option.id}
              value={option.mode}
              size="sm"
              className="text-xs px-2"
              disabled={option.mode === "shopify" && resolvingShopifyStore}
            >
              <span>
                {option.mode === "shopify" && resolvingShopifyStore
                  ? "..."
                  : option.label}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <Command
        shouldFilter={false}
        filter={() => 1}
        onKeyDown={handleKeyDown}
        className="closed-tabs-command"
        value={selectedValue}
        onValueChange={setSelectedValue}
      >
        <ScrollArea className="flex-1">
          {showTiles && (
            <div id="tour-recent-tabs" className="closed-tabs-tiles-section">
              <div className="closed-tabs-section-label">
                <Clock className="w-3.5 h-3.5" />
                <span>Pick up where you left off</span>
                <span className="closed-tabs-section-hint">
                  Ctrl+Shift+Z reopens last tab
                </span>
              </div>
              <RecentTabTiles tabs={topTiles} onRestore={restoreSession} />
            </div>
          )}

          <Command.List className="closed-tabs-list" ref={listRef}>
            {loading ? (
              <div className="closed-tabs-loading">
                <p>Loading...</p>
              </div>
            ) : (
              <>
                {trimmedSearch && onSearchSubmit && (
                  <Command.Item
                    key="search-action"
                    value="search-action"
                    onSelect={() => onSearchSubmit(trimmedSearch)}
                    className="closed-tabs-item"
                  >
                    <div className="flex items-center gap-3 px-4 py-3 w-full">
                      <div className="p-2 rounded bg-gray-100">
                        <SearchIcon className="w-4 h-4 text-gray-500" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          Search for "{displayedQuery}" on{" "}
                          {getSearchProviderTitle()}
                        </p>
                        <p className="text-xs text-gray-500">
                          Press <kbd className="cmdk-kbd">Enter</kbd> to search
                        </p>
                      </div>
                      <div className="cmdk-item-kbd-hint">
                        <kbd className="cmdk-kbd">↵</kbd>
                      </div>
                    </div>
                  </Command.Item>
                )}

                {showTiles && combinedItems.length > 0 && (
                  <div
                    id="tour-earlier-today"
                    className="closed-tabs-section-label closed-tabs-section-label-inline"
                  >
                    <span>Earlier today</span>
                  </div>
                )}

                {combinedItems.length === 0 && !trimmedSearch && topTiles.length === 0 ? (
                  <Command.Empty className="closed-tabs-empty">
                    <p>No recently closed tabs found</p>
                  </Command.Empty>
                ) : (
                  // Single list of closed tabs
                  combinedItems.map((entry) => (
                    <Command.Item
                      key={entry.value}
                      value={entry.value}
                      onSelect={handleSelect}
                      className="closed-tabs-item"
                    >
                      <TabItem
                        tab={entry.tab}
                        kbdHintAction="Restore tab"
                        showRelativeTime
                      />
                    </Command.Item>
                  ))
                )}
              </>
            )}
          </Command.List>
        </ScrollArea>
      </Command>
    </div>
  );
}
