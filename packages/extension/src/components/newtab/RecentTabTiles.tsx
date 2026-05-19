import { TabInfo } from "@/src/utils/tab-manager";
import { Globe, RotateCcw } from "lucide-react";
import { formatRelativeTime } from "@/src/utils/relative-time";

interface RecentTabTilesProps {
  tabs: TabInfo[];
  onRestore: (sessionId: string) => void;
}

function getDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function RecentTabTiles({ tabs, onRestore }: RecentTabTilesProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="recent-tab-tiles">
      {tabs.map((tab) => {
        const relativeTime = tab.lastModified
          ? formatRelativeTime(tab.lastModified)
          : null;

        return (
          <button
            key={String(tab.id)}
            type="button"
            className="recent-tab-tile"
            onClick={() => onRestore(String(tab.id))}
            title={tab.title || tab.url}
          >
            <div className="recent-tab-tile-icon">
              {tab.favIconUrl ? (
                <img
                  src={tab.favIconUrl}
                  alt=""
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display =
                      "none";
                  }}
                />
              ) : (
                <Globe className="w-4 h-4 text-gray-400" />
              )}
            </div>
            <div className="recent-tab-tile-body">
              <div className="recent-tab-tile-title">
                {tab.title || "Untitled"}
              </div>
              <div className="recent-tab-tile-meta">
                <span className="recent-tab-tile-domain">
                  {getDomain(tab.url || "")}
                </span>
                {relativeTime && (
                  <>
                    <span className="recent-tab-tile-dot">·</span>
                    <span className="recent-tab-tile-time">{relativeTime}</span>
                  </>
                )}
              </div>
            </div>
            <span className="recent-tab-tile-restore" aria-hidden="true">
              <RotateCcw className="w-3.5 h-3.5" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
