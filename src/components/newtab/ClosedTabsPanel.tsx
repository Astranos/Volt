import React, { useState, useEffect, useRef } from "react";
import { Command } from "cmdk";
import { TabManager, TabInfo } from "@/src/utils/tab-manager";
import { TabItem } from "../cmdk-palette/TabItem";
import { ScrollArea } from "@/src/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/src/components/ui/toggle-group";
import { Search as SearchIcon } from "lucide-react";
import { searchProviders } from "../cmdk-palette/SearchProviders";
import { type SearchMode } from "./NewTabHelp";
import "./closed-tabs-panel.css";

interface ClosedTabsPanelProps {
  onSearchSubmit?: (query: string) => void;
  activeMode?: SearchMode;
  onToggleSearchMode?: (mode: SearchMode) => void;
  resolvingShopifyStore?: boolean;
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
  const trimmedSearch = search.trim();

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

  // Build a single intermixed list of closed tabs
  const combinedItems: Array<
    | { type: "tab"; tab: TabInfo; value: string }
  > = [
    ...filteredTabs.map((tab) => ({
      type: "tab" as const,
      tab,
      value: `tab-${tab.id}`,
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
        return "Search closed tabs...";
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      // Arrow key navigation is handled by CMDK
    }
  };

  const handleSelect = async (value: string) => {
    if (value.startsWith("tab-")) {
      const sessionId = value.replace("tab-", "");

      // Get current tab ID to close it after restoration
      chrome.tabs.getCurrent(async (currentTab) => {
        await TabManager.restoreTab(sessionId, currentTab?.id);
      });
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
          <ToggleGroupItem
            id="tour-search-google"
            value="google"
            size="sm"
            className="text-xs px-2"
          >
            Google
          </ToggleGroupItem>
          <ToggleGroupItem
            id="tour-search-pricecharting"
            value="pricecharting"
            size="sm"
            className="text-xs px-2"
          >
            PriceCharting
          </ToggleGroupItem>
          <ToggleGroupItem
            id="tour-search-upc"
            value="barcodelookup"
            size="sm"
            className="text-xs px-2"
          >
            UPC
          </ToggleGroupItem>
          <ToggleGroupItem
            id="tour-search-ebay"
            value="ebay"
            size="sm"
            className="text-xs px-2"
          >
            eBay
          </ToggleGroupItem>
          <ToggleGroupItem
            id="tour-search-shopify"
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
