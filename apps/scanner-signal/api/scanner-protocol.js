export const SCANNER_SESSION_TTL_MS = 30 * 60 * 1000;
export const PHOTO_RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SCANNER_MAX_SESSION_RESULTS = 30;
export const SCANNER_MAX_STORED_PHOTO_DATA_URL_BYTES = 2_500_000;
export const SCANNER_SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{4,80}$/;

export function isCaptureMode(value) {
  return value === "ocr" || value === "barcode" || value === "dictation" || value === "photo";
}

export function isAppClipCaptureMode(value) {
  return value === "ocr" || value === "barcode" || value === "photo";
}

export function isScannerSessionId(value) {
  return typeof value === "string" && SCANNER_SESSION_ID_PATTERN.test(value);
}

function clampTargetString(value, maxLength) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

export function parseSessionTarget(value) {
  if (!value || typeof value !== "object") return undefined;
  const target = {
    browser: clampTargetString(value.browser, 80),
    tabTitle: clampTargetString(value.tabTitle, 160),
    url: clampTargetString(value.url, 600),
    cursor: clampTargetString(value.cursor, 120),
  };
  return Object.values(target).some(Boolean) ? target : undefined;
}

export function isValidResultForMode(mode, message) {
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

function parseRelayMessage(value) {
  if (!value || typeof value !== "object") return null;

  if (value.kind === "photo") {
    if (
      typeof value.id !== "string" ||
      typeof value.name !== "string" ||
      typeof value.mimeType !== "string" ||
      (typeof value.dataUrl !== "string" && typeof value.downloadUrl !== "string") ||
      (typeof value.dataUrl === "string" && !value.dataUrl.startsWith("data:image/")) ||
      typeof value.size !== "number"
    ) {
      return null;
    }

    return {
      kind: "photo",
      id: value.id,
      name: value.name,
      mimeType: value.mimeType,
      dataUrl: typeof value.dataUrl === "string" ? value.dataUrl : undefined,
      downloadUrl: typeof value.downloadUrl === "string" ? value.downloadUrl : undefined,
      objectKey: typeof value.objectKey === "string" ? value.objectKey : undefined,
      grantId: typeof value.grantId === "string" ? value.grantId : undefined,
      contributorId: typeof value.contributorId === "string" ? value.contributorId : undefined,
      size: value.size,
      width: typeof value.width === "number" ? value.width : undefined,
      height: typeof value.height === "number" ? value.height : undefined,
      capturedAt: typeof value.capturedAt === "string" ? value.capturedAt : undefined,
      status:
        value.status === "uploaded" ||
        value.status === "available_to_browser" ||
        value.status === "browser_received" ||
        value.status === "download_failed"
          ? value.status
          : undefined,
      browserReceivedAt: typeof value.browserReceivedAt === "string" ? value.browserReceivedAt : undefined,
      downloadFailedAt: typeof value.downloadFailedAt === "string" ? value.downloadFailedAt : undefined,
      downloadError: typeof value.downloadError === "string" ? value.downloadError : undefined,
    };
  }

  if (typeof value.barcode !== "string" || !value.barcode) return null;
  return {
    barcode: value.barcode,
    dictationPhase:
      value.dictationPhase === "partial" || value.dictationPhase === "final"
        ? value.dictationPhase
        : undefined,
    dictationSessionId: typeof value.dictationSessionId === "string" ? value.dictationSessionId : undefined,
    format: typeof value.format === "string" ? value.format : undefined,
    insertIntoCursor: typeof value.insertIntoCursor === "boolean" ? value.insertIntoCursor : undefined,
    kind: value.kind === "text" ? "text" : "barcode",
    scannedAt: typeof value.scannedAt === "string" ? value.scannedAt : undefined,
  };
}

export function parseScannerRelayResult(body, createdAt = new Date().toISOString()) {
  if (!body || typeof body !== "object") return null;
  const message = parseRelayMessage(body.message);
  if (typeof body.id !== "string" || !body.id || !isCaptureMode(body.mode) || !message) return null;
  const result = { id: body.id, mode: body.mode, message, createdAt };
  return isValidResultForMode(result.mode, result.message) ? result : null;
}

export function trimScannerRelayResults(results) {
  const trimmed = [];
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
