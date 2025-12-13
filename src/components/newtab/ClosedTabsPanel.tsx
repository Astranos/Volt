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
import { Search as SearchIcon } from "lucide-react";
import "./closed-tabs-panel.css";

export function ClosedTabsPanel() {
  const [search, setSearch] = useState("");
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedValue, setSelectedValue] = useState<string>("");
  const listRef = useRef<HTMLDivElement>(null);

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

  const filteredTabs = TabManager.filterTabs(tabs, search);
  const filteredHistory = filterHistory(history, search);

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
      <div className="closed-tabs-search">
        <SearchIcon className="w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search tabs and history..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (listRef.current) {
              listRef.current.scrollTop = 0;
            }
          }}
          className="closed-tabs-search-input"
          autoFocus
        />
      </div>

      <Command
        shouldFilter={false}
        filter={() => 1}
        onKeyDown={handleKeyDown}
        className="closed-tabs-command"
        value={selectedValue}
        onValueChange={setSelectedValue}
      >
        <Command.List className="closed-tabs-list" ref={listRef}>
          {loading ? (
            <div className="closed-tabs-loading">
              <p>Loading...</p>
            </div>
          ) : filteredTabs.length === 0 && filteredHistory.length === 0 ? (
            <Command.Empty className="closed-tabs-empty">
              <p>No tabs or history found</p>
            </Command.Empty>
          ) : (
            <>
              {/* Closed Tabs Section */}
              {filteredTabs.length > 0 && (
                <Command.Group heading="Tabs" className="closed-tabs-group">
                  {filteredTabs.map((tab) => (
                    <Command.Item
                      key={tab.id}
                      value={`tab-${tab.id}`}
                      onSelect={handleSelect}
                      className="closed-tabs-item"
                    >
                      <TabItem tab={tab} kbdHintAction="Switch to tab" />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {/* History Section */}
              {filteredHistory.length > 0 && (
                <Command.Group
                  heading="Recent History"
                  className="closed-tabs-group"
                >
                  {filteredHistory.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={`history-${item.id}`}
                      onSelect={handleSelect}
                      className="closed-tabs-item"
                    >
                      <HistoryItemComponent
                        item={item}
                        kbdHintAction="Open"
                      />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
