export type LiveDictationPhase = "started" | "partial" | "final" | "stopped";

export type LiveDictationInsertion = {
  end: number;
  start: number;
  text: string;
};

export type LiveDictationReplacementInput = {
  current: string;
  existing?: LiveDictationInsertion;
  phase: LiveDictationPhase;
  selectionEnd?: number;
  selectionStart?: number;
  text?: string;
};

export type LiveDictationReplacementResult = {
  inserted: boolean;
  insertion: LiveDictationInsertion | null;
  value: string;
};

export function nextReviewInputAfterLiveDictation({
  current,
  existing,
  phase,
  selectionEnd,
  selectionStart,
  text,
}: LiveDictationReplacementInput): LiveDictationReplacementResult {
  if (phase === "started" || phase === "stopped") {
    return { inserted: false, insertion: null, value: current };
  }

  const nextText = text?.trim();
  if (!nextText) return { inserted: false, insertion: existing ?? null, value: current };

  let start = current.length;
  let end = current.length;

  if (existing && current.slice(existing.start, existing.end) === existing.text) {
    start = existing.start;
    end = existing.end;
  } else if (existing?.text) {
    const fallbackStart = current.lastIndexOf(existing.text);
    if (fallbackStart >= 0) {
      start = fallbackStart;
      end = fallbackStart + existing.text.length;
    }
  } else {
    start = selectionStart ?? current.length;
    end = selectionEnd ?? current.length;
  }

  const value = `${current.slice(0, start)}${nextText}${current.slice(end)}`;
  return {
    inserted: true,
    insertion: phase === "final" ? null : { start, end: start + nextText.length, text: nextText },
    value,
  };
}
