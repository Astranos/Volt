import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteMobileScannerResults,
  listMobileScannerResults,
  MOBILE_SCANNER_DELETE_UNDO_WINDOW_MS,
  purgeExpiredMobileScannerDeletedResults,
  restoreMobileScannerResults,
} from "../domain/mobile-scanner-results";
import {
  deleteTimelineEntries,
  deleteTimelineSelection,
  deriveTimelineState,
  toggleTimelineBatchExpansion,
  toggleTimelinePhotoSelection,
  type TimelineEntry,
} from "../domain/mobile-scanner-timeline";
import type { SidepanelToastTone } from "../lib/sidepanel-toast";

const EXIT_ANIMATION_MS = 180;
const UNDO_WINDOW_MS = MOBILE_SCANNER_DELETE_UNDO_WINDOW_MS;

type DeletedSnapshot = {
  results: TimelineEntry[];
  timer: number;
  label: string;
};

export function useMobileScannerHistory({
  flashFeedback,
}: {
  flashFeedback: (message: string, tone?: SidepanelToastTone) => void;
}) {
  const [results, setResults] = useState<TimelineEntry[]>([]);
  const [loadingResults, setLoadingResults] = useState(true);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [expandedBatchIds, setExpandedBatchIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [deletedSnapshot, setDeletedSnapshot] = useState<DeletedSnapshot | null>(null);
  const lastSelectedPhotoId = useRef<string | null>(null);

  const {
    photoResults,
    photos,
    photoOrder,
    selectedPhotos,
    groups,
  } = useMemo(
    () => deriveTimelineState(results, selectedPhotoIds),
    [results, selectedPhotoIds],
  );

  const refreshResults = useCallback(async () => {
    const loaded = await listMobileScannerResults();
    setResults(loaded as TimelineEntry[]);
    setLoadingResults(false);
  }, []);

  const deleteResults = useCallback(
    (ids: string[], label: string) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      const snapshot = results.filter((result) => idSet.has(result.id));
      if (snapshot.length === 0) return;
      setRemovingIds((current) => new Set([...current, ...ids]));
      window.setTimeout(() => {
        setResults((current) =>
          deleteTimelineEntries({
            results: current,
            selectedPhotoIds: new Set(),
            ids,
          }).remaining,
        );
        setSelectedPhotoIds((current) => deleteTimelineSelection(current, ids));
        void deleteMobileScannerResults(ids);
        if (deletedSnapshot?.timer) window.clearTimeout(deletedSnapshot.timer);
        const timer = window.setTimeout(() => {
          setDeletedSnapshot(null);
          void purgeExpiredMobileScannerDeletedResults();
        }, UNDO_WINDOW_MS);
        setDeletedSnapshot({ results: snapshot, timer, label });
        setRemovingIds((current) => {
          const next = new Set(current);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }, EXIT_ANIMATION_MS);
    },
    [deletedSnapshot, results],
  );

  const undoDelete = useCallback(async () => {
    if (!deletedSnapshot) return;
    window.clearTimeout(deletedSnapshot.timer);
    await restoreMobileScannerResults(deletedSnapshot.results);
    setDeletedSnapshot(null);
    await refreshResults();
    flashFeedback("Restored");
  }, [deletedSnapshot, flashFeedback, refreshResults]);

  const togglePhotoSelection = useCallback(
    (id: string, shiftKey = false) => {
      setSelectedPhotoIds((current) =>
        toggleTimelinePhotoSelection({
          selectedPhotoIds: current,
          photoOrder,
          id,
          anchorId: lastSelectedPhotoId.current,
          shiftKey,
        }),
      );
      lastSelectedPhotoId.current = id;
    },
    [photoOrder],
  );

  const toggleBatchExpansion = useCallback((batchId: string) => {
    setExpandedBatchIds((current) => toggleTimelineBatchExpansion(current, batchId));
  }, []);

  useEffect(() => {
    return () => {
      if (deletedSnapshot?.timer) window.clearTimeout(deletedSnapshot.timer);
      photos.forEach((photo) => {
        if (photo.dataUrl?.startsWith("blob:")) URL.revokeObjectURL(photo.dataUrl);
      });
    };
  }, [deletedSnapshot, photos]);

  return {
    results,
    setResults,
    loadingResults,
    selectedPhotoIds,
    setSelectedPhotoIds,
    expandedBatchIds,
    removingIds,
    deletedSnapshot,
    photoResults,
    photos,
    selectedPhotos,
    groups,
    refreshResults,
    deleteResults,
    undoDelete,
    togglePhotoSelection,
    toggleBatchExpansion,
  };
}
