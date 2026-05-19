import { TabInfo } from "@/src/utils/tab-manager";
import { Globe } from "lucide-react";
import { formatRelativeTime } from "@/src/utils/relative-time";

interface TabItemProps {
  tab: TabInfo;
  kbdHintAction?: string;
  /** When true, show "5m" / "2h" relative to tab.lastModified. */
  showRelativeTime?: boolean;
}

export function TabItem({
  tab,
  kbdHintAction,
  showRelativeTime,
}: TabItemProps) {
  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  const relativeTime =
    showRelativeTime && tab.lastModified
      ? formatRelativeTime(tab.lastModified)
      : null;

  return (
    <div className="flex items-center gap-3 px-4 py-3 w-full">
      <div className="flex-shrink-0 w-4 h-4">
        {tab.favIconUrl ? (
          <img
            src={tab.favIconUrl}
            alt=""
            className="w-full h-full object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <Globe className="w-4 h-4 text-gray-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-900 truncate">
            {truncateText(tab.title || "Untitled", 60)}
          </p>
          {tab.active && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-700">
              Current
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 truncate">
          {truncateText(tab.url || "", 80)}
        </p>
      </div>
      {relativeTime && (
        <span className="text-[11px] text-gray-400 flex-shrink-0 font-medium tabular-nums">
          {relativeTime}
        </span>
      )}
      {kbdHintAction && (
        <div className="cmdk-item-kbd-hint">
          <kbd className="cmdk-kbd">↵</kbd>
        </div>
      )}
    </div>
  );
}
