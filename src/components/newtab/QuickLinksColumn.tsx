import React, { useState, useMemo } from "react";
import { CSVLink, fetchCSVLinks, filterCSVLinks } from "@/src/utils/csv-links";
import { Skeleton } from "@/src/components/ui/skeleton";
import { ScrollArea } from "@/src/components/ui/scroll-area";
import { Search as SearchIcon } from "lucide-react";
import { getFaviconUrl } from "@/src/utils/favicon";
import "./column-styles.css";

export function QuickLinksColumn({ id }: { id?: string }) {
  const [search, setSearch] = useState("");
  const [csvLinks, setCSVLinks] = useState<CSVLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  React.useEffect(() => {
    loadCSVLinks();
  }, []);

  const loadCSVLinks = async () => {
    try {
      const { links } = await fetchCSVLinks();
      setCSVLinks(links);
    } finally {
      setLoading(false);
    }
  };

  const filteredLinks = useMemo(
    () => filterCSVLinks(csvLinks, search),
    [csvLinks, search]
  );

  // Group by category
  const linksByCategory = useMemo(() => {
    return filteredLinks.reduce((acc, link) => {
      const category = link.category || "General";
      if (!acc[category]) acc[category] = [];
      acc[category].push(link);
      return acc;
    }, {} as Record<string, CSVLink[]>);
  }, [filteredLinks]);

  const sortedCategories = Object.keys(linksByCategory).sort((a, b) =>
    a.localeCompare(b)
  );

  const handleKeyDown = (e: React.KeyboardEvent, link: CSVLink) => {
    if (e.key === "Enter") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.update(tabs[0].id, { url: link.url });
        }
      });
    }
  };

  return (
    <div id={id} className="newtab-column newtab-column-left">
      <div className="newtab-column-header">
        <h3>Quick Links</h3>
      </div>

      <div className="newtab-column-search">
        <SearchIcon className="w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search links..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSelectedIndex(-1);
          }}
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
          ) : filteredLinks.length === 0 ? (
            <div className="newtab-column-empty">
              <p>No quick links found</p>
            </div>
          ) : (
            sortedCategories.map((category) => (
              <div key={category} className="newtab-column-category">
                <div className="newtab-column-category-header">
                  {category}
                </div>
                <div className="newtab-column-category-divider" />
                {linksByCategory[category].map((link) => (
                  <button
                    key={link.id}
                    onClick={() => {
                      chrome.tabs.query(
                        { active: true, currentWindow: true },
                        (tabs) => {
                          if (tabs[0]) {
                            chrome.tabs.update(tabs[0].id, { url: link.url });
                          }
                        }
                      );
                    }}
                    onKeyDown={(e) => handleKeyDown(e, link)}
                    className="newtab-column-item"
                    title={link.title}
                  >
                    <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                      <img
                        src={getFaviconUrl(link.url)}
                        alt=""
                        className="w-4 h-4 object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.opacity = "0";
                        }}
                      />
                    </div>
                    <span className="newtab-column-item-text">
                      {link.title}
                    </span>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
