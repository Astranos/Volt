import { describe, expect, test } from "vitest";

import {
  nextReviewInputAfterLiveDictation,
  type LiveDictationInsertion,
} from "./-scanner-demo-dictation";

describe("nextReviewInputAfterLiveDictation", () => {
  test("replaces cumulative dictation partials instead of appending each one", () => {
    let value = "";
    let insertion: LiveDictationInsertion | null = null;

    for (const text of ["Hello", "Hello this", "Hello this is", "Hello this is working"]) {
      const result = nextReviewInputAfterLiveDictation({
        current: value,
        existing: insertion ?? undefined,
        phase: "partial",
        text,
      });
      value = result.value;
      insertion = result.insertion;
    }

    expect(value).toBe("Hello this is working");
  });

  test("final dictation commits the latest text and clears the live insertion", () => {
    const partial = nextReviewInputAfterLiveDictation({
      current: "",
      phase: "partial",
      text: "Hello this",
    });
    const final = nextReviewInputAfterLiveDictation({
      current: partial.value,
      existing: partial.insertion ?? undefined,
      phase: "final",
      text: "Hello this is working",
    });

    expect(final.value).toBe("Hello this is working");
    expect(final.insertion).toBeNull();
  });
});
