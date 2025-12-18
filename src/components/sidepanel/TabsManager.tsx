/// <reference types="chrome" />
import React, { useEffect, useState, useCallback, useRef } from "react";
import { X, ExternalLink, Search } from "lucide-react";
import { cn } from "../../lib/utils";
import { Input } from "../ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";

interface Tab {
  id?: number;
  title?: string;
  favIconUrl?: string;
  active: boolean;
  url?: string;
  closedAt?: number;
}

export default function TabsManager() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [closedTabs, setClosedTabs] = useState<Tab[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const tabsCacheRef = useRef<Map<number, Tab>>(new Map());

  const fetchTabs = useCallback(() => {
    chrome.tabs.query({ currentWindow: true }, (result) => {
      // Update cache
      const newCache = new Map<number, Tab>();
      result.forEach((tab) => {
        if (tab.id) {
          newCache.set(tab.id, tab);
        }
      });
      tabsCacheRef.current = newCache;
      setTabs(result);
    });
  }, []);

  const fetchClosedTabs = useCallback(() => {
    // Try to use chrome.sessions API if available
    if (chrome.sessions) {
      chrome.sessions.getRecentlyClosed({ maxResults: 25 }, (sessions) => {
        if (chrome.runtime.lastError) {
          console.warn("Error fetching closed tabs:", chrome.runtime.lastError);
          return;
        }
        const closed: Tab[] = [];
        sessions.forEach((session, index) => {
          if (session.tab) {
            closed.push({
              id: undefined, // Closed tabs don't have active IDs
              title: session.tab.title,
              favIconUrl: session.tab.favIconUrl,
              url: session.tab.url,
              active: false,
              closedAt: Date.now() - index, // Stagger timestamps for uniqueness
            });
          }
        });
        setClosedTabs(closed);
      });
    }
  }, []);

  useEffect(() => {
    fetchTabs();
    fetchClosedTabs();

    const handleTabCreated = () => {
      fetchTabs();
    };

    const handleTabUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) => {
      if (
        changeInfo.status === "complete" ||
        changeInfo.title ||
        changeInfo.favIconUrl
      ) {
        fetchTabs();
      }
    };

    const handleTabRemoved = (tabId: number) => {
      // Get tab info from cache before it's removed
      const closedTab = tabsCacheRef.current.get(tabId);
      if (closedTab) {
        const tabToStore: Tab = {
          id: closedTab.id,
          title: closedTab.title,
          favIconUrl: closedTab.favIconUrl,
          url: closedTab.url,
          active: false,
          closedAt: Date.now(),
        };
        setClosedTabs((prev) => [tabToStore, ...prev].slice(0, 25));
      }
      fetchTabs();
      // Refresh closed tabs from sessions API
      setTimeout(() => fetchClosedTabs(), 100);
    };

    const handleTabActivated = () => {
      fetchTabs();
    };

    chrome.tabs.onCreated.addListener(handleTabCreated);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);
    chrome.tabs.onRemoved.addListener(handleTabRemoved);
    chrome.tabs.onActivated.addListener(handleTabActivated);

    return () => {
      chrome.tabs.onCreated.removeListener(handleTabCreated);
      chrome.tabs.onUpdated.removeListener(handleTabUpdated);
      chrome.tabs.onRemoved.removeListener(handleTabRemoved);
      chrome.tabs.onActivated.removeListener(handleTabActivated);
    };
  }, [fetchTabs, fetchClosedTabs]);

  const activateTab = (tabId?: number) => {
    if (tabId) {
      chrome.tabs.update(tabId, { active: true });
    }
  };

  const restoreTab = (url?: string) => {
    if (url) {
      chrome.tabs.create({ url, active: true });
    }
  };

  const closeTab = (e: React.MouseEvent, tabId?: number) => {
    e.stopPropagation();
    if (tabId) {
      chrome.tabs.remove(tabId);
    }
  };

  const filterTabs = (tabsToFilter: Tab[], query: string): Tab[] => {
    if (!query.trim()) return tabsToFilter;
    const lowerQuery = query.toLowerCase();
    return tabsToFilter.filter(
      (tab) =>
        tab.title?.toLowerCase().includes(lowerQuery) ||
        tab.url?.toLowerCase().includes(lowerQuery)
    );
  };

  const filteredTabs = filterTabs(tabs, searchQuery);
  const filteredClosedTabs = filterTabs(closedTabs, searchQuery);

  const renderTab = (tab: Tab, isClosed = false, index?: number) => (
    <div
      key={
        isClosed
          ? `closed-${tab.url}-${tab.closedAt}-${index}`
          : `open-${tab.id}`
      }
      onClick={() => (isClosed ? restoreTab(tab.url) : activateTab(tab.id))}
      className={cn(
        "group flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors text-sm",
        tab.active && !isClosed
          ? "bg-primary/10 text-primary font-medium"
          : "hover:bg-accent hover:text-accent-foreground text-muted-foreground"
      )}
    >
      {tab.favIconUrl ? (
        <img
          src={tab.favIconUrl}
          alt=""
          className="w-4 h-4 flex-shrink-0"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <ExternalLink className="w-4 h-4 flex-shrink-0 opacity-50" />
      )}

      <span className="flex-1 truncate" title={tab.title || tab.url}>
        {tab.title || "Untitled Tab"}
      </span>

      {!isClosed && (
        <button
          onClick={(e) => closeTab(e, tab.id)}
          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-background/50 rounded-full transition-all"
          title="Close tab"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="p-4 border-b border-border/50 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search tabs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {/* Open Tabs Section */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2 px-2">
            Open Tabs ({filteredTabs.length})
          </h3>
          <div className="space-y-1">
            {filteredTabs.length > 0 ? (
              filteredTabs.map((tab, index) => renderTab(tab, false, index))
            ) : searchQuery ? (
              <div className="text-sm text-muted-foreground px-2 py-4 text-center">
                No open tabs match your search
              </div>
            ) : null}
          </div>
        </div>

        {/* Closed Tabs Section */}
        {filteredClosedTabs.length > 0 && (
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="closed-tabs" className="border-none">
              <AccordionTrigger className="px-2 py-2 text-sm font-medium text-muted-foreground hover:no-underline">
                Previously Closed Tabs ({filteredClosedTabs.length})
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-1 pt-1">
                  {filteredClosedTabs.map((tab, index) =>
                    renderTab(tab, true, index)
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </div>
    </div>
  );
}
