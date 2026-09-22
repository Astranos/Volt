import { SCANNER_ICE_GATHERING_TIMEOUT_MS, SCANNER_PROTOCOL_MAJOR_VERSION, SCANNER_PROTOCOL_MINOR_VERSION, SCANNER_SIGNAL_URL, normalizeScannerIceServers, type PhotoTransferStartMessage, type ScannerIceServer } from "@volt/scanner-protocol";

export const SIGNAL_URL = scannerSignalUrl();
export const DEFAULT_SESSION_LABEL = "Browser session";
export const REVIEW_INPUT_LABEL = "Review test input";
export const WEB_PROTOCOL_VERSION = {
  major: SCANNER_PROTOCOL_MAJOR_VERSION,
  minor: SCANNER_PROTOCOL_MINOR_VERSION,
};
export const REMOTE_SPEECH_START_RETRY_DELAY_MS = 250;
export const REMOTE_SPEECH_START_MAX_ATTEMPTS = 20;

export type DemoStatus =
  | "idle"
  | "creating"
  | "waiting"
  | "connecting"
  | "connected"
  | "error";

export type JoinWindow = {
  browserClaim: string;
  expiresAt: string | null;
  joinToken: string;
  label: string;
  qrCodeUrl: string;
  sessionId: string;
};

export type JoinAttempt = {
  answer: RTCSessionDescriptionInit | null;
  hasAnswer: boolean;
  id: string;
};

export type PeerSession = {
  answerApplied: boolean;
  control: RTCDataChannel | null;
  id: string;
  pc: RTCPeerConnection;
  photoTransfer: RTCDataChannel | null;
  ready: boolean;
};

export type CaptureItem = {
  capturedAt: string;
  format?: string;
  id: string;
  kind: "barcode" | "text" | "dictation";
  value: string;
};

export type PhotoItem = {
  capturedAt: string;
  filename: string;
  height?: number;
  id: string;
  mimeType: string;
  objectUrl: string;
  photoBatchId: string;
  size: number;
  width?: number;
};

export const MAX_CAPTURE_ITEMS = 50;
export const MAX_PHOTO_ITEMS = 24;

export type PendingPhoto = PhotoTransferStartMessage & {
  chunks: Uint8Array[];
  receivedChunks: number;
  updatedAt: number;
};

function scannerSignalUrl() {
  const env = (
    import.meta as ImportMeta & { env?: Record<string, string | undefined> }
  ).env;
  return env?.VITE_SCANNER_SIGNAL_URL || SCANNER_SIGNAL_URL;
}

export function createId(prefix: string) {
  const random = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${random}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
}

export function createSecret(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createMessageId(prefix = "control") {
  return createId(prefix);
}

export function normalizedSessionLabel(value: string) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed || DEFAULT_SESSION_LABEL;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

export function normalizeSessionDescription(
  value: unknown,
): RTCSessionDescriptionInit | null {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!parsed || typeof parsed !== "object") return null;
  const description = parsed as { sdp?: unknown; type?: unknown };
  if (
    (description.type !== "answer" &&
      description.type !== "pranswer" &&
      description.type !== "offer" &&
      description.type !== "rollback") ||
    typeof description.sdp !== "string"
  ) {
    return null;
  }
  return { type: description.type, sdp: description.sdp };
}

export function normalizeJoinAttempt(value: unknown): JoinAttempt | null {
  if (!value || typeof value !== "object") return null;
  const attempt = value as {
    answer?: unknown;
    hasAnswer?: unknown;
    id?: unknown;
    joinAttemptId?: unknown;
  };
  const id =
    typeof attempt.joinAttemptId === "string" && attempt.joinAttemptId
      ? attempt.joinAttemptId
      : typeof attempt.id === "string" && attempt.id
        ? attempt.id
        : null;
  if (!id) return null;
  const answer = normalizeSessionDescription(attempt.answer);
  return { id, answer, hasAnswer: Boolean(answer || attempt.hasAnswer) };
}

export function normalizeIceResponse(value: unknown): ScannerIceServer[] | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as { iceServers?: unknown };
  const servers = normalizeScannerIceServers(payload.iceServers);
  return servers && servers.length > 0 ? servers : null;
}

export function waitForIceGathering(pc: RTCPeerConnection) {
  return new Promise<void>((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => {
      pc.onicegatheringstatechange = null;
      resolve();
    }, SCANNER_ICE_GATHERING_TIMEOUT_MS);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState !== "complete") return;
      window.clearTimeout(timer);
      pc.onicegatheringstatechange = null;
      resolve();
    };
  });
}

export function bytesFromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function statusLabel(status: DemoStatus) {
  if (status === "creating") return "Creating pairing";
  if (status === "waiting") return "Waiting for iPhone";
  if (status === "connecting") return "Connecting WebRTC";
  if (status === "connected") return "Connected";
  if (status === "error") return "Needs attention";
  return "Ready";
}

export function reviewCursorTarget() {
  return {
    hasCursorTarget: true,
    label: REVIEW_INPUT_LABEL,
    tabTitle: "Volt Scanner",
    url: window.location.href,
  };
}
