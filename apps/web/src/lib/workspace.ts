import type { FunctionReturnType } from "convex/server";

import type { api } from "../../../../convex/_generated/api";

export type WorkspaceSnapshot = NonNullable<
  FunctionReturnType<typeof api.cloudWorkspace.workspaceSnapshot>
>;
export type CaptureBatch = WorkspaceSnapshot["batches"][number];
export type CaptureResult = CaptureBatch["results"][number];
export type CaptureType = CaptureResult["type"];

/** A result plus the batch it arrived in, which the UI needs for photo URLs. */
export type TimelineResult = CaptureResult & {
  batchId: string;
  batchCreatedAt: string;
  batchDeliveryState: CaptureBatch["deliveryState"];
};

/**
 * The server refuses to presign a photo until its batch finishes uploading, so
 * tiles have to wait rather than render a broken image.
 */
export function isPhotoPending(result: TimelineResult): boolean {
  return result.type === "photo" && result.batchDeliveryState === "uploading";
}

export const captureTypeLabels: Record<CaptureType, string> = {
  text: "Text",
  barcode: "Barcode",
  photo: "Photo",
  dictation: "Dictation",
};

export function batchResults(batch: CaptureBatch): TimelineResult[] {
  return batch.results.map((result) => ({
    ...result,
    batchId: batch.id,
    batchCreatedAt: batch.createdAt,
    batchDeliveryState: batch.deliveryState,
  }));
}

/** Newest capture first, across every batch. */
export function flattenResults(
  snapshot: WorkspaceSnapshot | null | undefined,
): TimelineResult[] {
  if (!snapshot) return [];
  return snapshot.batches
    .flatMap(batchResults)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export type CaptureFilter = "all" | CaptureType | "trash";

export function matchesFilter(
  result: TimelineResult,
  filter: CaptureFilter,
): boolean {
  if (filter === "trash") return result.deliveryState === "deleted";
  if (result.deliveryState === "deleted") return false;
  if (filter === "all") return true;
  return result.type === filter;
}

/**
 * Search runs over recognized text only. Photos carry no text, so they match
 * on their barcode-or-OCR siblings instead — handled by the caller, which
 * searches within a batch before deciding to hide it.
 */
export function matchesQuery(result: TimelineResult, query: string): boolean {
  if (!query) return true;
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [result.value, result.format].some(
    (field) => typeof field === "string" && field.toLowerCase().includes(needle),
  );
}

/** "Today", "Yesterday", or a written-out date for older captures. */
export function dayLabel(date: Date): string {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  });
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatRelativeTime(iso: string, now = Date.now()): string {
  const elapsed = now - Date.parse(iso);
  if (!Number.isFinite(elapsed)) return "";
  const seconds = Math.max(0, Math.round(elapsed / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export type WorkspaceUsage = {
  results: number;
  bytes: number;
  photos: number;
  batches: number;
};

export function workspaceUsage(
  snapshot: WorkspaceSnapshot | null | undefined,
): WorkspaceUsage {
  const live = flattenResults(snapshot).filter(
    (result) => result.deliveryState !== "deleted",
  );
  return {
    results: live.length,
    bytes: live.reduce((total, result) => total + result.byteCount, 0),
    photos: live.filter((result) => result.type === "photo").length,
    batches: snapshot?.batches.length ?? 0,
  };
}
