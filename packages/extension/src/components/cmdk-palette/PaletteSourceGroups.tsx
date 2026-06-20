import React from "react";
import { Command } from "cmdk";
import { Skeleton } from "@/src/components/ui/skeleton";
import type { CSVLink } from "@/src/utils/csv-links";
import type { Bookmark } from "@/src/utils/bookmarks";
import type { HistoryItem } from "@/src/utils/history";
import type { TabInfo } from "@/src/utils/tab-manager";
import type { SidepanelToolId } from "@/src/lib/sidepanel-tools";
import { BookmarkItem } from "./BookmarkItem";
import { CSVLinkItem } from "./CSVLinkItem";
import { HistoryItemComponent } from "./HistoryItem";
import { searchProviders, type SearchProvider } from "./SearchProviders";
import { TabItem } from "./TabItem";

type ToolItem = {
  id: SidepanelToolId;
  label: string;
  description: string;
  color?: string;
  icon: React.ComponentType<{ className?: string }>;
};

type PaletteSourceGroupsProps = {
  sourceOrder: string[];
  trimmedSearch: string;
  search: string;
  enabledSearchProviders: boolean;
  csvLinksLoading: boolean;
  filteredTabs: TabInfo[];
  filteredCSVLinks: CSVLink[];
  filteredTools: ToolItem[];
  filteredBookmarks: Bookmark[];
  filteredHistory: HistoryItem[];
  onSelect: (value: string) => void;
};

function groupCSVLinksByCategory(filteredCSVLinks: CSVLink[]) {
  const csvLinksByCategory = filteredCSVLinks.reduce(
    (acc, link) => {
      const category = link.category || "General";
      if (!acc[category]) acc[category] = [];
      acc[category].push(link);
      return acc;
    },
    {} as Record<string, CSVLink[]>,
  );

  const sortedCategories = Object.keys(csvLinksByCategory).sort((a, b) =>
    a.localeCompare(b),
  );

  sortedCategories.forEach((category) => {
    csvLinksByCategory[category].sort((a, b) => a.title.localeCompare(b.title));
  });

  return { csvLinksByCategory, sortedCategories };
}

export function PaletteSourceGroups({
  sourceOrder,
  trimmedSearch,
  search,
  enabledSearchProviders,
  csvLinksLoading,
  filteredTabs,
  filteredCSVLinks,
  filteredTools,
  filteredBookmarks,
  filteredHistory,
  onSelect,
}: PaletteSourceGroupsProps) {
  const { csvLinksByCategory, sortedCategories } =
    groupCSVLinksByCategory(filteredCSVLinks);
  const orderedSources = trimmedSearch
    ? ["tabs", "quickLinks", "tools", "bookmarks", "searchProviders", "history"]
    : sourceOrder;

  return (
    <>
      {orderedSources.map((sourceKey) => {
        switch (sourceKey) {
          case "tabs":
            return (
              <React.Fragment key="tabs">
                {filteredTabs.length > 0 && (
                  <Command.Group heading="Tabs" className="cmdk-group">
                    {filteredTabs.map((tab) => (
                      <Command.Item
                        key={tab.id}
                        value={`tab-${tab.id}`}
                        onSelect={onSelect}
                        className="cmdk-item"
                      >
                        <TabItem tab={tab} kbdHintAction="Switch to tab" />
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </React.Fragment>
            );

          case "quickLinks":
            return (
              <React.Fragment key="quickLinks">
                {csvLinksLoading && (
                  <Command.Group heading="Volt Links" className="cmdk-group">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="cmdk-item px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Skeleton className="w-4 h-4" />
                          <div className="flex-1 space-y-2">
                            <Skeleton className="h-4 w-[200px]" />
                            <Skeleton className="h-3 w-[150px]" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </Command.Group>
                )}

                {!csvLinksLoading &&
                  sortedCategories.map((category) => (
                    <Command.Group
                      key={category}
                      heading={category}
                      className="cmdk-group"
                    >
                      {csvLinksByCategory[category].map((link) => (
                        <Command.Item
                          key={link.id}
                          value={link.id}
                          onSelect={onSelect}
                          className="cmdk-item"
                        >
                          <CSVLinkItem
                            link={link}
                            kbdHintAction="Open in new tab"
                          />
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ))}
              </React.Fragment>
            );

          case "tools":
            return (
              <React.Fragment key="tools">
                {filteredTools.length > 0 && (
                  <Command.Group heading="Tools" className="cmdk-group">
                    {filteredTools.map((tool) => (
                      <Command.Item
                        key={tool.id}
                        value={`tool-${tool.id}`}
                        onSelect={onSelect}
                        className="cmdk-item"
                      >
                        <div className="flex items-center gap-3 px-4 py-3 w-full">
                          <div className={`p-2 rounded ${tool.color ?? ""}`}>
                            <tool.icon className="w-4 h-4 text-white" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900">
                              {tool.label}
                            </p>
                            <p className="text-xs text-gray-500">
                              {tool.description}
                            </p>
                          </div>
                          <div className="cmdk-item-kbd-hint">
                            <kbd className="cmdk-kbd">↵</kbd>
                          </div>
                        </div>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </React.Fragment>
            );

          case "bookmarks":
            return (
              <React.Fragment key="bookmarks">
                {filteredBookmarks.length > 0 && (
                  <Command.Group heading="Bookmarks" className="cmdk-group">
                    {filteredBookmarks.map((bookmark) => (
                      <Command.Item
                        key={bookmark.id}
                        value={`bookmark-${bookmark.id}`}
                        onSelect={onSelect}
                        className="cmdk-item"
                      >
                        <BookmarkItem
                          bookmark={bookmark}
                          kbdHintAction="Open in new tab"
                        />
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </React.Fragment>
            );

          case "searchProviders":
            return (
              <React.Fragment key="searchProviders">
                {enabledSearchProviders && (
                  <Command.Group heading="Search" className="cmdk-group">
                    {searchProviders
                      .filter(
                        (provider: SearchProvider) =>
                          !trimmedSearch ||
                          provider.trigger.some((t) =>
                            t.startsWith(search.toLowerCase()),
                          ),
                      )
                      .map((provider: SearchProvider) => (
                        <Command.Item
                          key={provider.id}
                          value={`provider-${provider.id}`}
                          onSelect={onSelect}
                          className="cmdk-item"
                        >
                          <div className="flex items-center gap-3 px-4 py-3">
                            <div className={`p-2 rounded ${provider.color}`}>
                              <provider.icon className="w-4 h-4 text-white" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-gray-900">
                                Search {provider.name}
                              </p>
                              <p className="text-xs text-gray-500">
                                Press <kbd className="cmdk-kbd">Tab</kbd> to
                                activate
                              </p>
                            </div>
                          </div>
                        </Command.Item>
                      ))}
                  </Command.Group>
                )}
              </React.Fragment>
            );

          case "history":
            return (
              <React.Fragment key="history">
                {filteredHistory.length > 0 && (
                  <Command.Group heading="Recent History" className="cmdk-group">
                    {filteredHistory.map((item) => (
                      <Command.Item
                        key={item.id}
                        value={`history-${item.id}`}
                        onSelect={onSelect}
                        className="cmdk-item"
                      >
                        <HistoryItemComponent
                          item={item}
                          kbdHintAction="Open in new tab"
                        />
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </React.Fragment>
            );

          default:
            return null;
        }
      })}
    </>
  );
}
