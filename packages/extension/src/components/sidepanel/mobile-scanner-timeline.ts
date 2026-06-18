import {
  groupPhotoResultsByBatch,
  type HydratedMobileScannerPhotoResult,
  type MobileScannerScanResult,
} from "../../domain/mobile-scanner-results";
import { type MobilePhoto } from "./mobile-photo-helpers";

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
