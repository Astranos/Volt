export const SCANNER_WEB_APP_URL = "https://volt-scanner.vercel.app";

export const SCANNER_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

export const SCANNER_DATA_CHANNEL = "barcodes";
export const SCANNER_ICE_GATHERING_TIMEOUT_MS = 5000;
export const SCANNER_ANSWER_POLL_INTERVAL_MS = 1000;
export const SCANNER_SESSION_TTL_MS = 5 * 60 * 1000;
export const SCANNER_SCAN_COOLDOWN_MS = 500;

export type ScannerConnectionStatus =
  | "disconnected"
  | "creating"
  | "waiting"
  | "connected"
  | "error";

export interface BarcodeMessage {
  barcode: string;
  format?: string;
}

export function encodeBarcodeMessage(message: BarcodeMessage): string {
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
      format: typeof parsed.format === "string" ? parsed.format : undefined,
    };
  } catch (_e) {
    return null;
  }
}
