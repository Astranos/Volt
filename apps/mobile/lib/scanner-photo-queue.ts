import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { chunkPhotoBase64, type PendingPhoto } from "./photo-retry-queue";
import { cropActionForVisibleFrame, type PhotoCropFrame } from "./photo-crop";
import { createId } from "./scanner-ids";

export const OCR_CAPTURE_MAX_DIMENSION = 1800;
export const PHOTO_LONG_EDGE = 2200;
export const PHOTO_QUEUE_LOW_STORAGE_BYTES = 35 * 1024 * 1024;

type PhotoDimensions = {
  width?: number;
  height?: number;
};

export function getOcrResizeAction(photo: PhotoDimensions) {
  const { height, width } = photo;
  if (!width || !height) return null;
  const maxDimension = Math.max(width, height);
  if (maxDimension <= OCR_CAPTURE_MAX_DIMENSION) return null;
  const scale = OCR_CAPTURE_MAX_DIMENSION / maxDimension;
  return { resize: { height: Math.round(height * scale), width: Math.round(width * scale) } };
}

export function getPhotoResizeAction(photo: PhotoDimensions) {
  const { height, width } = photo;
  if (!width || !height) return null;
  const maxDimension = Math.max(width, height);
  if (maxDimension <= PHOTO_LONG_EDGE) return null;
  const scale = PHOTO_LONG_EDGE / maxDimension;
  return { resize: { height: Math.round(height * scale), width: Math.round(width * scale) } };
}

export function jpegUploadName(name: string | null | undefined, capturedAt: string, fallbackId: string) {
  const baseName = name?.trim()
    ? name.trim().replace(/\.[a-z0-9]+$/i, "")
    : `volt-upload-${capturedAt.replace(/[:.]/g, "-")}-${fallbackId.slice(-6)}`;
  return `${baseName}.jpg`;
}

export async function preparePendingPhoto({
  batchId,
  capturedAt,
  height,
  name,
  now,
  uri,
  width,
}: {
  batchId: string;
  capturedAt: string;
  height?: number;
  name: string;
  now: number;
  uri: string;
  width?: number;
}): Promise<PendingPhoto> {
  const resizeAction = getPhotoResizeAction({ width, height });
  const preparedPhoto = await manipulateAsync(
    uri,
    [resizeAction].filter(Boolean) as NonNullable<ReturnType<typeof getPhotoResizeAction>>[],
    { base64: true, compress: 0.76, format: SaveFormat.JPEG }
  );
  const photoBase64 = preparedPhoto.base64 ?? null;
  if (!photoBase64) throw new Error("Could not prepare photo data.");
  return createPendingPhoto({
    batchId,
    capturedAt,
    dataBase64: photoBase64,
    height: preparedPhoto.height,
    name,
    now,
    width: preparedPhoto.width,
  });
}

export async function prepareCapturedPendingPhoto({
  batchId,
  cropFrame,
  capturedPhoto,
  now,
}: {
  batchId: string;
  cropFrame?: PhotoCropFrame | null;
  capturedPhoto: { uri?: string; width?: number; height?: number };
  now: number;
}): Promise<PendingPhoto> {
  if (!capturedPhoto.uri || !capturedPhoto.width || !capturedPhoto.height) throw new Error("Camera did not return photo data.");
  const normalizedPhoto = await manipulateAsync(capturedPhoto.uri, [], { compress: 0.92, format: SaveFormat.JPEG });
  const cropAction = cropActionForVisibleFrame({ width: normalizedPhoto.width, height: normalizedPhoto.height }, cropFrame);
  const resizeAction = getPhotoResizeAction(normalizedPhoto);
  const preparedPhoto = await manipulateAsync(
    normalizedPhoto.uri,
    [cropAction, resizeAction].filter(Boolean) as NonNullable<ReturnType<typeof getPhotoResizeAction>>[],
    { base64: true, compress: 0.76, format: SaveFormat.JPEG }
  );
  const photoBase64 = preparedPhoto.base64 ?? null;
  if (!photoBase64) throw new Error("Could not prepare photo data.");
  const capturedAt = new Date(now).toISOString();
  return createPendingPhoto({
    batchId,
    capturedAt,
    dataBase64: photoBase64,
    height: preparedPhoto.height,
    name: `volt-photo-${capturedAt.replace(/[:.]/g, "-")}.jpg`,
    now,
    width: preparedPhoto.width,
  });
}

function createPendingPhoto({
  batchId,
  capturedAt,
  dataBase64,
  height,
  name,
  now,
  width,
}: {
  batchId: string;
  capturedAt: string;
  dataBase64: string;
  height?: number;
  name: string;
  now: number;
  width?: number;
}): PendingPhoto {
  const id = createId("photo");
  const size = Math.ceil((dataBase64.length * 3) / 4);
  const chunks = chunkPhotoBase64(dataBase64);
  return {
    id,
    batchId,
    name,
    mimeType: "image/jpeg",
    dataBase64,
    capturedAt,
    size,
    width,
    height,
    createdAt: now,
    updatedAt: now,
    totalChunks: chunks.length,
    nextChunkIndex: 0,
    status: "queued",
    progress: 0,
  };
}
