export const SCANNER_WEB_APP_URL = "https://volt-scanner.vercel.app";
export const SCANNER_SIGNAL_URL = "https://scanner-signal.vercel.app/api/signal";
export const SCANNER_APP_SCHEME = "volt";
export const SCANNER_APP_PAIR_URL = `${SCANNER_APP_SCHEME}://pair`;

export type ScannerIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type ScannerSessionDescription = {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp: string;
};

export const SCANNER_ICE_SERVERS: ScannerIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export const SCANNER_DATA_CHANNEL = "barcodes";
export const SCANNER_ICE_GATHERING_TIMEOUT_MS = 5000;
export const SCANNER_ANSWER_POLL_INTERVAL_MS = 1000;
export const SCANNER_SESSION_TTL_MS = 30 * 60 * 1000;
export const PHOTO_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SCANNER_SCAN_COOLDOWN_MS = 500;
export const SCANNER_LOCAL_SESSION_ID = "local";
export const SCANNER_RESULT_POLL_INTERVAL_MS = 500;
export const SCANNER_SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{4,80}$/;
export const SCANNER_MAX_SESSION_RESULTS = 30;
export const SCANNER_MAX_STORED_PHOTO_DATA_URL_BYTES = 2_500_000;

export type CaptureMode = "ocr" | "barcode" | "dictation" | "photo";

export const CAPTURE_MODES: CaptureMode[] = ["ocr", "barcode", "dictation", "photo"];
export const APP_CLIP_CAPTURE_MODES: CaptureMode[] = ["ocr", "barcode", "photo"];

export type ScannerConnectionStatus =
  | "disconnected"
  | "creating"
  | "waiting"
  | "connected"
  | "error";

export interface BarcodeMessage {
  barcode: string;
  dictationPhase?: "partial" | "final";
  dictationSessionId?: string;
  format?: string;
  insertIntoCursor?: boolean;
  kind?: "barcode" | "text";
  scannedAt?: string;
}

export interface PhotoMessage {
  kind: "photo";
  id: string;
  name: string;
  mimeType: string;
  dataUrl?: string;
  downloadUrl?: string;
  objectKey?: string;
  grantId?: string;
  contributorId?: string;
  size: number;
  width?: number;
  height?: number;
  capturedAt?: string;
  status?: "uploaded" | "available_to_browser" | "browser_received" | "download_failed";
  browserReceivedAt?: string;
  downloadFailedAt?: string;
  downloadError?: string;
}

export interface PhotoChunkStartMessage {
  kind: "photo-chunk-start";
  id: string;
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  capturedAt?: string;
  totalChunks: number;
}

export interface PhotoChunkMessage {
  kind: "photo-chunk";
  id: string;
  index: number;
  data: string;
}

export interface PhotoChunkEndMessage {
  kind: "photo-chunk-end";
  id: string;
}

export type ScannerTransportMessage =
  | BarcodeMessage
  | PhotoMessage
  | PhotoChunkStartMessage
  | PhotoChunkMessage
  | PhotoChunkEndMessage;

export type SessionTarget = {
  browser?: string;
  tabTitle?: string;
  url?: string;
  cursor?: string;
};

export type ScannerRelayResult = {
  id: string;
  mode: CaptureMode;
  message: BarcodeMessage | PhotoMessage;
  createdAt: string;
  sequence?: number;
  finalized?: boolean;
};

export type PhotoUploadGrantRequest = {
  contributorId: string;
  filename: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
};

export type PhotoUploadGrant = {
  id: string;
  uploadUrl: string;
  manifestUrl: string;
  expiresAt: string;
  objectKey: string;
  headers?: Record<string, string>;
};

export function isCaptureMode(value: unknown): value is CaptureMode {
  return value === "ocr" || value === "barcode" || value === "dictation" || value === "photo";
}

export function isAppClipCaptureMode(value: unknown): value is CaptureMode {
  return value === "ocr" || value === "barcode" || value === "photo";
}

export function isScannerSessionId(value: unknown): value is string {
  return typeof value === "string" && SCANNER_SESSION_ID_PATTERN.test(value);
}

function clampTargetString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

export function parseSessionTarget(value: unknown): SessionTarget | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const target = {
    browser: clampTargetString(source.browser, 80),
    tabTitle: clampTargetString(source.tabTitle, 160),
    url: clampTargetString(source.url, 600),
    cursor: clampTargetString(source.cursor, 120),
  };
  return Object.values(target).some(Boolean) ? target : undefined;
}

