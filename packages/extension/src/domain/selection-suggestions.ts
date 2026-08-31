export const SELECTION_SUGGESTION_MIN_LENGTH = 2;
export const SELECTION_SUGGESTION_MAX_LENGTH = 300;
export const SELECTION_SUGGESTION_PILL_WIDTH = 386;
export const SELECTION_SUGGESTION_PILL_HEIGHT = 80;
export const SELECTION_SUGGESTION_VIEWPORT_MARGIN = 8;
export const SELECTION_SUGGESTION_GAP = 10;

export type SelectionRect = {
  bottom: number;
  height: number;
  left: number;
  top: number;
  width: number;
};

export function normalizeSelectionSuggestionText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function shouldShowSelectionSuggestions({
  enabled,
  isEditable,
  rect,
  selection,
}: {
  enabled: boolean;
  isEditable: boolean;
  rect: SelectionRect;
  selection: string;
}) {
  const normalized = normalizeSelectionSuggestionText(selection);
  return (
    enabled &&
    !isEditable &&
    normalized.length >= SELECTION_SUGGESTION_MIN_LENGTH &&
    normalized.length <= SELECTION_SUGGESTION_MAX_LENGTH &&
    rect.width > 0 &&
    rect.height > 0
  );
}

export function positionSelectionSuggestions({
  pillHeight = SELECTION_SUGGESTION_PILL_HEIGHT,
  pillWidth = SELECTION_SUGGESTION_PILL_WIDTH,
  rect,
  viewportHeight,
  viewportWidth,
}: {
  pillHeight?: number;
  pillWidth?: number;
  rect: SelectionRect;
  viewportHeight: number;
  viewportWidth: number;
}) {
  const margin = SELECTION_SUGGESTION_VIEWPORT_MARGIN;
  const gap = SELECTION_SUGGESTION_GAP;
  const availableWidth = Math.max(0, viewportWidth - margin * 2);
  const renderedWidth = Math.min(pillWidth, availableWidth);
  const centeredLeft = rect.left + rect.width / 2 - renderedWidth / 2;
  const left = Math.min(
    Math.max(centeredLeft, margin),
    Math.max(margin, viewportWidth - renderedWidth - margin),
  );
  const fitsAbove = rect.top >= pillHeight + gap + margin;
  const preferredTop = fitsAbove
    ? rect.top - pillHeight - gap
    : rect.bottom + gap;
  const top = Math.min(
    Math.max(preferredTop, margin),
    Math.max(margin, viewportHeight - pillHeight - margin),
  );

  return {
    left,
    placement: fitsAbove ? ("above" as const) : ("below" as const),
    top,
    width: renderedWidth,
  };
}
