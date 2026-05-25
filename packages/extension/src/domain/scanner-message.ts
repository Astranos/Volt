import type { BarcodeMessage } from "../../../scanner-protocol/src";

export function shouldInsertScannerMessage(message: BarcodeMessage) {
  if (typeof message.insertIntoCursor === "boolean") return message.insertIntoCursor;

  return message.kind === "text" && message.format === "dictation";
}
