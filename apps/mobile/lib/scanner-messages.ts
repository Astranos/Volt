import type { BarcodeMessage, PhotoMessage } from "@volt/scanner-protocol";

export type ScannerCaptureMode = "ocr" | "barcode" | "dictation" | "photo";

export type ScanItem = BarcodeMessage & {
  id: string;
};

function makeScanId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function makeCaptureMessage(
  value: string,
  format: string,
  kind: BarcodeMessage["kind"],
  insertIntoCursor = true
): ScanItem {
  return {
    id: makeScanId(),
    barcode: value.trim(),
    format,
    insertIntoCursor,
    kind,
    scannedAt: new Date().toISOString(),
  };
}

export function normalizeBarcodeScan(value: string, format: string) {
  const trimmedValue = value.trim();
  const normalizedFormat = format.trim().toLowerCase();

  if (normalizedFormat === "ean13" && /^0\d{12}$/.test(trimmedValue)) {
    return {
      value: trimmedValue.slice(1),
      format: "upc_a",
    };
  }

  return {
    value: trimmedValue,
    format,
  };
}

export function makeBarcodeMessage(value: string, format: string, insertIntoCursor = true): ScanItem {
  const normalized = normalizeBarcodeScan(value, format);
  return makeCaptureMessage(normalized.value, normalized.format, "barcode", insertIntoCursor);
}

export function makeOcrMessage(text: string, insertIntoCursor = true): ScanItem {
  return makeCaptureMessage(text, "live-text", "text", insertIntoCursor);
}

export function makeDictationMessage(text: string, dictationSessionId: string, phase: "partial" | "final" = "final"): ScanItem {
  return {
    ...makeCaptureMessage(text, "dictation", "text", true),
    dictationPhase: phase,
    dictationSessionId,
  };
}

export function makePhotoMessage(photo: Omit<PhotoMessage, "kind">): PhotoMessage {
  return {
    ...photo,
    kind: "photo",
  };
}
