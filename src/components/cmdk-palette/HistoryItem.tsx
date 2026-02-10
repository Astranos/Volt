import { HistoryItem } from "@/src/utils/history";
import { Clock } from "lucide-react";

interface HistoryItemProps {
  item: HistoryItem;
  kbdHintAction?: string;
}

export function HistoryItemComponent({ item, kbdHintAction }: HistoryItemProps) {
  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3 w-full">
      <div className="flex-shrink-0 w-4 h-4">
        <Clock className="w-4 h-4 text-gray-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">
          {truncateText(item.title, 60)}
        </p>
        <p className="text-xs text-gray-500 truncate">
          {truncateText(item.url, 80)}
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
