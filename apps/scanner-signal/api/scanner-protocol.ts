export const SCANNER_SESSION_TTL_MS = 30 * 60 * 1000;
export const PHOTO_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SCANNER_MAX_SESSION_RESULTS = 30;
export const SCANNER_MAX_STORED_PHOTO_DATA_URL_BYTES = 2_500_000;
export const SCANNER_SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{4,80}$/;

export type CaptureMode = "ocr" | "barcode" | "dictation" | "photo";
export type AppClipCaptureMode = "ocr" | "barcode" | "photo";

export type SessionTarget = {
  browser?: string;
  tabTitle?: string;
  url?: string;
  cursor?: string;
};

export type BarcodeMessage = {
  barcode: string;
  dictationPhase?: "partial" | "final";
  dictationSessionId?: string;
  format?: string;
  insertIntoCursor?: boolean;
  kind?: "barcode" | "text";
  scannedAt?: string;
};

export type PhotoMessage = {
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
};

export type ScannerRelayResult = {
  id: string;
  mode: CaptureMode;
  message: BarcodeMessage | PhotoMessage;
  createdAt: string;
  sequence?: number;
  finalized?: boolean;
};

export function isCaptureMode(value: unknown): value is CaptureMode {
  return value === "ocr" || value === "barcode" || value === "dictation" || value === "photo";
}

export function isAppClipCaptureMode(value: unknown): value is AppClipCaptureMode {
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

export function isValidResultForMode(mode: CaptureMode, message: BarcodeMessage | PhotoMessage) {
  if (mode === "photo") return message.kind === "photo";
  if (message.kind === "photo") return false;
  if (mode === "ocr") return message.kind === "text" && message.format === "live-text";
  if (mode === "barcode") return message.kind === "barcode";
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
    dictationSessionId: typeof message.dictationSessionId === "string" ? message.dictationSessionId : undefined,
    format: typeof message.format === "string" ? message.format : undefined,
    insertIntoCursor: typeof message.insertIntoCursor === "boolean" ? message.insertIntoCursor : undefined,
    kind: message.kind === "text" ? "text" : "barcode",
    scannedAt: typeof message.scannedAt === "string" ? message.scannedAt : undefined,
  };
}

export function parseScannerRelayResult(body: unknown, createdAt = new Date().toISOString()): ScannerRelayResult | null {
  if (!body || typeof body !== "object") return null;
  const value = body as { id?: unknown; mode?: unknown; message?: unknown };
  const message = parseRelayMessage(value.message);
  if (typeof value.id !== "string" || !value.id || !isCaptureMode(value.mode) || !message) return null;
  const result = { id: value.id, mode: value.mode, message, createdAt };
  return isValidResultForMode(result.mode, result.message) ? result : null;
}

export function trimScannerRelayResults(results: ScannerRelayResult[]) {
  const trimmed: ScannerRelayResult[] = [];
  let photoDataUrlBytes = 0;

  for (const result of [...results].reverse()) {
    if (trimmed.length >= SCANNER_MAX_SESSION_RESULTS) break;
    if (result.message.kind === "photo") {
      const dataUrlBytes = result.message.dataUrl?.length ?? 0;
      if (trimmed.length > 0 && dataUrlBytes > 0 && photoDataUrlBytes + dataUrlBytes > SCANNER_MAX_STORED_PHOTO_DATA_URL_BYTES) {
        continue;
      }
      photoDataUrlBytes += dataUrlBytes;
    }
    trimmed.push(result);
  }

  return trimmed.reverse();
}
