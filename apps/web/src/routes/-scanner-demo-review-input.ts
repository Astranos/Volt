import { useCallback, useRef, useState } from "react";
import type { ScannerControlMessage } from "@volt/scanner-protocol";
import { nextReviewInputAfterLiveDictation, type LiveDictationInsertion } from "./-scanner-demo-dictation";

export function useScannerReviewInput() {
  const [reviewInputValue, setReviewInputValue] = useState("");
  const reviewInputRef = useRef<HTMLTextAreaElement | null>(null);
  const reviewInputValueRef = useRef("");
  const liveDictationInsertionsRef = useRef(new Map<string, LiveDictationInsertion>());
  const insertIntoReviewInput = useCallback((value: string) => {
    if (!value) return false;

    const input = reviewInputRef.current;
    const current = reviewInputValueRef.current;
    const start = input?.selectionStart ?? current.length;
    const end = input?.selectionEnd ?? current.length;
    const nextValue = input
      ? `${current.slice(0, start)}${value}${current.slice(end)}`
      : current
        ? `${current}\n${value}`
        : value;
    reviewInputValueRef.current = nextValue;
    setReviewInputValue(nextValue);

    window.requestAnimationFrame(() => {
      const inputAfterRender = reviewInputRef.current;
      if (!inputAfterRender) return;
      inputAfterRender.focus();
      const insertionPoint = inputAfterRender.value.length;
      inputAfterRender.setSelectionRange(insertionPoint, insertionPoint);
    });

    return true;
  }, []);

  const replaceLiveDictationInReviewInput = useCallback(
    (message: Extract<ScannerControlMessage, { type: "dictation" }>) => {
      const liveSessionId = message.dictationSessionId;
      if (message.phase === "started" || message.phase === "stopped") {
        liveDictationInsertionsRef.current.delete(liveSessionId);
        return false;
      }

      const value = message.text?.trim();
      if (!value) return false;

      const current = reviewInputValueRef.current;
      const existing = liveDictationInsertionsRef.current.get(liveSessionId);
      const input = reviewInputRef.current;
      const result = nextReviewInputAfterLiveDictation({
        current,
        existing,
        phase: message.phase,
        selectionEnd: input?.selectionEnd ?? current.length,
        selectionStart: input?.selectionStart ?? current.length,
        text: value,
      });
      reviewInputValueRef.current = result.value;
      if (result.insertion) {
        liveDictationInsertionsRef.current.set(
          liveSessionId,
          result.insertion,
        );
      } else {
        liveDictationInsertionsRef.current.delete(liveSessionId);
      }
      setReviewInputValue(result.value);

      window.requestAnimationFrame(() => {
        const inputAfterRender = reviewInputRef.current;
        if (!inputAfterRender) return;
        const liveInsertion =
          liveDictationInsertionsRef.current.get(liveSessionId);
        if (!liveInsertion) return;
        inputAfterRender.focus();
        inputAfterRender.setSelectionRange(
          liveInsertion.end,
          liveInsertion.end,
        );
      });

      return true;
    },
    [],
  );

  const handleReviewInputChange = useCallback((value: string) => {
    reviewInputValueRef.current = value;
    setReviewInputValue(value);
  }, []);


  const clearDictationInsertions = useCallback(() => {
    liveDictationInsertionsRef.current.clear();
  }, []);

  return {
    reviewInputValue, reviewInputRef, handleReviewInputChange,
    insertIntoReviewInput, replaceLiveDictationInReviewInput,
    clearDictationInsertions,
  };
}
