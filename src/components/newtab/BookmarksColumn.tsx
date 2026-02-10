import React, { useState, useMemo } from "react";
import {
  getBookmarksFromMultipleFolders,
  filterBookmarks,
  Bookmark,
} from "@/src/utils/bookmarks";
import { Skeleton } from "@/src/components/ui/skeleton";
import { ScrollArea } from "@/src/components/ui/scroll-area";
import { Search as SearchIcon } from "lucide-react";
import { getFaviconUrl } from "@/src/utils/favicon";
import "./column-styles.css";

export function BookmarksColumn({ id }: { id?: string }) {
  const [search, setSearch] = useState("");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    loadBookmarks();
  }, []);

  const loadBookmarks = async () => {
    try {
      // Get the selected folder IDs from settings
      const result = await new Promise<any>((resolve) => {
        chrome.storage.sync.get(["cmdkSettings"], resolve);
      });
      const folderIds = result.cmdkSettings?.bookmarkFolderIds || [];
      const allBookmarks = await getBookmarksFromMultipleFolders(folderIds);
      setBookmarks(allBookmarks);
    } finally {
      setLoading(false);
    }
  };

  const filteredBookmarks = useMemo(
    () => filterBookmarks(bookmarks, search),
    [bookmarks, search]
  );

  const handleKeyDown = (e: React.KeyboardEvent, bookmark: Bookmark) => {
    if (e.key === "Enter") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.update(tabs[0].id, { url: bookmark.url });
        }
      });
    }
  };

  return (
    <div id={id} className="newtab-column newtab-column-right">
      <div className="newtab-column-header">
        <h3>Bookmarks</h3>
      </div>

      <div className="newtab-column-search">
        <SearchIcon className="w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search bookmarks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="newtab-column-search-input"
        />
      </div>

      <ScrollArea className="flex-1">
        <div className="newtab-column-list">
          {loading ? (
            <div className="newtab-column-loading">
              {[1, 2, 3].map((i) => (
                <div key={i} className="newtab-column-item-skeleton">
                  <Skeleton className="w-4 h-4" />
                  <Skeleton className="flex-1 h-4" />
                </div>
              ))}
            </div>
          ) : filteredBookmarks.length === 0 ? (
            <div className="newtab-column-empty">
              <p>No bookmarks found</p>
            </div>
          ) : (
            filteredBookmarks.map((bookmark) => (
              <button
                key={bookmark.id}
                onClick={() => {
                  chrome.tabs.query(
                    { active: true, currentWindow: true },
                    (tabs) => {
                      if (tabs[0]) {
                        chrome.tabs.update(tabs[0].id, { url: bookmark.url });
                      }
                    }
                  );
                }}
                onKeyDown={(e) => handleKeyDown(e, bookmark)}
                className="newtab-column-item"
                title={bookmark.title}
              >
                <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                  <img
                    src={getFaviconUrl(bookmark.url)}
                    alt=""
                    className="w-4 h-4 object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.opacity = "0";
                    }}
                  />
                </div>
                <span className="newtab-column-item-text">
                  {bookmark.title}
                </span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
