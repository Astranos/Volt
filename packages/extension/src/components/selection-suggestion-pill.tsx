import React from "react";
import { PackageSearch, Search, TrendingUp, Copy, Link2, BookOpen, Sparkles } from "lucide-react";
import { positionSelectionSuggestions } from "../domain/selection-suggestions";
import { OpenModeSwitch, opensInNewTab, useOpenMode, type OpenMode } from "./open-mode-switch";
import {
  selectionActionKey,
  selectionActionLabel,
  type SelectionAction,
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
  actionWidths,
  onCopy,
  onAction,
  openMode: initialOpenMode,
  position,
}: {
  actions: readonly SelectionAction[];
  actionWidths: readonly number[];
  onCopy: () => void;
  onAction: (action: SelectionAction, newTab: boolean) => void;
  openMode: OpenMode;
  position: SelectionSuggestionPosition;
}) {
  const [openMode, chooseOpenMode] = useOpenMode(initialOpenMode);
  return (
    <div
      aria-label="Actions for selected text"
      className="selection-pill"
      data-placement={position.placement}
      role="toolbar"
      style={{
        gridTemplateColumns: actionWidths.length
          ? actionWidths.map((width) => `minmax(0, ${width}fr)`).join(" ")
          : "minmax(0, 1fr)",
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${position.width}px`,
      }}
    >
      {actions.map((id) => {
        const Icon = typeof id === "string" ? icons[id] : null;
        const label = selectionActionLabel(id);
        return (
          <button
            key={selectionActionKey(id)}
            aria-label={label}
            className="selection-action selection-search-action"
            onClick={(event) => onAction(id, opensInNewTab(openMode, event))}
            onAuxClick={(event) => {
              if (event.button === 1) onAction(id, true);
            }}
            onMouseDown={(event) => {
              // Stop middle-click autoscroll so the auxclick reaches the button.
              if (event.button === 1) event.preventDefault();
            }}
            onPointerDown={(event) => event.preventDefault()}
            title={label}
            type="button"
          >
            {Icon ? <Icon size={16} /> : typeof id !== "string" ? <span aria-hidden="true" className="volt-hugeicon" style={{ fontSize: 16 }}>{String.fromCodePoint(id.iconCodepoint)}</span> : null}
            <span>{label}</span>
          </button>
        );
      })}
      <div className="selection-footer">
        <button
          aria-label="Copy selected text"
          className="selection-copy"
          onClick={onCopy}
          onPointerDown={(event) => event.preventDefault()}
          title="Copy selected text"
          type="button"
        >
          <Copy size={15} />
          <span>Copy</span>
        </button>
        <OpenModeSwitch mode={openMode} onChange={chooseOpenMode} />
      </div>
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
