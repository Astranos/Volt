import { Bookmark } from "@/src/utils/bookmarks";
import { getFaviconUrl } from "@/src/utils/favicon";
import { Bookmark as BookmarkIcon } from "lucide-react";

interface BookmarkItemProps {
  bookmark: Bookmark;
  kbdHintAction?: string;
}

export function BookmarkItem({ bookmark, kbdHintAction }: BookmarkItemProps) {
  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 w-full">
      <div className="flex-shrink-0 w-4 h-4">
        <img
          src={getFaviconUrl(bookmark.url)}
          alt=""
          className="w-4 h-4 object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {truncateText(bookmark.title, 60)}
        </p>
        <p className="text-xs text-gray-500 truncate">
          {truncateText(bookmark.url, 80)}
        </p>
      </div>
      {kbdHintAction && (
        <div className="cmdk-item-kbd-hint">
          <kbd className="cmdk-kbd">↵</kbd>
        </div>
      )}
    </div>
  );
}
