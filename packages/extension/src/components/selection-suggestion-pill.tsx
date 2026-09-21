import React from "react";
import { PackageSearch, Search, TrendingUp, Copy } from "lucide-react";
import { positionSelectionSuggestions } from "../domain/selection-suggestions";

export type SelectionSearchActionId = "ebay" | "google" | "pricecharting";
export type SelectionSuggestionPosition = ReturnType<
  typeof positionSelectionSuggestions
>;

const selectionSearchActions: Array<{
  id: SelectionSearchActionId;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}> = [
  { id: "ebay", label: "eBay Prices", icon: PackageSearch },
  { id: "google", label: "Search for UPC", icon: Search },
  { id: "pricecharting", label: "PriceCharting", icon: TrendingUp },
];

export function SelectionSuggestionPill({
  onCopy,
  onSearch,
  position,
}: {
  onCopy: () => void;
  onSearch: (actionId: SelectionSearchActionId) => void;
  position: SelectionSuggestionPosition;
}) {
  return (
    <div
      aria-label="Actions for selected text"
      className="selection-pill"
      data-placement={position.placement}
      role="toolbar"
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${position.width}px`,
      }}
    >
      {selectionSearchActions.map((action) => {
        const Icon = action.icon;
        return (
          <button
            key={action.id}
            aria-label={action.label}
            className="selection-action selection-search-action"
            onClick={() => onSearch(action.id)}
            onPointerDown={(event) => event.preventDefault()}
            title={action.label}
            type="button"
          >
            <Icon size={16} />
            <span>{action.label}</span>
          </button>
        );
      })}
      <button
        aria-label="Copy selected text"
        className="selection-copy"
        onClick={onCopy}
        onPointerDown={(event) => event.preventDefault()}
        title="Copy selected text"
        type="button"
      >
        <Copy size={15} />
        <span>Copy selected text</span>
      </button>
    </div>
  );
}

/**
 * Context Menu Content Script
 * - Light theme, rounded, shadowed menu
 * - Keyboard: Up/Down/Enter/Esc
 * - Ctrl+right-click => native menu
 * - Works everywhere including inputs/contentEditable
 */
