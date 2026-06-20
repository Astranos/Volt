export const SCANNER_WEB_APP_URL = "https://volt-scanner.vercel.app";
export const SCANNER_SIGNAL_URL_DEV = "https://adorable-hornet-19.convex.site/api/signal";
export const SCANNER_SIGNAL_URL_PROD = "https://sincere-trout-414.convex.site/api/signal";
export const SCANNER_SIGNAL_URL = SCANNER_SIGNAL_URL_PROD;
export const SCANNER_APP_SCHEME = "volt";
export const SCANNER_APP_PAIR_URL = `${SCANNER_APP_SCHEME}://pair`;
export const SCANNER_PROTOCOL_VERSION = "1.0.0";
export const SCANNER_PROTOCOL_MAJOR_VERSION = 1;
export const SCANNER_PROTOCOL_MINOR_VERSION = 0;
export const SCANNER_MIN_SUPPORTED_PROTOCOL_MAJOR_VERSION = 1;
export const SCANNER_MAX_SUPPORTED_PROTOCOL_MAJOR_VERSION = 1;
export const SCANNER_CONTROL_CHANNEL_LABEL = "scanner-control";
export const PHOTO_TRANSFER_CHANNEL_LABEL = "photo-transfer";

export type ScannerIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export const SCANNER_ICE_SERVERS: ScannerIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];
export const SCANNER_STUN_ONLY_ICE_SERVERS = SCANNER_ICE_SERVERS;
export const SCANNER_STUN_ONLY_RTC_CONFIGURATION = {
  iceServers: SCANNER_STUN_ONLY_ICE_SERVERS,
  iceTransportPolicy: "all" as const,
};

export const SCANNER_ICE_GATHERING_TIMEOUT_MS = 2000;
export const SCANNER_ANSWER_POLL_INTERVAL_MS = 1000;
export const SCANNER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SCANNER_JOIN_ATTEMPT_TTL_MS = 32 * 1000;
export const SCANNER_JOIN_TOKEN_TTL_MS = 2 * 60 * 1000;
export const SCANNER_JOIN_TOKEN_GRACE_MS = 10 * 1000;
export const SCANNER_PAIRING_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const SCANNER_RECONNECT_REQUEST_TTL_MS = 95 * 1000;
export const PHOTO_BATCH_WINDOW_MS = 5 * 60 * 1000;
export const PHOTO_TRANSFER_CHUNK_SIZE_BYTES = 64 * 1024;
export const PHOTO_TRANSFER_MAX_IN_FLIGHT_CHUNKS = 8;
export const PHOTO_TRANSFER_BUFFERED_AMOUNT_LOW_THRESHOLD = 512 * 1024;
export const PHOTO_TRANSFER_MAX_BUFFERED_AMOUNT = 2 * 1024 * 1024;
export const SCANNER_SCAN_COOLDOWN_MS = 500;
export const SCANNER_LOCAL_SESSION_ID = "local";

export type CaptureMode = "ocr" | "barcode" | "dictation" | "photo";

export const CAPTURE_MODES: CaptureMode[] = ["ocr", "barcode", "dictation", "photo"];

export type ScannerConnectionStatus =
  | "disconnected"
  | "creating"
  | "waiting"
  | "connected"
  | "error";

export function isCaptureMode(value: unknown): value is CaptureMode {
  return value === "ocr" || value === "barcode" || value === "dictation" || value === "photo";
}
