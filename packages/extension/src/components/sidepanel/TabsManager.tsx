import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  X,
  ExternalLink,
  Search,
  Volume2,
  Pin,
  Moon,
  Copy,
  Trash2,
  ChevronDown,
  ChevronRight,
  Globe,
  ArrowUpDown,
  Clock,
  SortAsc,
  Layers,
  Monitor,
  RotateCcw,
  Check,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip";

interface Tab {
  id?: number;
  title?: string;
  favIconUrl?: string;
  active: boolean;
  url?: string;
  closedAt?: number;
  windowId?: number;
  pinned?: boolean;
  audible?: boolean;
  discarded?: boolean;
  mutedInfo?: { muted: boolean };
  groupId?: number;
}

interface DomainGroup {
  domain: string;
  tabs: Tab[];
  expanded: boolean;
}

type SortOption = "recent" | "alphabetical" | "domain";

export default function TabsManager() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [closedTabs, setClosedTabs] = useState<Tab[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [showAllWindows, setShowAllWindows] = useState(false);
  const [groupByDomain, setGroupByDomain] = useState(true);
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(
    new Set()
  );
  const [selectedTabs, setSelectedTabs] = useState<Set<number>>(new Set());
  const [showClosedTabs, setShowClosedTabs] = useState(false);
  const [currentWindowId, setCurrentWindowId] = useState<number | null>(null);

  // Get domain from URL
  const getDomain = useCallback((url?: string): string => {
    if (!url) return "other";
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace("www.", "");
    } catch {
      return "other";
    }
  }, []);

  // Fetch tabs
  const fetchTabs = useCallback(() => {
    const queryOptions = showAllWindows ? {} : { currentWindow: true };
    chrome.tabs.query(queryOptions, (result) => {
      setTabs(result);
    });

    // Get current window ID
    chrome.windows.getCurrent((win) => {
      setCurrentWindowId(win.id ?? null);
    });
  }, [showAllWindows]);

  // Fetch closed tabs
  const fetchClosedTabs = useCallback(() => {
    if (chrome.sessions) {
      chrome.sessions.getRecentlyClosed({ maxResults: 25 }, (sessions) => {
        if (chrome.runtime.lastError) return;
        const closed: Tab[] = [];
        sessions.forEach((session, index) => {
          if (session.tab) {
            closed.push({
              id: undefined,
              title: session.tab.title,
              favIconUrl: session.tab.favIconUrl,
              url: session.tab.url,
              active: false,
              closedAt: Date.now() - index,
            });
          }
        });
        setClosedTabs(closed);
      });
    }
  }, []);

  // Setup listeners
  useEffect(() => {
    fetchTabs();
    fetchClosedTabs();

    const handleTabUpdate = () => fetchTabs();

    chrome.tabs.onCreated.addListener(handleTabUpdate);
    chrome.tabs.onUpdated.addListener(handleTabUpdate);
    chrome.tabs.onRemoved.addListener(() => {
      fetchTabs();
      setTimeout(fetchClosedTabs, 100);
    });
    chrome.tabs.onActivated.addListener(handleTabUpdate);
    chrome.tabs.onMoved.addListener(handleTabUpdate);

    return () => {
      chrome.tabs.onCreated.removeListener(handleTabUpdate);
      chrome.tabs.onUpdated.removeListener(handleTabUpdate);
      chrome.tabs.onRemoved.removeListener(handleTabUpdate);
      chrome.tabs.onActivated.removeListener(handleTabUpdate);
      chrome.tabs.onMoved.removeListener(handleTabUpdate);
    };
  }, [fetchTabs, fetchClosedTabs]);

  // Refetch when showAllWindows changes
  useEffect(() => {
    fetchTabs();
  }, [showAllWindows, fetchTabs]);

  // Find duplicate tabs (same URL)
  const duplicateTabs = useMemo(() => {
    const urlCounts = new Map<string, Tab[]>();
    tabs.forEach((tab) => {
      if (tab.url) {
        const existing = urlCounts.get(tab.url) || [];
        existing.push(tab);
        urlCounts.set(tab.url, existing);
      }
    });
    const duplicates = new Set<number>();
    urlCounts.forEach((tabList) => {
      if (tabList.length > 1) {
        // Mark all but the first (or active) as duplicates
        const sortedTabs = [...tabList].sort((a, b) => {
          if (a.active) return -1;
          if (b.active) return 1;
          return 0;
        });
        sortedTabs.slice(1).forEach((t) => {
          if (t.id) duplicates.add(t.id);
        });
      }
    });
    return duplicates;
  }, [tabs]);

  // Filter and sort tabs
  const processedTabs = useMemo(() => {
    let filtered = tabs;

    // Search filter
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (tab) =>
          tab.title?.toLowerCase().includes(lowerQuery) ||
          tab.url?.toLowerCase().includes(lowerQuery)
      );
    }

    // Sort
    let sorted = [...filtered];
    switch (sortBy) {
      case "alphabetical":
        sorted.sort((a, b) =>
          (a.title || "").localeCompare(b.title || "")
        );
        break;
      case "domain":
        sorted.sort((a, b) =>
          getDomain(a.url).localeCompare(getDomain(b.url))
        );
        break;
      case "recent":
      default:
        // Keep browser order but put active first
        sorted.sort((a, b) => {
          if (a.active && !b.active) return -1;
          if (!a.active && b.active) return 1;
          return 0;
        });
    }

    return sorted;
  }, [tabs, searchQuery, sortBy, getDomain]);

  // Group by domain
  const domainGroups = useMemo((): DomainGroup[] => {
    if (!groupByDomain) return [];

    const groups = new Map<string, Tab[]>();
    processedTabs.forEach((tab) => {
      const domain = getDomain(tab.url);
      const existing = groups.get(domain) || [];
      existing.push(tab);
      groups.set(domain, existing);
    });

    return Array.from(groups.entries())
      .map(([domain, domainTabs]) => ({
        domain,
        tabs: domainTabs,
        expanded: expandedDomains.has(domain),
      }))
      .sort((a, b) => b.tabs.length - a.tabs.length);
  }, [processedTabs, groupByDomain, getDomain, expandedDomains]);

  // Actions
  const activateTab = (tabId?: number) => {
    if (tabId) {
      chrome.tabs.update(tabId, { active: true }, (tab) => {
        if (tab?.windowId) {
          chrome.windows.update(tab.windowId, { focused: true });
        }
      });
    }
  };

  const closeTab = (e: React.MouseEvent, tabId?: number) => {
    e.stopPropagation();
    if (tabId) {
      chrome.tabs.remove(tabId);
    }
  };

  const discardTab = (e: React.MouseEvent, tabId?: number) => {
    e.stopPropagation();
    if (tabId) {
      chrome.tabs.discard(tabId);
    }
  };

  const pinTab = (e: React.MouseEvent, tab: Tab) => {
    e.stopPropagation();
    if (tab.id) {
      chrome.tabs.update(tab.id, { pinned: !tab.pinned });
    }
  };

  const restoreTab = (url?: string) => {
    if (url) {
      chrome.tabs.create({ url, active: true });
    }
  };

  const closeDuplicates = () => {
    const idsToClose = Array.from(duplicateTabs);
    if (idsToClose.length > 0) {
      chrome.tabs.remove(idsToClose);
    }
  };

  const closeDomainTabs = (domain: string) => {
    const domainTabIds = tabs
      .filter((t) => getDomain(t.url) === domain && t.id)
      .map((t) => t.id as number);
    if (domainTabIds.length > 0) {
      chrome.tabs.remove(domainTabIds);
    }
  };

  const closeSelectedTabs = () => {
    const idsToClose = Array.from(selectedTabs);
    if (idsToClose.length > 0) {
      chrome.tabs.remove(idsToClose);
      setSelectedTabs(new Set());
    }
  };

  const toggleTabSelection = (e: React.MouseEvent, tabId?: number) => {
    e.stopPropagation();
    if (!tabId) return;
    setSelectedTabs((prev) => {
      const next = new Set(prev);
      if (next.has(tabId)) {
        next.delete(tabId);
      } else {
        next.add(tabId);
      }
      return next;
    });
  };

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev);
      if (next.has(domain)) {
        next.delete(domain);
      } else {
        next.add(domain);
      }
      return next;
    });
  };

  const selectAllInDomain = (domain: string) => {
    const domainTabIds = tabs
      .filter((t) => getDomain(t.url) === domain && t.id)
      .map((t) => t.id as number);
    setSelectedTabs((prev) => {
      const next = new Set(prev);
      domainTabIds.forEach((id) => next.add(id));
      return next;
    });
  };

  // Filter closed tabs
  const filteredClosedTabs = useMemo(() => {
    if (!searchQuery.trim()) return closedTabs;
    const lowerQuery = searchQuery.toLowerCase();
    return closedTabs.filter(
      (tab) =>
        tab.title?.toLowerCase().includes(lowerQuery) ||
        tab.url?.toLowerCase().includes(lowerQuery)
    );
  }, [closedTabs, searchQuery]);

  // Tab row component
  const TabRow = ({
    tab,
    isClosed = false,
    showCheckbox = false,
  }: {
    tab: Tab;
    isClosed?: boolean;
    showCheckbox?: boolean;
  }) => {
    const isDuplicate = tab.id && duplicateTabs.has(tab.id);
    const isSelected = tab.id && selectedTabs.has(tab.id);

    return (
      <div
        onClick={() =>
          isClosed ? restoreTab(tab.url) : activateTab(tab.id)
        }
        className={cn(
          "group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-all text-sm",
          tab.active && !isClosed
            ? "bg-emerald-500/15 text-emerald-700 font-medium ring-1 ring-emerald-500/30"
            : "hover:bg-zinc-100 text-zinc-700",
          isDuplicate && "ring-1 ring-amber-400/50 bg-amber-50",
          tab.discarded && "opacity-60"
        )}
      >
        {/* Checkbox */}
        {showCheckbox && !isClosed && (
          <button
            onClick={(e) => toggleTabSelection(e, tab.id)}
            className={cn(
              "flex-shrink-0 w-4 h-4 rounded border-[1.5px] flex items-center justify-center transition-all",
              isSelected
                ? "bg-emerald-500 border-emerald-500"
                : "bg-white border-zinc-300 hover:border-emerald-400"
            )}
          >
            <Check className={cn("w-3 h-3 transition-opacity", isSelected ? "text-white opacity-100" : "opacity-0")} strokeWidth={2.5} />
          </button>
        )}

        {/* Favicon */}
        {tab.favIconUrl ? (
          <img
            src={tab.favIconUrl}
            alt=""
            className="w-4 h-4 flex-shrink-0 rounded-sm"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <Globe className="w-4 h-4 flex-shrink-0 text-zinc-400" />
        )}

        {/* Title */}
        <span className="flex-1 truncate" title={tab.title || tab.url}>
          {tab.title || "Untitled"}
        </span>

        {/* Status indicators */}
        <div className="flex items-center gap-1">
          {tab.audible && !tab.mutedInfo?.muted && (
            <Volume2 className="w-3.5 h-3.5 text-blue-500 animate-pulse" />
          )}
          {tab.pinned && <Pin className="w-3.5 h-3.5 text-amber-500" />}
          {tab.discarded && (
            <Moon className="w-3.5 h-3.5 text-purple-500" />
          )}
          {isDuplicate && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-amber-600 border-amber-400">
              DUP
            </Badge>
          )}
          {showAllWindows && tab.windowId !== currentWindowId && (
            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
              W{tab.windowId}
            </Badge>
          )}
        </div>

        {/* Actions */}
        {!isClosed && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => pinTab(e, tab)}
                    className={cn(
                      "p-1 rounded-md transition-colors",
                      tab.pinned 
                        ? "text-amber-500 hover:bg-amber-500/10" 
                        : "text-zinc-400 hover:text-zinc-600 hover:bg-zinc-200/50"
                    )}
                  >
                    <Pin className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {tab.pinned ? "Unpin" : "Pin"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {!tab.active && !tab.discarded && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => discardTab(e, tab.id)}
                      className="p-1 rounded-md text-zinc-400 hover:text-purple-500 hover:bg-purple-500/10 transition-colors"
                    >
                      <Moon className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Sleep tab</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => closeTab(e, tab.id)}
                    className="p-1 rounded-md text-zinc-400 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Close</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
    );
  };

  // Domain group component
  const DomainGroupComponent = ({ group }: { group: DomainGroup }) => {
    // Get favicon from the first tab that has one
    const groupFavicon = group.tabs.find((t) => t.favIconUrl)?.favIconUrl;

    return (
    <div className="mb-2">
      <div
        onClick={() => toggleDomain(group.domain)}
        className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-zinc-100 transition-colors"
      >
        {group.expanded ? (
          <ChevronDown className="w-4 h-4 text-zinc-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-zinc-400" />
        )}
        {groupFavicon ? (
          <img
            src={groupFavicon}
            alt=""
            className="w-4 h-4 flex-shrink-0 rounded-sm"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <Globe className="w-4 h-4 text-zinc-500" />
        )}
        <span className="font-medium text-sm text-zinc-700 truncate flex-1">
          {group.domain}
        </span>
        <Badge variant="secondary" className="text-xs">
          {group.tabs.length}
        </Badge>

        {/* Domain actions */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    selectAllInDomain(group.domain);
                  }}
                  className="p-1 hover:bg-emerald-100 rounded transition-colors"
                >
                  <CheckCircle className="w-3.5 h-3.5 text-zinc-400 hover:text-emerald-500" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Select all</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeDomainTabs(group.domain);
                  }}
                  className="p-1 hover:bg-red-100 rounded"
                >
                  <XCircle className="w-3.5 h-3.5 text-zinc-400 hover:text-red-500" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Close all from {group.domain}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {group.expanded && (
        <div className="ml-4 mt-1 space-y-0.5 border-l-2 border-zinc-200 pl-2">
          {group.tabs.map((tab, idx) => (
            <TabRow key={`${tab.id}-${idx}`} tab={tab} showCheckbox />
          ))}
        </div>
      )}
    </div>
  );
  };

  return (
    <div className="h-full flex flex-col bg-zinc-50">
      {/* Header */}
      <div className="p-3 border-b border-zinc-200 space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <Input
            type="text"
            placeholder="Search tabs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-white border-zinc-200"
          />
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Sort dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
                <ArrowUpDown className="w-3 h-3" />
                {sortBy === "recent" && "Recent"}
                {sortBy === "alphabetical" && "A-Z"}
                {sortBy === "domain" && "Domain"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setSortBy("recent")}>
                <Clock className="w-4 h-4 mr-2" />
                Recent
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("alphabetical")}>
                <SortAsc className="w-4 h-4 mr-2" />
                Alphabetical
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSortBy("domain")}>
                <Globe className="w-4 h-4 mr-2" />
                By Domain
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Group toggle */}
          <Button
            variant={groupByDomain ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setGroupByDomain(!groupByDomain)}
          >
            <Layers className="w-3 h-3" />
            Group
          </Button>

          {/* Multi-window toggle */}
          <Button
            variant={showAllWindows ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setShowAllWindows(!showAllWindows)}
          >
            <Monitor className="w-3 h-3" />
            All Windows
          </Button>
        </div>

        {/* Quick actions bar */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">
            {tabs.length} tab{tabs.length !== 1 ? "s" : ""}
          </span>

          {duplicateTabs.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs gap-1 text-amber-600 border-amber-300 hover:bg-amber-50"
              onClick={closeDuplicates}
            >
              <Copy className="w-3 h-3" />
              Close {duplicateTabs.size} duplicate{duplicateTabs.size !== 1 ? "s" : ""}
            </Button>
          )}

          {selectedTabs.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 text-xs gap-1 text-red-600 border-red-300 hover:bg-red-50"
              onClick={closeSelectedTabs}
            >
              <Trash2 className="w-3 h-3" />
              Close {selectedTabs.size} selected
            </Button>
          )}
        </div>
      </div>

      {/* Tab list */}
      <div className="flex-1 overflow-y-auto p-2">
        {groupByDomain ? (
          // Grouped view
          <div className="space-y-1">
            {domainGroups.map((group) => (
              <DomainGroupComponent key={group.domain} group={group} />
            ))}
          </div>
        ) : (
          // Flat list view
          <div className="space-y-0.5">
            {processedTabs.map((tab, idx) => (
              <TabRow key={`${tab.id}-${idx}`} tab={tab} showCheckbox />
            ))}
          </div>
        )}

        {/* Empty state */}
        {processedTabs.length === 0 && searchQuery && (
          <div className="text-center py-8 text-zinc-500 text-sm">
            No tabs match "{searchQuery}"
          </div>
        )}
      </div>

      {/* Closed tabs section */}
      <div className="border-t border-zinc-200">
        <button
          onClick={() => setShowClosedTabs(!showClosedTabs)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-zinc-100 transition-colors"
        >
          <div className="flex items-center gap-2 text-sm text-zinc-600">
            <RotateCcw className="w-4 h-4" />
            <span>Recently Closed</span>
            <Badge variant="secondary" className="text-xs">
              {filteredClosedTabs.length}
            </Badge>
          </div>
          {showClosedTabs ? (
            <ChevronDown className="w-4 h-4 text-zinc-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-zinc-400" />
          )}
        </button>

        {showClosedTabs && (
          <div className="max-h-48 overflow-y-auto px-2 pb-2 space-y-0.5">
            {filteredClosedTabs.length > 0 ? (
              filteredClosedTabs.map((tab, idx) => (
                <TabRow key={`closed-${tab.url}-${idx}`} tab={tab} isClosed />
              ))
            ) : (
              <div className="text-center py-4 text-zinc-500 text-sm">
                No recently closed tabs
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}





