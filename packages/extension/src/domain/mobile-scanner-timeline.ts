import {
  groupPhotoResultsByBatch,
  type HydratedMobileScannerPhotoResult,
  type MobileScannerResultBroadcastMessage,
  type MobileScannerScanResult,
} from "./mobile-scanner-results.ts";
import type { BarcodeMessage } from "./mobile-scanner-session.ts";
import { type MobilePhoto } from "../components/sidepanel/mobile-photo-helpers.ts";

export type TimelineEntry =
  | MobileScannerScanResult
  | HydratedMobileScannerPhotoResult;

export type TimelineGroup =
  | {
      type: "scan";
      key: string;
      kind: "text" | "barcode";
      capturedAt: number;
      entries: MobileScannerScanResult[];
    }
  | {
      type: "photo";
      key: string;
      capturedAt: number;
      startAt: number;
      endAt: number;
      entries: HydratedMobileScannerPhotoResult[];
    };

export function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function formatRelativeTime(value: number, now: number) {
  const diff = now - value;
  if (diff < 45 * 1000) return "just now";
  if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.round(diff / 60000))}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.round(diff / 3600000)}h ago`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.round(diff / 86400000)}d ago`;
  return new Date(value).toLocaleDateString();
}

function createObjectUrl(blob: Blob | undefined) {
  return blob ? URL.createObjectURL(blob) : undefined;
}

function hydratePhotoRuntime(photo: MobilePhoto) {
  const runtimeUrl = photo.dataUrl ?? createObjectUrl(photo.blob);
  return runtimeUrl ? { ...photo, dataUrl: runtimeUrl } : photo;
}

export function photoFromResult(result: HydratedMobileScannerPhotoResult) {
  return hydratePhotoRuntime(result.photo);
}

export function firstDownloadedPhoto(photos: MobilePhoto[]) {
  return photos.find((photo) => typeof photo.downloadId === "number");
}

export function upsertTimelineEntry<T extends TimelineEntry>(results: T[], entry: T): T[] {
  return [entry, ...results.filter((item) => item.id !== entry.id)];
}

export function deriveTimelineState(results: TimelineEntry[], selectedPhotoIds: Set<string>) {
  const photoResults = results.filter(
    (result): result is HydratedMobileScannerPhotoResult =>
      result.type === "photo",
  );
  const photos = photoResults.map(photoFromResult);
  const selectedPhotos = photos.filter((photo) => selectedPhotoIds.has(photo.id));

  return {
    photoResults,
    photos,
    photoOrder: photoResults.map((result) => result.id),
    selectedPhotos,
    groups: buildTimelineGroups(results),
  };
}

export function toggleTimelinePhotoSelection({
  selectedPhotoIds,
  photoOrder,
  id,
  anchorId,
  shiftKey = false,
}: {
  selectedPhotoIds: Set<string>;
  photoOrder: string[];
  id: string;
  anchorId: string | null;
  shiftKey?: boolean;
}) {
  const next = new Set(selectedPhotoIds);
  if (shiftKey && anchorId) {
    const anchorIndex = photoOrder.indexOf(anchorId);
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
}

export function toggleTimelineBatchExpansion(expandedBatchIds: Set<string>, batchId: string) {
  const next = new Set(expandedBatchIds);
  if (next.has(batchId)) next.delete(batchId);
  else next.add(batchId);
  return next;
}

export function deleteTimelineEntries({
  results,
  selectedPhotoIds,
  ids,
}: {
  results: TimelineEntry[];
  selectedPhotoIds: Set<string>;
  ids: string[];
}) {
  const idSet = new Set(ids);
  const deleted = results.filter((result) => idSet.has(result.id));
  const remaining = results.filter((result) => !idSet.has(result.id));

  return {
    deleted,
    remaining,
    selectedPhotoIds: deleteTimelineSelection(selectedPhotoIds, ids),
  };
}

export function deleteTimelineSelection(selectedPhotoIds: Set<string>, ids: string[]) {
  const next = new Set(selectedPhotoIds);
  ids.forEach((id) => next.delete(id));
  return next;
}

export function resolvePhotoDragSelection({
  photo,
  selectedPhotoIds,
  selectedPhotos,
}: {
  photo: MobilePhoto;
  selectedPhotoIds: Set<string>;
  selectedPhotos: MobilePhoto[];
}) {
  if (selectedPhotoIds.has(photo.id)) {
    return {
      sourcePhotos: selectedPhotos,
      selectedPhotoIds,
    };
  }

  return {
    sourcePhotos: [photo],
    selectedPhotoIds: new Set([photo.id]),
  };
}

export function photosFromBatchEntries(entries: HydratedMobileScannerPhotoResult[]) {
  return entries.map(photoFromResult);
}

export function photoIdsFromBatchEntries(entries: HydratedMobileScannerPhotoResult[]) {
  return entries.map((entry) => entry.id);
}

export async function resolveTimelineMessage(
  message: MobileScannerResultBroadcastMessage,
  {
    saveScan,
    savePhoto,
  }: {
    saveScan: (scan: BarcodeMessage & { id?: string }) => Promise<MobileScannerScanResult | null>;
    savePhoto: (photo: MobilePhoto) => Promise<HydratedMobileScannerPhotoResult | null>;
  },
): Promise<TimelineEntry | null> {
  if (message.action === "scannerScan") {
    if (message.result) return message.result;
    if (!message.scan) return null;
    return saveScan(message.scan as BarcodeMessage & { id?: string });
  }

  if (message.action === "scannerPhoto") {
    if (message.result) return message.result;
    if (!message.photo) return null;
    return savePhoto(message.photo);
  }

  return null;
}

export function buildTimelineGroups(results: TimelineEntry[]): TimelineGroup[] {
  const scans = results
    .filter((result): result is MobileScannerScanResult => result.type === "scan")
    .map((result): TimelineGroup => ({
      type: "scan",
      key: result.id,
      kind: result.kind,
      capturedAt: timestamp(result.capturedAt),
      entries: [result],
    }));
  const photoGroups = groupPhotoResultsByBatch(
    results.filter(
      (result): result is HydratedMobileScannerPhotoResult =>
        result.type === "photo",
    ),
  ).map((group): TimelineGroup => ({
    type: "photo",
    key: group.photoBatchId,
    capturedAt: group.endAt,
    startAt: group.startAt,
    endAt: group.endAt,
    entries: group.entries as HydratedMobileScannerPhotoResult[],
  }));

  return [...scans, ...photoGroups].sort((a, b) => b.capturedAt - a.capturedAt);
}
