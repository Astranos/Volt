import React, { useState, useEffect, useRef } from "react";
import SidepanelLayout from "./SidepanelLayout";
import { Search, X, ExternalLink, Clock } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";

type ConditionType = "new" | "used" | "broken" | null;

interface SearchHistory {
  id: string;
  query: string;
  timestamp: number;
  url: string;
  condition: ConditionType;
}

export default function EbaySoldTool() {
  const [query, setQuery] = useState("");
  const [condition, setCondition] = useState<ConditionType>(null);
  const [searchHistory, setSearchHistory] = useState<SearchHistory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeEbayTabId, setActiveEbayTabId] = useState<number | null>(null);

  // Load search history on mount
  useEffect(() => {
    const saved = localStorage.getItem("scout_ebay_search_history");
    if (saved) {
      try {
        setSearchHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse search history", e);
      }
    }
  }, []);

  const findOrCreateEbayTab = async (url: string) => {
    // First check if we have a tracked eBay tab that still exists
    if (activeEbayTabId) {
      try {
        const tab = await chrome.tabs.get(activeEbayTabId);
        if (tab && tab.url?.includes("ebay.")) {
          await chrome.tabs.update(activeEbayTabId, { url, active: true });
          return activeEbayTabId;
        }
      } catch {
        // Tab no longer exists
        setActiveEbayTabId(null);
      }
    }

    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    // If active tab is already eBay, use it
    if (activeTab?.id && activeTab.url?.includes("ebay.")) {
      setActiveEbayTabId(activeTab.id);
      await chrome.tabs.update(activeTab.id, { url });
      return activeTab.id;
    }

    // Otherwise, create a new tab
    const newTab = await chrome.tabs.create({ url, active: true });
    if (!newTab.id) {
      throw new Error("Failed to create new eBay tab");
    }
    setActiveEbayTabId(newTab.id);
    return newTab.id;
  };

  const buildEbayUrl = (
    searchQuery: string,
    searchCondition: ConditionType
  ) => {
    const baseUrl = "https://www.ebay.com/sch/i.html";
    const params = new URLSearchParams();

    if (searchQuery) params.append("_nkw", searchQuery);
    params.append("_sacat", "0"); // All Categories
    params.append("_from", "R40");
    params.append("_dmd", "2"); // View All?
    params.append("rt", "nc");

    // Always include sold and completed
    params.append("LH_Sold", "1");
    params.append("LH_Complete", "1");

    // Handle single condition filter
    if (searchCondition === "new") {
      params.append("LH_ItemCondition", "1000");
    } else if (searchCondition === "used") {
      params.append("LH_ItemCondition", "3000");
    } else if (searchCondition === "broken") {
      params.append("LH_ItemCondition", "7000");
    }

    return `${baseUrl}?${params.toString()}`;
  };

  const toggleCondition = async (key: ConditionType) => {
    const newCondition = condition === key ? null : key;
    setCondition(newCondition);

    // Auto-update the eBay tab if we have an active search
    if (query.trim() && activeEbayTabId) {
      try {
        const url = buildEbayUrl(query, newCondition);
        await chrome.tabs.update(activeEbayTabId, { url });
      } catch {
        // Tab may no longer exist, that's okay
        setActiveEbayTabId(null);
      }
    }
  };

  const handleSearch = async () => {
    if (!query.trim()) {
      setError("Please enter a search query");
      return;
    }

    setError(null);
    try {
      const url = buildEbayUrl(query, condition);

      // Save to history
      const newHistory: SearchHistory = {
        id: Date.now().toString(),
        query: query.trim(),
        timestamp: Date.now(),
        url,
        condition,
      };

      const updatedHistory = [newHistory, ...searchHistory.slice(0, 19)]; // Keep last 20
      setSearchHistory(updatedHistory);
      localStorage.setItem(
        "scout_ebay_search_history",
        JSON.stringify(updatedHistory)
      );

      // Navigate or create tab
      await findOrCreateEbayTab(url);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to navigate to eBay");
    }
  };

  const loadSearchFromHistory = async (historyItem: SearchHistory) => {
    setError(null);
    try {
      await findOrCreateEbayTab(historyItem.url);
      setQuery(historyItem.query);
      setCondition(historyItem.condition);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load search");
    }
  };

  const clearHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem("scout_ebay_search_history");
  };

  const removeHistoryItem = (id: string) => {
    const updatedHistory = searchHistory.filter((item) => item.id !== id);
    setSearchHistory(updatedHistory);
    localStorage.setItem(
      "scout_ebay_search_history",
      JSON.stringify(updatedHistory)
    );
  };

  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <SidepanelLayout className="h-full flex flex-col">
      <div className="p-4 space-y-4 border-b">
        {/* Full width search input */}
        <div className="relative">
          <Input
            placeholder="Search eBay sold listings..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSearch();
              }
            }}
            className="pr-10"
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={handleSearch}
            className="absolute right-1 top-1/2 -translate-y-1/2 h-8 w-8"
            title="Search eBay"
          >
            <Search className="h-4 w-4" />
          </Button>
        </div>

        {/* Condition toggle badges */}
        <div className="flex gap-2">
          <Badge
            variant={condition === "new" ? "default" : "outline"}
            className={cn(
              "cursor-pointer transition-colors",
              condition === "new" && "bg-green-600 hover:bg-green-700"
            )}
            onClick={() => toggleCondition("new")}
          >
            New
          </Badge>
          <Badge
            variant={condition === "used" ? "default" : "outline"}
            className={cn(
              "cursor-pointer transition-colors",
              condition === "used" && "bg-blue-600 hover:bg-blue-700"
            )}
            onClick={() => toggleCondition("used")}
          >
            Used
          </Badge>
          <Badge
            variant={condition === "broken" ? "default" : "outline"}
            className={cn(
              "cursor-pointer transition-colors",
              condition === "broken" && "bg-orange-600 hover:bg-orange-700"
            )}
            onClick={() => toggleCondition("broken")}
          >
            Broken
          </Badge>
        </div>

        {error && (
          <div className="text-xs text-destructive bg-destructive/10 p-2 rounded">
            {error}
          </div>
        )}
      </div>

      {/* Search History */}
      <div className="flex-1 overflow-y-auto p-4">
        {searchHistory.length > 0 ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">Search History</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearHistory}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            </div>

            <div className="space-y-2">
              {searchHistory.map((item) => (
                <Card
                  key={item.id}
                  className="group hover:border-primary transition-colors"
                >
                  <button
                    onClick={() => loadSearchFromHistory(item)}
                    className="w-full p-3 text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm line-clamp-2 group-hover:text-primary transition-colors">
                          {item.query}
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {formatTimestamp(item.timestamp)}
                          </span>
                        </div>
                        {item.condition && (
                          <div className="flex gap-1 mt-2">
                            <span
                              className={cn(
                                "text-xs px-2 py-0.5 rounded",
                                item.condition === "new" &&
                                  "bg-green-100 text-green-700",
                                item.condition === "used" &&
                                  "bg-blue-100 text-blue-700",
                                item.condition === "broken" &&
                                  "bg-orange-100 text-orange-700"
                              )}
                            >
                              {item.condition.charAt(0).toUpperCase() +
                                item.condition.slice(1)}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeHistoryItem(item.id);
                          }}
                          title="Remove"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                        <ExternalLink className="h-4 w-4 text-muted-foreground mt-2" />
                      </div>
                    </div>
                  </button>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-8 text-sm space-y-2">
            <div className="flex justify-center mb-2">
              <Search className="h-10 w-10 opacity-20" />
            </div>
            <p>No search history yet.</p>
            <p>Enter a search query above to find sold items on eBay.</p>
          </div>
        )}
      </div>
    </SidepanelLayout>
  );
}
