import { PHOTO_TRANSFER_CHUNK_SIZE_BYTES } from "@volt/scanner-protocol";

const PHOTO_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type PhotoReceiptStatus = "queued" | "sending" | "sent" | "received" | "failed" | "cancelled";

export type PendingPhotoSummary = {
  id: string;
  name: string;
  capturedAt: string;
  size: number;
  status: PhotoReceiptStatus;
  progress: number;
  error?: string;
};

export type PendingPhoto = PendingPhotoSummary & {
  batchId: string;
  mimeType: "image/jpeg";
  dataBase64: string;
  width?: number;
  height?: number;
  createdAt: number;
  updatedAt: number;
  totalChunks: number;
  nextChunkIndex: number;
};

export function chunkPhotoBase64(data: string, chunkSize = PHOTO_TRANSFER_CHUNK_SIZE_BYTES) {
  const chunks: string[] = [];
  for (let index = 0; index < data.length; index += chunkSize) {
    chunks.push(data.slice(index, index + chunkSize));
  }
  return chunks;
}

export function isExpiredPendingPhoto(photo: PendingPhoto, now = Date.now()) {
  return now - photo.createdAt > PHOTO_RECOVERY_WINDOW_MS;
}

export function compactPendingPhotos(photos: PendingPhoto[], now = Date.now()) {
  return photos.filter((photo) => !isExpiredPendingPhoto(photo, now) && photo.status !== "received" && photo.status !== "cancelled");
}

export function pendingPhotoSummaries(photos: PendingPhoto[]): PendingPhotoSummary[] {
  return photos
    .filter((photo) => photo.status !== "received" && photo.status !== "cancelled")
    .sort((first, second) => second.createdAt - first.createdAt)
    .map(({ id, name, capturedAt, size, status, progress, error }) => ({ id, name, capturedAt, size, status, progress, error }));
}

export function markRetryableAfterDisconnect(photo: PendingPhoto, message = "Disconnected before Chrome receipt."): PendingPhoto {
  if (photo.status !== "sending" && photo.status !== "sent") return photo;
  return {
    ...photo,
    status: "failed",
    error: message,
    updatedAt: Date.now(),
  };
}
