import type { ScannerTextInsertOptions } from "./scanner-text-insertion";

export type LiveDictationDraft = {
  draftId: string;
  text: string;
  updatedAt: number;
};

type CloudLiveDictationControllerOptions = {
  insertScannerText: (
    text: string,
    options?: ScannerTextInsertOptions,
  ) => Promise<boolean>;
  log: (...args: unknown[]) => void;
};

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeLiveDictationDrafts(value: unknown): LiveDictationDraft[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      const record = recordFrom(item);
      if (
        !record
        || typeof record.draftId !== "string"
        || !record.draftId
        || typeof record.text !== "string"
        || typeof record.updatedAt !== "number"
        || !Number.isFinite(record.updatedAt)
      ) return [];
      return [{
        draftId: record.draftId,
        text: record.text,
        updatedAt: record.updatedAt,
      }];
    })
    .sort((lhs, rhs) => rhs.updatedAt - lhs.updatedAt);
}

export function createCloudLiveDictationController({
  insertScannerText,
  log,
}: CloudLiveDictationControllerOptions) {
  const lastAppliedUpdate = new Map<string, number>();
  const finalizedDraftIds = new Set<string>();
  let activeDraftId: string | null = null;
  let processing = Promise.resolve();

  function finalizeDraft(draftId: string) {
    finalizedDraftIds.add(draftId);
    lastAppliedUpdate.delete(draftId);
    if (activeDraftId === draftId) activeDraftId = null;
    if (finalizedDraftIds.size > 100) {
      const oldest = finalizedDraftIds.values().next().value;
      if (typeof oldest === "string") finalizedDraftIds.delete(oldest);
    }
  }

  function handleDrafts(value: unknown) {
    const draft = normalizeLiveDictationDrafts(value)[0];
    processing = processing
      .then(async () => {
        if (
          activeDraftId
          && activeDraftId !== draft?.draftId
          && !finalizedDraftIds.has(activeDraftId)
        ) {
          const canceledDraftId = activeDraftId;
          activeDraftId = null;
          lastAppliedUpdate.delete(canceledDraftId);
          await insertScannerText("", {
            dictationPhase: "cancel",
            dictationSessionId: canceledDraftId,
            format: "dictation",
            kind: "text",
          });
        }
        if (!draft) return;
        if (finalizedDraftIds.has(draft.draftId)) return;
        if ((lastAppliedUpdate.get(draft.draftId) ?? -1) >= draft.updatedAt) return;
        const inserted = await insertScannerText(draft.text, {
          dictationPhase: "partial",
          dictationSessionId: draft.draftId,
          format: "dictation",
          kind: "text",
        });
        if (inserted) {
          activeDraftId = draft.draftId;
          lastAppliedUpdate.set(draft.draftId, draft.updatedAt);
        }
      })
      .catch((error: unknown) => {
        log(
          "cloud live dictation insertion failed",
          error instanceof Error ? error.message : error,
        );
      });
    return processing;
  }

  return { finalizeDraft, handleDrafts };
}
