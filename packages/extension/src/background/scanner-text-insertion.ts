type LogFn = (...args: unknown[]) => void;

export type MobileCursorTarget = {
  browser?: string;
  tabTitle?: string;
  url?: string;
  cursor?: string;
  frameId?: number;
  updatedAt?: number;
};

export type ScannerTextInsertOptions = {
  dictationPhase?: "partial" | "final";
  dictationSessionId?: string;
  format?: string;
  kind?: string;
};

type ScannerTextInserterOptions = {
  chromeApi: typeof chrome;
  log: LogFn;
  getTrackedTarget: (tabId: number) => MobileCursorTarget | null;
  copyWithOffscreen: (text: string) => Promise<unknown>;
};

type DictationInsertionResult = {
  inserted: boolean;
  dictationSessionId: string;
  final: boolean;
  sourceLength: number;
};

type ScannerTextInsertionResult = {
  inserted: boolean;
  dictationSessionId?: string;
  final?: boolean;
  sourceLength?: number;
};

export function insertTextAtTrackedEditableFromBackground(
  value: string,
  options: ScannerTextInsertOptions & { dictationSourceLength?: number } = {}
): ScannerTextInsertionResult | null | undefined {
  const root = window as typeof window & {
    __voltEditableTrackerInstalled?: boolean;
    __voltLastEditable?: HTMLElement | null;
    __voltLastEditableRange?: Range | null;
    __voltLastEditableSelection?: {
      start?: number;
      end?: number;
      isContentEditable?: boolean;
    } | null;
    __voltLiveDictation?: {
      sessionId?: string | null;
      target?: Element | null;
      node?: Text | null;
      start?: number;
      end?: number;
      sourceStart?: number;
      sourceLength?: number;
    } | null;
  };
  const liveSessionId =
    typeof options.dictationSessionId === "string" ? options.dictationSessionId : null;
  const livePhase =
    options.dictationPhase === "partial" || options.dictationPhase === "final"
      ? options.dictationPhase
      : null;
  const isLiveDictation = options.format === "dictation" && liveSessionId;
  const optionSourceLength =
    typeof options.dictationSourceLength === "number" && options.dictationSourceLength > 0
      ? options.dictationSourceLength
      : 0;
  const dictationResult = () =>
    isLiveDictation
      ? { inserted: true, dictationSessionId: liveSessionId, final: livePhase === "final", sourceLength: value.length }
      : null;
  const insertedResult = () => dictationResult() ?? { inserted: true };
  const notInsertedResult = () =>
    isLiveDictation
      ? { inserted: false, dictationSessionId: liveSessionId, final: livePhase === "final", sourceLength: value.length }
      : { inserted: false };
  const liveDictationDelta = (sourceLength: number) => {
    const delta = value.slice(sourceLength);
    return sourceLength > 0 ? delta : delta.trimStart();
  };

  const isEditable = (element: unknown): element is HTMLElement & { value?: string } => {
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

  const isRichEditable = (element: HTMLElement) =>
    element?.isContentEditable ||
    (document.designMode?.toLowerCase() === "on" &&
      (element === document.body || element === document.documentElement));

  const dispatchTextInputEvents = (element: Element, text: string, inputType = "insertText") => {
    try {
      element.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          composed: true,
          inputType,
          data: text,
        })
      );
    } catch (_) {}
    try {
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType,
          data: text,
        })
      );
    } catch (_) {
      element.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
  };

  const setNativeTextControlValue = (input: HTMLInputElement | HTMLTextAreaElement, nextValue: string) => {
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(input, nextValue);
    else input.value = nextValue;
  };

  if (isEditable(document.activeElement)) {
    root.__voltLastEditable = document.activeElement;
  }

  if (!root.__voltEditableTrackerInstalled) {
    document.addEventListener(
      "focusin",
      (event) => {
        const target = event.target;
    const editableTarget = target instanceof HTMLElement ? target : null;
        if (isEditable(editableTarget)) {
          if (root.__voltLiveDictation?.target !== editableTarget) {
            root.__voltLiveDictation = root.__voltLiveDictation
              ? {
                  sessionId: root.__voltLiveDictation.sessionId,
                  sourceStart: root.__voltLiveDictation.sourceLength ?? 0,
                  sourceLength: root.__voltLiveDictation.sourceLength ?? 0,
                }
              : null;
          }
          root.__voltLastEditable = editableTarget;
        }
      },
      true
    );
    root.__voltEditableTrackerInstalled = true;
  }

  const activeElement = document.activeElement;
  const target = isEditable(activeElement)
    ? activeElement
    : isEditable(root.__voltLastEditable ?? null)
    ? root.__voltLastEditable
    : null;

  if (!target) {
    if (isLiveDictation && livePhase === "partial") return notInsertedResult();
    navigator.clipboard.writeText(value).catch(() => {});
    return notInsertedResult();
  }

  target.focus();
  if (isRichEditable(target)) {
    const selection = window.getSelection();
    const trackedRange =
      root.__voltLastEditable === target && root.__voltLastEditableRange?.commonAncestorContainer?.isConnected
        ? root.__voltLastEditableRange
        : null;
    if (trackedRange && selection) {
      selection.removeAllRanges();
      selection.addRange(trackedRange);
    }
    const live = root.__voltLiveDictation;
    const liveSourceLength =
      live?.sessionId === liveSessionId && typeof live.sourceLength === "number"
        ? live.sourceLength
        : optionSourceLength;
    const liveSourceStart =
      live?.sessionId === liveSessionId && typeof live.sourceStart === "number"
        ? live.sourceStart
        : 0;
    const selectionStillAtLiveNode = (() => {
      if (!selection || !live?.node?.isConnected || selection.rangeCount === 0) return false;
      const range = selection.getRangeAt(0);
      return (
        range.collapsed &&
        range.startContainer === live.node.parentNode &&
        range.startOffset === Array.prototype.indexOf.call(live.node.parentNode?.childNodes ?? [], live.node) + 1
      );
    })();
    if (
      isLiveDictation &&
      live?.sessionId === liveSessionId &&
      live.target === target &&
      live.node?.isConnected &&
      selectionStillAtLiveNode
    ) {
      live.node.nodeValue = liveDictationDelta(liveSourceStart);
      live.sourceLength = value.length;
      const range = document.createRange();
      range.setStartAfter(live.node);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (livePhase === "final") root.__voltLiveDictation = null;
      dispatchTextInputEvents(target, live.node.nodeValue || "", "insertReplacementText");
    } else if (isLiveDictation && selection) {
      const nextValue = live?.sessionId === liveSessionId ? liveDictationDelta(liveSourceLength) : value;
      if (!nextValue) {
        root.__voltLiveDictation =
          livePhase === "final"
            ? null
            : { sessionId: liveSessionId, sourceStart: value.length, sourceLength: value.length };
        return insertedResult();
      }
      const range =
        selection.rangeCount > 0
          ? selection.getRangeAt(0)
          : document.createRange();
      if (selection.rangeCount === 0) {
        range.selectNodeContents(target);
        range.collapse(false);
      }
      range.deleteContents();
      const node = document.createTextNode(nextValue);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      root.__voltLiveDictation =
        livePhase === "final"
          ? null
          : { sessionId: liveSessionId, target, node, sourceStart: liveSourceLength, sourceLength: value.length };
      dispatchTextInputEvents(target, nextValue, "insertText");
    } else {
      document.execCommand("insertText", false, value);
      dispatchTextInputEvents(target, value, "insertText");
    }
    target.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    root.__voltLastEditableRange = null;
    return insertedResult();
  }

  const input = target as HTMLInputElement | HTMLTextAreaElement;
  const live = root.__voltLiveDictation;
  const replaceLiveInput =
    isLiveDictation &&
    live?.sessionId === liveSessionId &&
    live.target === input &&
    typeof live.start === "number" &&
    typeof live.end === "number" &&
    input.selectionStart === live.end &&
    input.selectionEnd === live.end;
  const trackedSelection =
    root.__voltLastEditable === input &&
    root.__voltLastEditableSelection &&
    root.__voltLastEditableSelection.isContentEditable !== true
      ? root.__voltLastEditableSelection
      : null;
  const liveSourceLength =
    live?.sessionId === liveSessionId && typeof live.sourceLength === "number"
      ? live.sourceLength
      : optionSourceLength;
  const liveSourceStart =
    live?.sessionId === liveSessionId && typeof live.sourceStart === "number"
      ? live.sourceStart
      : 0;
  const nextValue =
    isLiveDictation && live?.sessionId === liveSessionId
      ? liveDictationDelta(replaceLiveInput ? liveSourceStart : liveSourceLength)
      : value;
  if (isLiveDictation && !nextValue) {
    root.__voltLiveDictation =
      livePhase === "final"
        ? null
        : { sessionId: liveSessionId, sourceStart: value.length, sourceLength: value.length };
    return insertedResult();
  }
  const start = replaceLiveInput
    ? live.start ?? 0
    : typeof trackedSelection?.start === "number"
    ? trackedSelection.start
    : input.selectionStart ?? input.value.length;
  const end = replaceLiveInput
    ? live.end ?? start
    : typeof trackedSelection?.end === "number"
    ? trackedSelection.end
    : input.selectionEnd ?? input.value.length;
  const replacementEnd = start + nextValue.length;
  setNativeTextControlValue(input, input.value.slice(0, start) + nextValue + input.value.slice(end));
  input.selectionStart = input.selectionEnd = replacementEnd;
  if (isLiveDictation) {
    root.__voltLiveDictation =
      livePhase === "final"
        ? null
        : {
            sessionId: liveSessionId,
            target: input,
            start,
            end: replacementEnd,
            sourceStart: replaceLiveInput ? liveSourceStart : liveSourceLength,
            sourceLength: value.length,
          };
  }
  dispatchTextInputEvents(input, nextValue, replaceLiveInput ? "insertReplacementText" : "insertText");
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  root.__voltLastEditableSelection = null;
  return insertedResult();
}