export function encodePairingPayload(description: ScannerSessionDescription): string {
  return btoa(JSON.stringify(description))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodePairingPayload(payload: string): ScannerSessionDescription {
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  return JSON.parse(atob(padded));
}

export function encodeBarcodeMessage(message: BarcodeMessage): string {
  return JSON.stringify(message);
}

export function encodeScannerTransportMessage(message: ScannerTransportMessage): string {
  return JSON.stringify(message);
}

export function decodeBarcodeMessage(data: string): BarcodeMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed.barcode !== "string" || !parsed.barcode) {
      return null;
    }

    return {
      barcode: parsed.barcode,
      dictationPhase: parsed.dictationPhase === "partial" || parsed.dictationPhase === "final" ? parsed.dictationPhase : undefined,
      dictationSessionId: typeof parsed.dictationSessionId === "string" ? parsed.dictationSessionId : undefined,
      format: typeof parsed.format === "string" ? parsed.format : undefined,
      insertIntoCursor: typeof parsed.insertIntoCursor === "boolean" ? parsed.insertIntoCursor : undefined,
      kind: parsed.kind === "text" ? "text" : "barcode",
      scannedAt: typeof parsed.scannedAt === "string" ? parsed.scannedAt : undefined,
    };
  } catch (_e) {
    return null;
  }
}

export function decodeScannerTransportMessage(data: string): ScannerTransportMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;

    if (parsed.kind === "photo") {
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.name !== "string" ||
        typeof parsed.mimeType !== "string" ||
        (typeof parsed.dataUrl !== "string" && typeof parsed.downloadUrl !== "string") ||
        typeof parsed.size !== "number"
      ) {
        return null;
      }

      return {
        kind: "photo",
        id: parsed.id,
        name: parsed.name,
        mimeType: parsed.mimeType,
        dataUrl: typeof parsed.dataUrl === "string" ? parsed.dataUrl : undefined,
        downloadUrl: typeof parsed.downloadUrl === "string" ? parsed.downloadUrl : undefined,
        objectKey: typeof parsed.objectKey === "string" ? parsed.objectKey : undefined,
        grantId: typeof parsed.grantId === "string" ? parsed.grantId : undefined,
        contributorId: typeof parsed.contributorId === "string" ? parsed.contributorId : undefined,
        size: parsed.size,
        width: typeof parsed.width === "number" ? parsed.width : undefined,
        height: typeof parsed.height === "number" ? parsed.height : undefined,
        capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : undefined,
        status:
          parsed.status === "uploaded" ||
          parsed.status === "available_to_browser" ||
          parsed.status === "browser_received" ||
          parsed.status === "download_failed"
            ? parsed.status
            : undefined,
        browserReceivedAt: typeof parsed.browserReceivedAt === "string" ? parsed.browserReceivedAt : undefined,
        downloadFailedAt: typeof parsed.downloadFailedAt === "string" ? parsed.downloadFailedAt : undefined,
        downloadError: typeof parsed.downloadError === "string" ? parsed.downloadError : undefined,
      };
    }

    if (parsed.kind === "photo-chunk-start") {
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.name !== "string" ||
        typeof parsed.mimeType !== "string" ||
        typeof parsed.size !== "number" ||
        typeof parsed.totalChunks !== "number"
      ) {
        return null;
      }

      return {
        kind: "photo-chunk-start",
        id: parsed.id,
        name: parsed.name,
        mimeType: parsed.mimeType,
        size: parsed.size,
        width: typeof parsed.width === "number" ? parsed.width : undefined,
        height: typeof parsed.height === "number" ? parsed.height : undefined,
        capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : undefined,
        totalChunks: parsed.totalChunks,
      };
    }

    if (parsed.kind === "photo-chunk") {
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.index !== "number" ||
        typeof parsed.data !== "string"
      ) {
        return null;
      }

      return {
        kind: "photo-chunk",
        id: parsed.id,
        index: parsed.index,
        data: parsed.data,
      };
    }

    if (parsed.kind === "photo-chunk-end") {
      return typeof parsed.id === "string" ? { kind: "photo-chunk-end", id: parsed.id } : null;
    }

    return decodeBarcodeMessage(data);
  } catch (_e) {
    return null;
  }
}

export function isValidResultForMode(mode: CaptureMode, message: BarcodeMessage | PhotoMessage) {
  if (mode === "photo") {
    return message.kind === "photo";
  }
  if (message.kind === "photo") return false;

  if (mode === "ocr") {
    return message.kind === "text" && message.format === "live-text";
  }

  if (mode === "barcode") {
    return message.kind === "barcode";
  }

  return (
    message.kind === "text" &&
    message.format === "dictation" &&
    (message.dictationPhase === "partial" || message.dictationPhase === "final") &&
    typeof message.dictationSessionId === "string" &&
    message.dictationSessionId.length > 0
  );
}

