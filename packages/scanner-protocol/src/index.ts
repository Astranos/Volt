export const SCANNER_WEB_APP_URL = "https://volt-scanner.vercel.app";
export const SCANNER_SIGNAL_URL = "https://scanner-signal.vercel.app/api/signal";
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

export type ScannerSessionDescription = {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp: string;
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

export const SCANNER_ICE_GATHERING_TIMEOUT_MS = 5000;
export const SCANNER_ANSWER_POLL_INTERVAL_MS = 1000;
export const SCANNER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SCANNER_JOIN_ATTEMPT_TTL_MS = 30 * 1000;
export const SCANNER_JOIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
export const SCANNER_JOIN_TOKEN_GRACE_MS = 10 * 1000;
export const PHOTO_BATCH_WINDOW_MS = 5 * 60 * 1000;
export const PHOTO_TRANSFER_CHUNK_SIZE_BYTES = 64 * 1024;
export const PHOTO_TRANSFER_MAX_IN_FLIGHT_CHUNKS = 8;
export const PHOTO_TRANSFER_BUFFERED_AMOUNT_LOW_THRESHOLD = 512 * 1024;
export const PHOTO_TRANSFER_MAX_BUFFERED_AMOUNT = 2 * 1024 * 1024;
export const SCANNER_SCAN_COOLDOWN_MS = 500;
export const SCANNER_LOCAL_SESSION_ID = "local";
export const SCANNER_SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{4,80}$/;
export const SCANNER_JOIN_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{32,160}$/;
export const SCANNER_JOIN_ATTEMPT_ID_PATTERN = /^[a-zA-Z0-9_-]{12,80}$/;
export const SCANNER_CONTRIBUTOR_ID_PATTERN = /^[a-zA-Z0-9_-]{8,80}$/;

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

export function isScannerSessionId(value: unknown): value is string {
  return typeof value === "string" && SCANNER_SESSION_ID_PATTERN.test(value);
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

export type ScannerProtocolVersion = {
  major: number;
  minor: number;
  patch?: number;
};

export type ScannerPeerPlatform = "ios" | "chrome_extension" | "web" | "unknown";

export type ScannerCapability =
  | "ocr"
  | "barcode"
  | "dictation"
  | "photo"
  | "cursor_insert"
  | "sidepanel_results"
  | "photo_retry_queue";

export type ScannerMode = "ocr" | "barcode" | "dictation" | "photo";

export type ScannerPeerInfo = {
  protocolVersion: ScannerProtocolVersion;
  appVersion?: string;
  extensionVersion?: string;
  platform: ScannerPeerPlatform;
  capabilities: ScannerCapability[];
  contributorId?: string;
  deviceLabel?: string;
  chromeSessionId: string;
};

export type ScannerProtocolErrorCode =
  | "unsupported_protocol"
  | "invalid_message"
  | "invalid_state"
  | "transfer_rejected"
  | "storage_unavailable"
  | "closed";

export type ScannerResultKind = "text" | "barcode";

export type ScannerCursorTargetSummary = {
  tabId?: number;
  frameId?: number;
  tabTitle?: string;
  url?: string;
  label?: string;
  hasCursorTarget: boolean;
};

export type ScannerDurablePairing = {
  pairingId: string;
  pairingSecret: string;
  browserSessionId: string;
  displayName?: string;
};

export type ScannerControlHelloMessage = {
  type: "hello";
  messageId: string;
  sentAt: string;
  peer: ScannerPeerInfo;
};

export type ScannerControlSessionReadyMessage = {
  type: "session_ready";
  messageId: string;
  sentAt: string;
  peer: ScannerPeerInfo;
  activeMode?: ScannerMode;
  pairing?: ScannerDurablePairing;
  cursorTarget?: ScannerCursorTargetSummary;
};

export type ScannerControlModeChangedMessage = {
  type: "mode_changed";
  messageId: string;
  sentAt: string;
  mode: ScannerMode;
};

export type ScannerControlCaptureResultMessage = {
  type: "capture_result";
  messageId: string;
  sentAt: string;
  resultId: string;
  resultKind: ScannerResultKind;
  value: string;
  format?: string;
  capturedAt: string;
  insertIntoCursor?: boolean;
  contributorId?: string;
};

export type ScannerControlDictationMessage = {
  type: "dictation";
  messageId: string;
  sentAt: string;
  dictationSessionId: string;
  phase: "started" | "partial" | "final" | "stopped";
  text?: string;
  capturedAt: string;
  insertIntoCursor?: boolean;
};

export type ScannerControlResultReceivedMessage = {
  type: "result_received";
  messageId: string;
  sentAt: string;
  resultId: string;
  savedToResults: boolean;
  insertedIntoCursor?: boolean;
  cursorTarget?: ScannerCursorTargetSummary;
};

export type ScannerControlPhotoChunkAckMessage = {
  type: "photo_chunk_ack";
  messageId: string;
  sentAt: string;
  photoId: string;
  chunkIndex: number;
  totalChunks: number;
};

export type ScannerControlPhotoReceivedMessage = {
  type: "photo_received";
  messageId: string;
  sentAt: string;
  photoId: string;
  photoBatchId: string;
  storedAt: string;
  size: number;
};

export type ScannerControlPhotoRejectedMessage = {
  type: "photo_rejected";
  messageId: string;
  sentAt: string;
  photoId: string;
  reason: "storage_full" | "invalid_photo" | "cancelled" | "unsupported";
  retryable: boolean;
  detail?: string;
};

export type ScannerControlProtocolErrorMessage = {
  type: "protocol_error";
  messageId: string;
  sentAt: string;
  code: ScannerProtocolErrorCode;
  detail?: string;
  receivedType?: string;
};

export type ScannerControlSessionClosedMessage = {
  type: "session_closed";
  messageId: string;
  sentAt: string;
  reason?: "user_closed" | "protocol_error" | "network" | "replaced";
};

export type ScannerControlMessage =
  | ScannerControlHelloMessage
  | ScannerControlSessionReadyMessage
  | ScannerControlModeChangedMessage
  | ScannerControlCaptureResultMessage
  | ScannerControlDictationMessage
  | ScannerControlResultReceivedMessage
  | ScannerControlPhotoChunkAckMessage
  | ScannerControlPhotoReceivedMessage
  | ScannerControlPhotoRejectedMessage
  | ScannerControlProtocolErrorMessage
  | ScannerControlSessionClosedMessage;

export type PhotoTransferStartMessage = {
  type: "photo_start";
  messageId: string;
  sentAt: string;
  photoId: string;
  photoBatchId: string;
  contributorId: string;
  filename: string;
  mimeType: "image/jpeg";
  size: number;
  width: number;
  height: number;
  capturedAt: string;
  chunkSize: number;
  totalChunks: number;
  orientation?: number;
};

export type PhotoTransferChunkMessage = {
  type: "photo_chunk";
  messageId: string;
  sentAt: string;
  photoId: string;
  chunkIndex: number;
  totalChunks: number;
  data: string;
};

export type PhotoTransferBinaryChunkMessage = Omit<PhotoTransferChunkMessage, "data"> & {
  data: Uint8Array;
};

export type PhotoTransferCompleteMessage = {
  type: "photo_complete";
  messageId: string;
  sentAt: string;
  photoId: string;
  totalChunks: number;
  sha256?: string;
};

export type PhotoTransferCancelMessage = {
  type: "photo_cancel";
  messageId: string;
  sentAt: string;
  photoId: string;
  reason?: "user_cancelled" | "replaced" | "failed";
};

export type PhotoTransferMessage =
  | PhotoTransferStartMessage
  | PhotoTransferChunkMessage
  | PhotoTransferCompleteMessage
  | PhotoTransferCancelMessage;

export type ScannerJoinUrlParts = {
  baseUrl?: string;
  token: string;
  sessionId?: string;
  joinAttemptId?: string;
};

const CONTROL_MESSAGE_TYPES = new Set([
  "hello",
  "session_ready",
  "mode_changed",
  "capture_result",
  "dictation",
  "result_received",
  "photo_chunk_ack",
  "photo_received",
  "photo_rejected",
  "protocol_error",
  "session_closed",
]);

const PHOTO_TRANSFER_MESSAGE_TYPES = new Set([
  "photo_start",
  "photo_chunk",
  "photo_complete",
  "photo_cancel",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isIsoDateString(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseProtocolVersion(value: unknown): ScannerProtocolVersion | null {
  if (isRecord(value)) {
    const major = value.major;
    const minor = value.minor;
    const patch = value.patch;
    if (!Number.isInteger(major) || !Number.isInteger(minor)) return null;
    return {
      major: major as number,
      minor: minor as number,
      patch: Number.isInteger(patch) ? (patch as number) : undefined,
    };
  }

  if (typeof value !== "string") return null;
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: match[3] === undefined ? undefined : Number(match[3]),
  };
}

function isSupportedProtocolVersion(value: unknown): value is ScannerProtocolVersion {
  const version = parseProtocolVersion(value);
  return (
    !!version &&
    version.major >= SCANNER_MIN_SUPPORTED_PROTOCOL_MAJOR_VERSION &&
    version.major <= SCANNER_MAX_SUPPORTED_PROTOCOL_MAJOR_VERSION
  );
}

export function parseScannerProtocolVersion(value: unknown) {
  return parseProtocolVersion(value);
}

export function isScannerProtocolVersionSupported(value: unknown) {
  return isSupportedProtocolVersion(value);
}

export function isScannerJoinToken(value: unknown): value is string {
  return typeof value === "string" && SCANNER_JOIN_TOKEN_PATTERN.test(value);
}

export function isScannerJoinAttemptId(value: unknown): value is string {
  return typeof value === "string" && SCANNER_JOIN_ATTEMPT_ID_PATTERN.test(value);
}

export function isScannerContributorId(value: unknown): value is string {
  return typeof value === "string" && SCANNER_CONTRIBUTOR_ID_PATTERN.test(value);
}

export function buildScannerJoinUrl(parts: ScannerJoinUrlParts): string {
  if (!isScannerJoinToken(parts.token)) {
    throw new Error("Invalid scanner join token");
  }
  if (parts.sessionId !== undefined && !isScannerSessionId(parts.sessionId)) {
    throw new Error("Invalid scanner session id");
  }
  if (parts.joinAttemptId !== undefined && !isScannerJoinAttemptId(parts.joinAttemptId)) {
    throw new Error("Invalid scanner join attempt id");
  }

  const url = new URL(parts.baseUrl ?? SCANNER_APP_PAIR_URL);
  url.searchParams.set("token", parts.token);
  if (parts.sessionId) url.searchParams.set("sessionId", parts.sessionId);
  if (parts.joinAttemptId) url.searchParams.set("joinAttemptId", parts.joinAttemptId);
  return url.toString();
}

export function parseScannerJoinUrl(value: string): ScannerJoinUrlParts | null {
  try {
    const url = new URL(value);
    const token = url.searchParams.get("token");
    const sessionId = url.searchParams.get("sessionId") ?? undefined;
    const joinAttemptId = url.searchParams.get("joinAttemptId") ?? undefined;
    if (!isScannerJoinToken(token)) return null;
    if (sessionId !== undefined && !isScannerSessionId(sessionId)) return null;
    if (joinAttemptId !== undefined && !isScannerJoinAttemptId(joinAttemptId)) return null;
    return {
      baseUrl: `${url.protocol}//${url.host}${url.pathname}`,
      token,
      sessionId,
      joinAttemptId,
    };
  } catch (_error) {
    return null;
  }
}

function parseCursorTarget(value: unknown): ScannerCursorTargetSummary | undefined {
  if (!isRecord(value) || typeof value.hasCursorTarget !== "boolean") return undefined;
  return {
    tabId: typeof value.tabId === "number" && Number.isInteger(value.tabId) ? value.tabId : undefined,
    frameId: typeof value.frameId === "number" && Number.isInteger(value.frameId) ? value.frameId : undefined,
    tabTitle: optionalString(value.tabTitle),
    url: optionalString(value.url),
    label: optionalString(value.label),
    hasCursorTarget: value.hasCursorTarget,
  };
}

function parseDurablePairing(value: unknown): ScannerDurablePairing | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isNonEmptyString(value.pairingId) ||
    !isScannerJoinToken(value.pairingSecret) ||
    !isScannerSessionId(value.browserSessionId)
  ) {
    return undefined;
  }
  return {
    pairingId: value.pairingId,
    pairingSecret: value.pairingSecret,
    browserSessionId: value.browserSessionId,
    displayName: optionalString(value.displayName),
  };
}

function isScannerMode(value: unknown): value is ScannerMode {
  return isCaptureMode(value);
}

function isScannerCapability(value: unknown): value is ScannerCapability {
  return (
    value === "ocr" ||
    value === "barcode" ||
    value === "dictation" ||
    value === "photo" ||
    value === "cursor_insert" ||
    value === "sidepanel_results" ||
    value === "photo_retry_queue"
  );
}

function parsePeerInfo(value: unknown): ScannerPeerInfo | null {
  if (!isRecord(value) || !isSupportedProtocolVersion(value.protocolVersion)) return null;
  if (
    value.platform !== "ios" &&
    value.platform !== "chrome_extension" &&
    value.platform !== "web" &&
    value.platform !== "unknown"
  ) {
    return null;
  }
  if (!Array.isArray(value.capabilities) || !value.capabilities.every(isScannerCapability)) {
    return null;
  }
  if (!isScannerSessionId(value.chromeSessionId)) return null;
  if (value.contributorId !== undefined && !isScannerContributorId(value.contributorId)) return null;

  return {
    protocolVersion: parseProtocolVersion(value.protocolVersion)!,
    appVersion: optionalString(value.appVersion),
    extensionVersion: optionalString(value.extensionVersion),
    platform: value.platform,
    capabilities: [...new Set(value.capabilities)],
    contributorId: typeof value.contributorId === "string" ? value.contributorId : undefined,
    deviceLabel: optionalString(value.deviceLabel),
    chromeSessionId: value.chromeSessionId,
  };
}

function hasMessageBase(
  value: Record<string, unknown>
): value is Record<string, unknown> & { messageId: string; sentAt: string } {
  return isNonEmptyString(value.messageId) && isIsoDateString(value.sentAt);
}

export function decodeScannerControlMessage(data: string): ScannerControlMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (_error) {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string" || !CONTROL_MESSAGE_TYPES.has(parsed.type)) {
    return null;
  }
  if (!hasMessageBase(parsed)) return null;

  const base = {
    messageId: parsed.messageId,
    sentAt: parsed.sentAt,
  };

  if (parsed.type === "hello") {
    const peer = parsePeerInfo(parsed.peer);
    return peer ? { type: "hello", ...base, peer } : null;
  }

  if (parsed.type === "session_ready") {
    const peer = parsePeerInfo(parsed.peer);
    if (!peer) return null;
    const activeMode: ScannerMode | undefined =
      parsed.activeMode === undefined ? undefined : isScannerMode(parsed.activeMode) ? parsed.activeMode : undefined;
    if (parsed.activeMode !== undefined && activeMode === undefined) return null;
    return {
      type: "session_ready",
      ...base,
      peer,
      activeMode,
      pairing: parseDurablePairing(parsed.pairing),
      cursorTarget: parseCursorTarget(parsed.cursorTarget),
    };
  }

  if (parsed.type === "mode_changed") {
    return isScannerMode(parsed.mode) ? { type: "mode_changed", ...base, mode: parsed.mode } : null;
  }

  if (parsed.type === "capture_result") {
    if (
      (parsed.resultKind !== "text" && parsed.resultKind !== "barcode") ||
      !isNonEmptyString(parsed.resultId) ||
      !isNonEmptyString(parsed.value) ||
      !isIsoDateString(parsed.capturedAt) ||
      (parsed.contributorId !== undefined && !isScannerContributorId(parsed.contributorId))
    ) {
      return null;
    }
    return {
      type: "capture_result",
      ...base,
      resultId: parsed.resultId,
      resultKind: parsed.resultKind,
      value: parsed.value,
      format: optionalString(parsed.format),
      capturedAt: parsed.capturedAt,
      insertIntoCursor: typeof parsed.insertIntoCursor === "boolean" ? parsed.insertIntoCursor : undefined,
      contributorId: typeof parsed.contributorId === "string" ? parsed.contributorId : undefined,
    };
  }

  if (parsed.type === "dictation") {
    if (
      !isNonEmptyString(parsed.dictationSessionId) ||
      (parsed.phase !== "started" &&
        parsed.phase !== "partial" &&
        parsed.phase !== "final" &&
        parsed.phase !== "stopped") ||
      !isIsoDateString(parsed.capturedAt)
    ) {
      return null;
    }
    if ((parsed.phase === "partial" || parsed.phase === "final") && typeof parsed.text !== "string") {
      return null;
    }
    return {
      type: "dictation",
      ...base,
      dictationSessionId: parsed.dictationSessionId,
      phase: parsed.phase,
      text: typeof parsed.text === "string" ? parsed.text : undefined,
      capturedAt: parsed.capturedAt,
      insertIntoCursor: typeof parsed.insertIntoCursor === "boolean" ? parsed.insertIntoCursor : undefined,
    };
  }

  if (parsed.type === "result_received") {
    if (!isNonEmptyString(parsed.resultId) || typeof parsed.savedToResults !== "boolean") return null;
    return {
      type: "result_received",
      ...base,
      resultId: parsed.resultId,
      savedToResults: parsed.savedToResults,
      insertedIntoCursor: typeof parsed.insertedIntoCursor === "boolean" ? parsed.insertedIntoCursor : undefined,
      cursorTarget: parseCursorTarget(parsed.cursorTarget),
    };
  }

  if (parsed.type === "photo_chunk_ack") {
    if (
      !isNonEmptyString(parsed.photoId) ||
      !isNonNegativeInteger(parsed.chunkIndex) ||
      !isPositiveInteger(parsed.totalChunks) ||
      parsed.chunkIndex >= parsed.totalChunks
    ) {
      return null;
    }
    return {
      type: "photo_chunk_ack",
      ...base,
      photoId: parsed.photoId,
      chunkIndex: parsed.chunkIndex,
      totalChunks: parsed.totalChunks,
    };
  }

  if (parsed.type === "photo_received") {
    if (
      !isNonEmptyString(parsed.photoId) ||
      !isNonEmptyString(parsed.photoBatchId) ||
      !isIsoDateString(parsed.storedAt) ||
      !isPositiveInteger(parsed.size)
    ) {
      return null;
    }
    return {
      type: "photo_received",
      ...base,
      photoId: parsed.photoId,
      photoBatchId: parsed.photoBatchId,
      storedAt: parsed.storedAt,
      size: parsed.size,
    };
  }

  if (parsed.type === "photo_rejected") {
    if (
      !isNonEmptyString(parsed.photoId) ||
      (parsed.reason !== "storage_full" &&
        parsed.reason !== "invalid_photo" &&
        parsed.reason !== "cancelled" &&
        parsed.reason !== "unsupported") ||
      typeof parsed.retryable !== "boolean"
    ) {
      return null;
    }
    return {
      type: "photo_rejected",
      ...base,
      photoId: parsed.photoId,
      reason: parsed.reason,
      retryable: parsed.retryable,
      detail: optionalString(parsed.detail),
    };
  }

  if (parsed.type === "protocol_error") {
    if (
      parsed.code !== "unsupported_protocol" &&
      parsed.code !== "invalid_message" &&
      parsed.code !== "invalid_state" &&
      parsed.code !== "transfer_rejected" &&
      parsed.code !== "storage_unavailable" &&
      parsed.code !== "closed"
    ) {
      return null;
    }
    return {
      type: "protocol_error",
      ...base,
      code: parsed.code,
      detail: optionalString(parsed.detail),
      receivedType: optionalString(parsed.receivedType),
    };
  }

  if (parsed.type === "session_closed") {
    const reason = parsed.reason;
    if (
      reason !== undefined &&
      reason !== "user_closed" &&
      reason !== "protocol_error" &&
      reason !== "network" &&
      reason !== "replaced"
    ) {
      return null;
    }
    return {
      type: "session_closed",
      ...base,
      reason: reason as ScannerControlSessionClosedMessage["reason"],
    };
  }

  return null;
}

export function encodeScannerControlMessage(message: ScannerControlMessage): string {
  const decoded = decodeScannerControlMessage(JSON.stringify(message));
  if (!decoded) throw new Error("Invalid scanner-control message");
  return JSON.stringify(message);
}

export function decodePhotoTransferMessage(data: string): PhotoTransferMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (_error) {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string" || !PHOTO_TRANSFER_MESSAGE_TYPES.has(parsed.type)) {
    return null;
  }
  if (!hasMessageBase(parsed)) return null;

  const base = {
    messageId: parsed.messageId,
    sentAt: parsed.sentAt,
  };

  if (parsed.type === "photo_start") {
    if (
      !isNonEmptyString(parsed.photoId) ||
      !isNonEmptyString(parsed.photoBatchId) ||
      !isScannerContributorId(parsed.contributorId) ||
      !isNonEmptyString(parsed.filename) ||
      parsed.mimeType !== "image/jpeg" ||
      !isPositiveInteger(parsed.size) ||
      !isPositiveInteger(parsed.width) ||
      !isPositiveInteger(parsed.height) ||
      !isIsoDateString(parsed.capturedAt) ||
      !isPositiveInteger(parsed.chunkSize) ||
      !isPositiveInteger(parsed.totalChunks)
    ) {
      return null;
    }
    return {
      type: "photo_start",
      ...base,
      photoId: parsed.photoId,
      photoBatchId: parsed.photoBatchId,
      contributorId: parsed.contributorId,
      filename: parsed.filename,
      mimeType: "image/jpeg",
      size: parsed.size,
      width: parsed.width,
      height: parsed.height,
      capturedAt: parsed.capturedAt,
      chunkSize: parsed.chunkSize,
      totalChunks: parsed.totalChunks,
      orientation:
        typeof parsed.orientation === "number" && Number.isInteger(parsed.orientation)
          ? parsed.orientation
          : undefined,
    };
  }

  if (parsed.type === "photo_chunk") {
    if (
      !isNonEmptyString(parsed.photoId) ||
      !isNonNegativeInteger(parsed.chunkIndex) ||
      !isPositiveInteger(parsed.totalChunks) ||
      parsed.chunkIndex >= parsed.totalChunks ||
      !isNonEmptyString(parsed.data)
    ) {
      return null;
    }
    return {
      type: "photo_chunk",
      ...base,
      photoId: parsed.photoId,
      chunkIndex: parsed.chunkIndex,
      totalChunks: parsed.totalChunks,
      data: parsed.data,
    };
  }

  if (parsed.type === "photo_complete") {
    if (!isNonEmptyString(parsed.photoId) || !isPositiveInteger(parsed.totalChunks)) return null;
    return {
      type: "photo_complete",
      ...base,
      photoId: parsed.photoId,
      totalChunks: parsed.totalChunks,
      sha256: optionalString(parsed.sha256),
    };
  }

  if (parsed.type === "photo_cancel") {
    const reason = parsed.reason;
    if (
      !isNonEmptyString(parsed.photoId) ||
      (reason !== undefined && reason !== "user_cancelled" && reason !== "replaced" && reason !== "failed")
    ) {
      return null;
    }
    return {
      type: "photo_cancel",
      ...base,
      photoId: parsed.photoId,
      reason: reason as PhotoTransferCancelMessage["reason"],
    };
  }

  return null;
}

