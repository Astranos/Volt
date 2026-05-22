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
export const SCANNER_SCAN_COOLDOWN_MS = 500;
export const SCANNER_LOCAL_SESSION_ID = "local";

export type ScannerConnectionStatus =
  | "disconnected"
  | "creating"
  | "waiting"
  | "connected"
  | "error";

export interface BarcodeMessage {
  barcode: string;
  format?: string;
  kind?: "barcode" | "text";
  scannedAt?: string;
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

export function decodeBarcodeMessage(data: string): BarcodeMessage | null {
  try {
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed.barcode !== "string" || !parsed.barcode) {
      return null;
    }

    return {
      barcode: parsed.barcode,
      format: typeof parsed.format === "string" ? parsed.format : undefined,
      kind: parsed.kind === "text" ? "text" : "barcode",
      scannedAt: typeof parsed.scannedAt === "string" ? parsed.scannedAt : undefined,
    };
  } catch (_e) {
    return null;
  }
}