function parseRelayMessage(value: unknown): BarcodeMessage | PhotoMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Record<string, unknown>;

  if (message.kind === "photo") {
    if (
      typeof message.id !== "string" ||
      typeof message.name !== "string" ||
      typeof message.mimeType !== "string" ||
      (typeof message.dataUrl !== "string" && typeof message.downloadUrl !== "string") ||
      (typeof message.dataUrl === "string" && !message.dataUrl.startsWith("data:image/")) ||
      typeof message.size !== "number"
    ) {
      return null;
    }

    return {
      kind: "photo",
      id: message.id,
      name: message.name,
      mimeType: message.mimeType,
      dataUrl: typeof message.dataUrl === "string" ? message.dataUrl : undefined,
      downloadUrl: typeof message.downloadUrl === "string" ? message.downloadUrl : undefined,
      objectKey: typeof message.objectKey === "string" ? message.objectKey : undefined,
      grantId: typeof message.grantId === "string" ? message.grantId : undefined,
      contributorId: typeof message.contributorId === "string" ? message.contributorId : undefined,
      size: message.size,
      width: typeof message.width === "number" ? message.width : undefined,
      height: typeof message.height === "number" ? message.height : undefined,
      capturedAt: typeof message.capturedAt === "string" ? message.capturedAt : undefined,
      status:
        message.status === "uploaded" ||
        message.status === "available_to_browser" ||
        message.status === "browser_received" ||
        message.status === "download_failed"
          ? message.status
          : undefined,
      browserReceivedAt: typeof message.browserReceivedAt === "string" ? message.browserReceivedAt : undefined,
      downloadFailedAt: typeof message.downloadFailedAt === "string" ? message.downloadFailedAt : undefined,
      downloadError: typeof message.downloadError === "string" ? message.downloadError : undefined,
    };
  }

  if (typeof message.barcode !== "string" || !message.barcode) return null;

  return {
    barcode: message.barcode,
    dictationPhase:
      message.dictationPhase === "partial" || message.dictationPhase === "final"
        ? message.dictationPhase
        : undefined,
    dictationSessionId:
      typeof message.dictationSessionId === "string"
        ? message.dictationSessionId
        : undefined,
    format: typeof message.format === "string" ? message.format : undefined,
    insertIntoCursor:
      typeof message.insertIntoCursor === "boolean"
        ? message.insertIntoCursor
        : undefined,
    kind: message.kind === "text" ? "text" : "barcode",
    scannedAt: typeof message.scannedAt === "string" ? message.scannedAt : undefined,
  };
}

export function parseScannerRelayResult(
  body: unknown,
  createdAt = new Date().toISOString()
): ScannerRelayResult | null {
  if (!body || typeof body !== "object") return null;
  const value = body as {
    id?: unknown;
    mode?: unknown;
    message?: unknown;
  };
  const message = parseRelayMessage(value.message);
  if (typeof value.id !== "string" || !value.id || !isCaptureMode(value.mode) || !message) {
    return null;
  }

  const result = {
    id: value.id,
    mode: value.mode,
    message,
    createdAt,
  };

  return isValidResultForMode(result.mode, result.message) ? result : null;
}

export function trimScannerRelayResults(results: ScannerRelayResult[]) {
  const trimmed: ScannerRelayResult[] = [];
  let photoDataUrlBytes = 0;

  for (const result of [...results].reverse()) {
    if (trimmed.length >= SCANNER_MAX_SESSION_RESULTS) break;

    if (result.message.kind === "photo") {
      const dataUrlBytes = result.message.dataUrl?.length ?? 0;
      if (
        trimmed.length > 0 &&
        dataUrlBytes > 0 &&
        photoDataUrlBytes + dataUrlBytes > SCANNER_MAX_STORED_PHOTO_DATA_URL_BYTES
      ) {
        continue;
      }
      photoDataUrlBytes += dataUrlBytes;
    }

    trimmed.push(result);
  }

  return trimmed.reverse();
}

export function scannerMessageDuplicateKey(message: BarcodeMessage) {
  return [
    message.kind ?? "barcode",
    message.format ?? "",
    message.barcode.trim().toLowerCase(),
  ].join(":");
}

export function createScannerMessageDuplicateGuard(
  duplicateWindowMs = 1500,
  retentionMs = 2500,
  now = () => Date.now()
) {
  const recentMessages = new Map<string, number>();

  return (message: BarcodeMessage) => {
    const timestamp = now();
    const key = scannerMessageDuplicateKey(message);
    const lastSeenAt = recentMessages.get(key);

    for (const [recentKey, seenAt] of recentMessages) {
      if (timestamp - seenAt > retentionMs) {
        recentMessages.delete(recentKey);
      }
    }

    if (lastSeenAt !== undefined && timestamp - lastSeenAt < duplicateWindowMs) {
      return false;
    }

    recentMessages.set(key, timestamp);
    return true;
  };
}