export function encodePhotoTransferMessage(message: PhotoTransferMessage): string {
  const decoded = decodePhotoTransferMessage(JSON.stringify(message));
  if (!decoded) throw new Error("Invalid photo-transfer message");
  return JSON.stringify(message);
}

export function encodePhotoTransferChunkFrame(
  message: Omit<PhotoTransferChunkMessage, "data">,
  data: Uint8Array
): Uint8Array {
  const validated = decodePhotoTransferMessage(JSON.stringify({ ...message, data: "binary" }));
  if (!validated || validated.type !== "photo_chunk") {
    throw new Error("Invalid photo-transfer chunk frame");
  }

  const header = new TextEncoder().encode(JSON.stringify(message));
  const frame = new Uint8Array(4 + header.byteLength + data.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, header.byteLength, false);
  frame.set(header, 4);
  frame.set(data, 4 + header.byteLength);
  return frame;
}

export function decodePhotoTransferChunkFrame(
  frame: ArrayBuffer | Uint8Array
): PhotoTransferBinaryChunkMessage | null {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  if (bytes.byteLength < 5) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLength = view.getUint32(0, false);
  const payloadOffset = 4 + headerLength;
  if (headerLength <= 0 || payloadOffset > bytes.byteLength) return null;

  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.slice(4, payloadOffset)));
  } catch (_error) {
    return null;
  }

  if (!isRecord(header)) return null;
  const validated = decodePhotoTransferMessage(JSON.stringify({ ...header, data: "binary" }));
  if (!validated || validated.type !== "photo_chunk") return null;

  return {
    type: "photo_chunk",
    messageId: validated.messageId,
    sentAt: validated.sentAt,
    photoId: validated.photoId,
    chunkIndex: validated.chunkIndex,
    totalChunks: validated.totalChunks,
    data: bytes.slice(payloadOffset),
  };
}

export function scannerControlDuplicateKey(message: ScannerControlMessage) {
  if (message.type === "capture_result") {
    return [
      message.type,
      message.resultKind,
      message.format ?? "",
      message.value.trim().toLowerCase(),
      message.contributorId ?? "",
    ].join(":");
  }
  if (message.type === "dictation") {
    return [message.type, message.dictationSessionId, message.phase, message.text ?? ""].join(":");
  }
  if (
    message.type === "result_received" ||
    message.type === "photo_chunk_ack" ||
    message.type === "photo_received" ||
    message.type === "photo_rejected"
  ) {
    return `${message.type}:${"resultId" in message ? message.resultId : message.photoId}`;
  }
  return `${message.type}:${message.messageId}`;
}

export function photoTransferDuplicateKey(message: PhotoTransferMessage) {
  if (message.type === "photo_chunk") {
    return `${message.type}:${message.photoId}:${message.chunkIndex}:${message.totalChunks}`;
  }
  return `${message.type}:${message.photoId}`;
}
