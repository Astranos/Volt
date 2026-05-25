import type { BarcodeMessage } from "@volt/scanner-protocol";

export type ScannerCaptureMode = "ocr" | "barcode" | "dictation";

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

export function makeBarcodeMessage(value: string, format: string, insertIntoCursor = true): ScanItem {
  return makeCaptureMessage(value, format, "barcode", insertIntoCursor);
}

export function makeOcrMessage(text: string, insertIntoCursor = true): ScanItem {
  return makeCaptureMessage(text, "live-text", "text", insertIntoCursor);
}

export function makeDictationMessage(text: string, dictationSessionId: string): ScanItem {
  return {
    ...makeCaptureMessage(text, "dictation", "text", true),
    dictationPhase: "final",
    dictationSessionId,
  };
}
