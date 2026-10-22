import { normalizeSelectionSuggestionText } from "../domain/selection-suggestions";

/**
 * Reads the page's current text selection: its normalized text, whether it sits
 * in an editable field, and the box around its visible line rects.
 */
export function readPageSelection() {
  const pageSelection = window.getSelection();
  if (
    !pageSelection ||
    pageSelection.isCollapsed ||
    pageSelection.rangeCount === 0
  ) {
    return null;
  }

  const selection = normalizeSelectionSuggestionText(
    pageSelection.toString(),
  );
  const selectionNode = pageSelection.anchorNode;
  const selectionElement =
    selectionNode instanceof Element
      ? selectionNode
      : selectionNode?.parentElement ?? null;
  const isEditable =
    document.designMode?.toLowerCase() === "on" ||
    Boolean(
      selectionElement?.closest(
        "input, textarea, [contenteditable=''], [contenteditable='true'], [role='textbox']",
      ),
    );
  const range = pageSelection.getRangeAt(0);
  const visibleRects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  const sourceRect = range.getBoundingClientRect();
  const selectionTop = visibleRects.reduce(
    (top, rect) => Math.min(top, rect.top),
    sourceRect.top,
  );
  const selectionBottom = visibleRects.reduce(
    (bottom, rect) => Math.max(bottom, rect.bottom),
    sourceRect.bottom,
  );
  const selectionLeft = visibleRects.reduce(
    (left, rect) => Math.min(left, rect.left),
    sourceRect.left,
  );
  const selectionRight = visibleRects.reduce(
    (right, rect) => Math.max(right, rect.right),
    sourceRect.right,
  );
  const rect = {
    bottom: selectionBottom,
    height: selectionBottom - selectionTop,
    left: selectionLeft,
    top: selectionTop,
    width: selectionRight - selectionLeft,
  };

  return { isEditable, rect, selection };
}
