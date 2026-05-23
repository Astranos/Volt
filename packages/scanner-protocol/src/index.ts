export const SCANNER_WEB_APP_URL = "https://volt-scanner.vercel.app";
export const SCANNER_SIGNAL_URL = "https://scanner-signal.vercel.app/api/signal";
export const PRINT_RELAY_URL = "https://scanner-signal.vercel.app/api/print-relay";
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

export interface PhotoMessage {
  kind: "photo";
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
  width?: number;
  height?: number;
  capturedAt?: string;
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

export type PrintRelayPrinterType = "brother" | "zebra" | "other";

export type PrintRelayPayloadType = "text" | "zpl" | "pdf" | "png";

export type PrintRelayJobStatus =
  | "queued"
  | "claimed"
  | "printing"
  | "printed"
  | "failed";

export interface PrintRelayPrinter {
  id: string;
  name: string;
  type: PrintRelayPrinterType;
  localName?: string;
}

export interface PrintRelayStation {
  id: string;
  name: string;
  location?: string;
  online: boolean;
  relayEnabled: boolean;
  printers: PrintRelayPrinter[];
  lastSeenAt: string;
}

export interface PrintRelayJob {
  id: string;
  fromStationId: string;
  fromStationName: string;
  targetStationId: string;
  targetPrinterId: string;
  targetPrinterName: string;
  payloadType: PrintRelayPayloadType;
  payload: string;
  label: string;
  status: PrintRelayJobStatus;
  error?: string;
  createdAt: string;
  updatedAt: string;
  claimedAt?: string;
  completedAt?: string;
}

export type ScannerTransportMessage =
  | BarcodeMessage
  | PhotoMessage
  | PhotoChunkStartMessage
  | PhotoChunkMessage
  | PhotoChunkEndMessage;

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
      format: typeof parsed.format === "string" ? parsed.format : undefined,
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
        typeof parsed.dataUrl !== "string" ||
        typeof parsed.size !== "number"
      ) {
        return null;
      }

      return {
        kind: "photo",
        id: parsed.id,
        name: parsed.name,
        mimeType: parsed.mimeType,
        dataUrl: parsed.dataUrl,
        size: parsed.size,
        width: typeof parsed.width === "number" ? parsed.width : undefined,
        height: typeof parsed.height === "number" ? parsed.height : undefined,
        capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : undefined,
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
