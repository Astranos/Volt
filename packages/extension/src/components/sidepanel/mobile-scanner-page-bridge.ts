export function installEditableTracker() {
  const root = window as typeof window & {
    __voltLastEditable?: HTMLElement | null;
    __voltLastEditableSelection?: {
      start?: number | null;
      end?: number | null;
      isContentEditable?: boolean;
    } | null;
    __voltLastEditableRange?: Range | null;
    __voltLiveDictation?: {
      sessionId?: string;
      sourceLength?: number;
    } | null;
    __voltEditableTrackerInstalled?: boolean;
  };

  const isEditable = (element: Element | null): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.getAttribute("contenteditable") === "false") return false;
    const isDesignModeEditable =
      document.designMode?.toLowerCase() === "on" &&
      (element === document.body || element === document.documentElement);
    return (
      element.tagName === "INPUT" ||
      element.tagName === "TEXTAREA" ||
      element.isContentEditable ||
      isDesignModeEditable
    );
  };

  const describeEditable = (element: HTMLElement) => {
    const label =
      element.getAttribute("aria-label") ||
      element.getAttribute("placeholder") ||
      element.getAttribute("name") ||
      element.getAttribute("id") ||
      (document.designMode?.toLowerCase() === "on" &&
      (element === document.body || element === document.documentElement)
        ? "Rich text editor"
        : "") ||
      (element.tagName === "TEXTAREA"
        ? "Textarea"
        : element.isContentEditable
          ? "Editable text"
          : "Text input");
    return String(label).slice(0, 120);
  };

  const notifyTarget = (element: HTMLElement) => {
    try {
      chrome.runtime.sendMessage({
        action: "mobileCursorTargetChanged",
        target: {
          browser: "Chrome",
          tabTitle: document.title || "Current tab",
          url: location.href,
          cursor: describeEditable(element),
          updatedAt: Date.now(),
        },
      });
    } catch (_error) {}
  };

  const track = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : document.activeElement;
    const editable =
      isEditable(element) ? element : isEditable(document.activeElement) ? document.activeElement : null;
    if (!editable) return;
    if (root.__voltLiveDictation && root.__voltLastEditable !== editable) {
      root.__voltLiveDictation = {
        sessionId: root.__voltLiveDictation.sessionId,
        sourceLength: root.__voltLiveDictation.sourceLength ?? 0,
      };
    }
    root.__voltLastEditable = editable;
    if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
      root.__voltLastEditableSelection = {
        start: editable.selectionStart,
        end: editable.selectionEnd,
        isContentEditable: false,
      };
      root.__voltLastEditableRange = null;
    } else {
      root.__voltLastEditableSelection = { isContentEditable: true };
      const selection = window.getSelection();
      root.__voltLastEditableRange =
        selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    }
    notifyTarget(editable);
  };

  track(document.activeElement);

  if (root.__voltEditableTrackerInstalled) return;
  document.addEventListener("focusin", (event) => track(event.target), true);
  document.addEventListener("selectionchange", () => track(document.activeElement), true);
  document.addEventListener("keyup", (event) => track(event.target), true);
  document.addEventListener("pointerup", (event) => track(event.target), true);
  root.__voltEditableTrackerInstalled = true;
}
