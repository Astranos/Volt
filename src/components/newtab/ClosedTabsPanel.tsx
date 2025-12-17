import React, { useState, useEffect, useRef } from "react";
import { Command } from "cmdk";
import { TabManager, TabInfo } from "@/src/utils/tab-manager";
import {
  getRecentHistory,
  filterHistory,
  HistoryItem,
} from "@/src/utils/history";
import { TabItem } from "../cmdk-palette/TabItem";
import { HistoryItemComponent } from "../cmdk-palette/HistoryItem";
import { ScrollArea } from "@/src/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/src/components/ui/toggle-group";
import { Search as SearchIcon } from "lucide-react";
import { searchProviders } from "../cmdk-palette/SearchProviders";
import "./closed-tabs-panel.css";

interface ClosedTabsPanelProps {
  onSearchSubmit?: (query: string) => void;
  activeMode?:
    | "google"
    | "ebay"
    | "pricecharting"
    | "barcodelookup"
    | "shopify";
  onToggleSearchMode?: (
    mode: "google" | "ebay" | "pricecharting" | "barcodelookup" | "shopify"
  ) => void;
  resolvingShopifyStore?: boolean;
}

export function ClosedTabsPanel({
  onSearchSubmit,
  activeMode = "google",
  onToggleSearchMode,
  resolvingShopifyStore = false,
}: ClosedTabsPanelProps) {
  const [search, setSearch] = useState("");
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedValue, setSelectedValue] = useState<string>("");
  const listRef = useRef<HTMLDivElement>(null);
  const trimmedSearch = search.trim();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [allTabs, recentHistory] = await Promise.all([
        TabManager.getAllTabs(),
        getRecentHistory(30),
      ]);
      const sorted = TabManager.sortTabs(allTabs);
      setTabs(sorted);
      setHistory(recentHistory);
    } finally {
      setLoading(false);
    }
  };

  // Filter out all currently open tabs (only show closed tabs)
  // Since getAllTabs() returns all open tabs, we exclude them all
  const closedTabs: TabInfo[] = [];
  const filteredTabs = TabManager.filterTabs(closedTabs, search);
  const filteredHistory = filterHistory(history, search);

  // Build a single intermixed list of closed tabs and history items
  const combinedItems: Array<
    | { type: "tab"; tab: TabInfo; value: string }
    | { type: "history"; item: HistoryItem; value: string }
  > = [
    ...filteredTabs.map((tab) => ({
      type: "tab" as const,
      tab,
      value: `tab-${tab.id}`,
    })),
    ...filteredHistory.map((item) => ({
      type: "history" as const,
      item,
      value: `history-${item.id}`,
    })),
  ];

  const getSearchProviderTitle = () => {
    if (activeMode === "shopify") {
      return "Shopify (Available Inventory)";
    }

    const provider = searchProviders.find((p) => p.id === activeMode);
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
        return "Search tabs and history...";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Arrow key navigation is handled by CMDK
    }
  };

  const handleSelect = async (value: string) => {
    if (value.startsWith("tab-")) {
      const tabId = parseInt(value.replace("tab-", ""));
      await TabManager.switchToTab(tabId);
    } else if (value.startsWith("history-")) {
      const historyId = value.replace("history-", "");
      const historyItem = history.find((h) => h.id === historyId);
      if (historyItem) {
        // Update current tab to history URL
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]) {
            chrome.tabs.update(tabs[0].id, { url: historyItem.url });
          }
        });
      }
    }
  };

  return (
    <div className="closed-tabs-panel">
      <div className="closed-tabs-search-container">
        <div className="closed-tabs-search">
          <SearchIcon className="w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={getSearchPlaceholder()}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (listRef.current) {
                listRef.current.scrollTop = 0;
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && onSearchSubmit) {
                e.preventDefault();
                onSearchSubmit(search);
              }
            }}
            className="closed-tabs-search-input"
            autoFocus
          />
        </div>

        {/* Integrated search mode toggle */}
        <ToggleGroup
          type="single"
          value={activeMode}
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
          <ToggleGroupItem value="google" size="sm" className="text-xs px-2">
            Google
          </ToggleGroupItem>
          <ToggleGroupItem
            value="pricecharting"
            size="sm"
            className="text-xs px-2"
          >
            PriceCharting
          </ToggleGroupItem>
          <ToggleGroupItem
            value="barcodelookup"
            size="sm"
            className="text-xs px-2"
          >
            UPC
          </ToggleGroupItem>
          <ToggleGroupItem value="ebay" size="sm" className="text-xs px-2">
            eBay
          </ToggleGroupItem>
          <ToggleGroupItem
            value="shopify"
            size="sm"
            className="text-xs px-2"
            disabled={resolvingShopifyStore}
          >
            {resolvingShopifyStore ? "..." : "Shopify"}
          </ToggleGroupItem>
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
                          Search for "{trimmedSearch}" on{" "}
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

                {combinedItems.length === 0 && !trimmedSearch ? (
                  <Command.Empty className="closed-tabs-empty">
                    <p>No tabs or history found</p>
                  </Command.Empty>
                ) : (
                  // Single intermixed list of closed tabs and history items
                  combinedItems.map((entry) =>
                    entry.type === "tab" ? (
                      <Command.Item
                        key={entry.value}
                        value={entry.value}
                        onSelect={handleSelect}
                        className="closed-tabs-item"
                      >
                        <TabItem
                          tab={entry.tab}
                          kbdHintAction="Switch to tab"
                        />
                      </Command.Item>
                    ) : (
                      <Command.Item
                        key={entry.value}
                        value={entry.value}
                        onSelect={handleSelect}
                        className="closed-tabs-item"
                      >
                        <HistoryItemComponent
                          item={entry.item}
                          kbdHintAction="Open"
                        />
                      </Command.Item>
                    )
                  )
                )}
              </>
            )}
          </Command.List>
        </ScrollArea>
      </Command>
    </div>
  );
}
