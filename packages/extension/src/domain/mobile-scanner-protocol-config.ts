import {
  SCANNER_BROWSER_CAPABILITIES,
  SCANNER_PROTOCOL_MAJOR_VERSION,
  SCANNER_PROTOCOL_MINOR_VERSION,
  type ScannerCapability,
} from "@volt/scanner-protocol";

export const JOIN_WINDOW_TTL_MS = 2 * 60 * 1000;
export const EXTENSION_PROTOCOL_VERSION = {
  major: SCANNER_PROTOCOL_MAJOR_VERSION,
  minor: SCANNER_PROTOCOL_MINOR_VERSION,
};
export const EXTENSION_CAPABILITIES: ScannerCapability[] = [
  ...SCANNER_BROWSER_CAPABILITIES,
];
export const JOIN_CAPABILITIES = [
  "text",
  "barcode",
  "dictation",
  "photo",
  "photo-chunk-ack",
];
