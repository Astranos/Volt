import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteMobileScannerResults,
  listMobileScannerResults,
  MOBILE_SCANNER_DELETE_UNDO_WINDOW_MS,
  purgeExpiredMobileScannerDeletedResults,
  restoreMobileScannerResults,
  type HydratedMobileScannerPhotoResult,
} from "../domain/mobile-scanner-results";
import {
  buildTimelineGroups,
  photoFromResult,
  type TimelineEntry,
} from "../components/sidepanel/mobile-scanner-timeline";
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

  const photoResults = useMemo(
    () =>
      results.filter(
        (result): result is HydratedMobileScannerPhotoResult =>
          result.type === "photo",
      ),
    [results],
  );
  const photos = useMemo(() => photoResults.map(photoFromResult), [photoResults]);
  const photoOrder = useMemo(() => photoResults.map((result) => result.id), [photoResults]);
  const selectedPhotos = useMemo(
    () => photos.filter((photo) => selectedPhotoIds.has(photo.id)),
    [photos, selectedPhotoIds],
  );
  const groups = useMemo(() => buildTimelineGroups(results), [results]);

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
        setResults((current) => current.filter((result) => !idSet.has(result.id)));
        setSelectedPhotoIds((current) => {
          const next = new Set(current);
          ids.forEach((id) => next.delete(id));
          return next;
        });
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
      setSelectedPhotoIds((current) => {
        const next = new Set(current);
        if (shiftKey && lastSelectedPhotoId.current) {
          const anchorIndex = photoOrder.indexOf(lastSelectedPhotoId.current);
          const targetIndex = photoOrder.indexOf(id);
          if (anchorIndex >= 0 && targetIndex >= 0) {
            const [start, end] = [anchorIndex, targetIndex].sort((a, b) => a - b);
            photoOrder.slice(start, end + 1).forEach((photoId) => next.add(photoId));
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastSelectedPhotoId.current = id;
    },
    [photoOrder],
  );

  const toggleBatchExpansion = useCallback((batchId: string) => {
    setExpandedBatchIds((current) => {
      const next = new Set(current);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
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
