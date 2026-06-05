import type { BarcodeMessage } from "./mobile-scanner-session";

export function shouldInsertScannerMessage(message: BarcodeMessage) {
  if (typeof message.insertIntoCursor === "boolean") return message.insertIntoCursor;

  return message.kind === "text" && message.format === "dictation";
}
