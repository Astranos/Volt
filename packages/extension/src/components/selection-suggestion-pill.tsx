import React from "react";
import { PackageSearch, Search, TrendingUp, Copy, Link2, BookOpen, Sparkles } from "lucide-react";
import { positionSelectionSuggestions } from "../domain/selection-suggestions";
import {
  SELECTION_ACTIONS,
  type SelectionActionId,
} from "../domain/selection-actions";

export type SelectionSuggestionPosition = ReturnType<
  typeof positionSelectionSuggestions
>;

const icons: Record<SelectionActionId, React.ComponentType<{ size?: number }>> = {
  ebay: PackageSearch,
  "google-upc": Search,
  pricecharting: TrendingUp,
  "google-search": Search,
  "copy-highlight-link": Link2,
  "look-up": BookOpen,
  "ask-gemini": Sparkles,
};

export function SelectionSuggestionPill({
  actions,
  onCopy,
  onAction,
  position,
}: {
  actions: readonly SelectionActionId[];
  onCopy: () => void;
  onAction: (actionId: SelectionActionId) => void;
  position: SelectionSuggestionPosition;
}) {
  return (
    <div
      aria-label="Actions for selected text"
      className="selection-pill"
      data-placement={position.placement}
      role="toolbar"
      style={{
        gridTemplateColumns: `repeat(${Math.max(actions.length, 1)}, minmax(0, 1fr))`,
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${position.width}px`,
      }}
    >
      {actions.map((id) => {
        const Icon = icons[id];
        const action = SELECTION_ACTIONS.find((candidate) => candidate.id === id);
        if (!action) return null;
        return (
          <button
            key={id}
            aria-label={action.label}
            className="selection-action selection-search-action"
            onClick={() => onAction(id)}
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
