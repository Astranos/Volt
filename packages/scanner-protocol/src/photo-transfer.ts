import { isScannerContributorId } from "./ids.ts";
import { isIsoDateString, isNonEmptyString, isNonNegativeInteger, isPositiveInteger, isRecord, optionalString } from "./validation.ts";

export type PhotoTransferStartMessage = {
  type: "photo_start";
  messageId: string;
  sentAt: string;
  photoId: string;
  photoBatchId: string;
  contributorId: string;
  filename: string;
  mimeType: "image/jpeg";
  size: number;
  width: number;
  height: number;
  capturedAt: string;
  chunkSize: number;
  totalChunks: number;
  orientation?: number;
};

export type PhotoTransferChunkMessage = {
  type: "photo_chunk";
  messageId: string;
  sentAt: string;
  photoId: string;
  chunkIndex: number;
  totalChunks: number;
  data: string;
};

export type PhotoTransferBinaryChunkMessage = Omit<PhotoTransferChunkMessage, "data"> & {
  data: Uint8Array;
};

export type PhotoTransferCompleteMessage = {
  type: "photo_complete";
  messageId: string;
  sentAt: string;
  photoId: string;
  totalChunks: number;
  sha256?: string;
};

export type PhotoTransferCancelMessage = {
  type: "photo_cancel";
  messageId: string;
  sentAt: string;
  photoId: string;
  reason?: "user_cancelled" | "replaced" | "failed";
};

export type PhotoTransferMessage =
  | PhotoTransferStartMessage
  | PhotoTransferChunkMessage
  | PhotoTransferCompleteMessage
  | PhotoTransferCancelMessage;

export const PHOTO_TRANSFER_MESSAGE_TYPES = [
  "photo_start",
  "photo_chunk",
  "photo_complete",
  "photo_cancel",
] as const satisfies readonly PhotoTransferMessage["type"][];

const PHOTO_TRANSFER_MESSAGE_TYPE_SET = new Set<string>(PHOTO_TRANSFER_MESSAGE_TYPES);

function hasMessageBase(
  value: Record<string, unknown>
): value is Record<string, unknown> & { messageId: string; sentAt: string } {
  return isNonEmptyString(value.messageId) && isIsoDateString(value.sentAt);
}

export function decodePhotoTransferMessage(data: string): PhotoTransferMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (_error) {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string" || !PHOTO_TRANSFER_MESSAGE_TYPE_SET.has(parsed.type)) {
    return null;
  }
  if (!hasMessageBase(parsed)) return null;

  const base = {
    messageId: parsed.messageId,
    sentAt: parsed.sentAt,
  };

  if (parsed.type === "photo_start") {
    if (
      !isNonEmptyString(parsed.photoId) ||
      !isNonEmptyString(parsed.photoBatchId) ||
      !isScannerContributorId(parsed.contributorId) ||
      !isNonEmptyString(parsed.filename) ||
      parsed.mimeType !== "image/jpeg" ||
      !isPositiveInteger(parsed.size) ||
      !isPositiveInteger(parsed.width) ||
      !isPositiveInteger(parsed.height) ||
      !isIsoDateString(parsed.capturedAt) ||
      !isPositiveInteger(parsed.chunkSize) ||
      !isPositiveInteger(parsed.totalChunks)
    ) {
      return null;
    }
    return {
      type: "photo_start",
      ...base,
      photoId: parsed.photoId,
      photoBatchId: parsed.photoBatchId,
      contributorId: parsed.contributorId,
      filename: parsed.filename,
      mimeType: "image/jpeg",
      size: parsed.size,
      width: parsed.width,
      height: parsed.height,
      capturedAt: parsed.capturedAt,
      chunkSize: parsed.chunkSize,
      totalChunks: parsed.totalChunks,
      orientation:
        typeof parsed.orientation === "number" && Number.isInteger(parsed.orientation)
          ? parsed.orientation
          : undefined,
    };
  }

  if (parsed.type === "photo_chunk") {
    if (
      !isNonEmptyString(parsed.photoId) ||
      !isNonNegativeInteger(parsed.chunkIndex) ||
      !isPositiveInteger(parsed.totalChunks) ||
      parsed.chunkIndex >= parsed.totalChunks ||
      !isNonEmptyString(parsed.data)
    ) {
      return null;
    }
    return {
      type: "photo_chunk",
      ...base,
      photoId: parsed.photoId,
      chunkIndex: parsed.chunkIndex,
      totalChunks: parsed.totalChunks,
      data: parsed.data,
    };
  }

  if (parsed.type === "photo_complete") {
    if (!isNonEmptyString(parsed.photoId) || !isPositiveInteger(parsed.totalChunks)) return null;
    return {
      type: "photo_complete",
      ...base,
      photoId: parsed.photoId,
      totalChunks: parsed.totalChunks,
      sha256: optionalString(parsed.sha256),
    };
  }

  if (parsed.type === "photo_cancel") {
    const reason = parsed.reason;
    if (
      !isNonEmptyString(parsed.photoId) ||
      (reason !== undefined && reason !== "user_cancelled" && reason !== "replaced" && reason !== "failed")
    ) {
      return null;
    }
    return {
      type: "photo_cancel",
      ...base,
      photoId: parsed.photoId,
      reason: reason as PhotoTransferCancelMessage["reason"],
    };
  }

  return null;
}

export function encodePhotoTransferMessage(message: PhotoTransferMessage): string {
  const decoded = decodePhotoTransferMessage(JSON.stringify(message));
  if (!decoded) throw new Error("Invalid photo-transfer message");
  return JSON.stringify(message);
}

export function encodePhotoTransferChunkFrame(
  message: Omit<PhotoTransferChunkMessage, "data">,
  data: Uint8Array
): Uint8Array {
  const validated = decodePhotoTransferMessage(JSON.stringify({ ...message, data: "binary" }));
  if (!validated || validated.type !== "photo_chunk") {
    throw new Error("Invalid photo-transfer chunk frame");
  }

  const header = new TextEncoder().encode(JSON.stringify(message));
  const frame = new Uint8Array(4 + header.byteLength + data.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, header.byteLength, false);
  frame.set(header, 4);
  frame.set(data, 4 + header.byteLength);
  return frame;
}

export function decodePhotoTransferChunkFrame(
  frame: ArrayBuffer | Uint8Array
): PhotoTransferBinaryChunkMessage | null {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  if (bytes.byteLength < 5) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0, false);
  const payloadOffset = 4 + headerLength;
  if (headerLength <= 0 || payloadOffset > bytes.byteLength) return null;

  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.slice(4, payloadOffset)));
  } catch (_error) {
    return null;
  }

  if (!isRecord(header)) return null;
  const validated = decodePhotoTransferMessage(JSON.stringify({ ...header, data: "binary" }));
  if (!validated || validated.type !== "photo_chunk") return null;

  return {
    type: "photo_chunk",
    messageId: validated.messageId,
    sentAt: validated.sentAt,
    photoId: validated.photoId,
    chunkIndex: validated.chunkIndex,
    totalChunks: validated.totalChunks,
    data: bytes.slice(payloadOffset),
  };
}

export function photoTransferDuplicateKey(message: PhotoTransferMessage) {
  if (message.type === "photo_chunk") {
    return `${message.type}:${message.photoId}:${message.chunkIndex}:${message.totalChunks}`;
  }
  return `${message.type}:${message.photoId}`;
}
