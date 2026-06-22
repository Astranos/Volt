/* global chrome */

import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";

type MobileCaptureMode = "ocr" | "barcode" | "dictation";

type ChromeRuntimeApi = {
  runtime: {
    lastError?: { message?: string };
    sendMessage(
      message: unknown,
      responseCallback?: (response?: { success?: boolean; error?: unknown }) => void,
    ): void;
  };
};

type EditableRoot = typeof window & {
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

type MobileCaptureControllerOptions = {
  getFocusedElement: () => HTMLElement | null;
  getClickedElement: () => HTMLElement | null;
  log: (...args: unknown[]) => void;
};

declare const chrome: ChromeRuntimeApi;

const getEditableRoot = () => window as EditableRoot;

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

const rememberEditableSelection = (
  root: EditableRoot,
  editable: HTMLElement,
) => {
  root.__voltLastEditable = editable;
  if (
    editable instanceof HTMLInputElement ||
    editable instanceof HTMLTextAreaElement
  ) {
    root.__voltLastEditableSelection = {
      start: editable.selectionStart,
      end: editable.selectionEnd,
      isContentEditable: false,
    };
    root.__voltLastEditableRange = null;
    return;
  }

  root.__voltLastEditableSelection = { isContentEditable: true };
  const selection = window.getSelection();
  root.__voltLastEditableRange =
    selection && selection.rangeCount > 0
      ? selection.getRangeAt(0).cloneRange()
      : null;
};

const currentTargetMetadata = (editable: HTMLElement) => ({
  browser: "Chrome",
  tabTitle: document.title || "Current tab",
  url: location.href,
  cursor: describeEditable(editable),
  updatedAt: Date.now(),
});

export function createMobileCaptureController({
  getFocusedElement,
  getClickedElement,
  log,
}: MobileCaptureControllerOptions) {
  const primeEditableTarget = () => {
    const root = getEditableRoot();
    const focusedElement = getFocusedElement();
    const clickedElement = getClickedElement();
    const target = isEditable(focusedElement)
      ? focusedElement
      : isEditable(clickedElement)
        ? clickedElement
        : isEditable(document.activeElement)
          ? (document.activeElement as HTMLElement)
          : null;

    if (!target) return undefined;

    rememberEditableSelection(root, target);
    return currentTargetMetadata(target);
  };

  const installMobileCursorTargetTracker = () => {
    const root = getEditableRoot();
    if (root.__voltEditableTrackerInstalled) return;

    const rememberEditable = (editable: HTMLElement) => {
      if (root.__voltLiveDictation && root.__voltLastEditable !== editable) {
        root.__voltLiveDictation = {
          sessionId: root.__voltLiveDictation.sessionId,
          sourceLength: root.__voltLiveDictation.sourceLength ?? 0,
        };
      }

      rememberEditableSelection(root, editable);

      try {
        chrome.runtime.sendMessage({
          action: "mobileCursorTargetChanged",
          target: currentTargetMetadata(editable),
        });
      } catch (_) {}
    };

    const track = (target: EventTarget | null) => {
      const element =
        target instanceof Element ? target : document.activeElement;
      const editable = isEditable(element)
        ? element
        : isEditable(document.activeElement)
          ? document.activeElement
          : null;
      if (editable) rememberEditable(editable);
    };

    track(document.activeElement);
    document.addEventListener("focusin", (event) => track(event.target), true);
    document.addEventListener(
      "selectionchange",
      () => track(document.activeElement),
      true,
    );
    document.addEventListener("keyup", (event) => track(event.target), true);
    document.addEventListener("pointerup", (event) => track(event.target), true);
    root.__voltEditableTrackerInstalled = true;
  };

  const openMobileCapture = (mode: MobileCaptureMode) => {
    const target = primeEditableTarget();
    try {
      chrome.runtime.sendMessage(
        {
          action: "openMobileCapture",
          mode,
          surface: "popup",
          target,
        },
        (response) => {
          const lastError = chrome.runtime.lastError;
          if (lastError || response?.success === false) {
            log("Mobile capture start failed", lastError || response?.error);
          }
        },
      );
    } catch (_) {}
  };

  return {
    installMobileCursorTargetTracker,
    openMobileCapture,
  };
}

export default defineUnlistedScript(() => {});