export function createScannerTextInserter({
  chromeApi,
  log,
  getTrackedTarget,
  copyWithOffscreen,
}: ScannerTextInserterOptions) {
  const liveDictationSourceLengths = new Map<string, number>();

  async function insertScannerText(text: string, options: ScannerTextInsertOptions = {}) {
    try {
      const [tab] = await chromeApi.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        await copyWithOffscreen(text);
        return false;
      }

      const trackedInsertionTarget = getTrackedTarget(tab.id);
      const targetFrameId =
        typeof trackedInsertionTarget?.frameId === "number"
          ? trackedInsertionTarget.frameId
          : null;
      const injectionTarget =
        targetFrameId === null
          ? { tabId: tab.id }
          : { tabId: tab.id, frameIds: [targetFrameId] };
      const injectionArgs: [
        string,
        ScannerTextInsertOptions & { dictationSourceLength: number },
      ] = [
        text,
        {
          ...options,
          dictationSourceLength:
            typeof options.dictationSessionId === "string"
              ? liveDictationSourceLengths.get(options.dictationSessionId) ?? 0
              : 0,
        },
      ];
      let injectionResults;
      try {
        injectionResults = await chromeApi.scripting.executeScript({
          target: injectionTarget,
          func: insertTextAtTrackedEditableFromBackground,
          args: injectionArgs,
        });
      } catch (frameErr) {
        if (targetFrameId === null) throw frameErr;
        log("scanner frame insert fallback", frameErr instanceof Error ? frameErr.message : frameErr);
        injectionResults = await chromeApi.scripting.executeScript({
          target: { tabId: tab.id },
          func: insertTextAtTrackedEditableFromBackground,
          args: injectionArgs,
        });
      }
      const injectionResult = injectionResults?.[0]?.result;
      if (injectionResult?.dictationSessionId) {
        if (injectionResult.final) {
          liveDictationSourceLengths.delete(injectionResult.dictationSessionId);
        } else if (typeof injectionResult.sourceLength === "number") {
          liveDictationSourceLengths.set(injectionResult.dictationSessionId, injectionResult.sourceLength);
        }
      }
      return injectionResult?.inserted === true;
    } catch (err) {
      log("scanner insert fallback", err instanceof Error ? err.message : err);
      try {
        await copyWithOffscreen(text);
      } catch (clipboardErr) {
        log("scanner clipboard fallback failed", clipboardErr instanceof Error ? clipboardErr.message : clipboardErr);
      }
      return false;
    }
  }

  return { insertScannerText };
}
