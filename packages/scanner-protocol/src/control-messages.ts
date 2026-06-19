import {
  SCANNER_MAX_SUPPORTED_PROTOCOL_MAJOR_VERSION,
  SCANNER_MIN_SUPPORTED_PROTOCOL_MAJOR_VERSION,
  isCaptureMode,
} from "./constants.ts";
import { isScannerContributorId, isScannerJoinToken, isScannerSessionId } from "./ids.ts";
import { isIsoDateString, isNonEmptyString, isNonNegativeInteger, isPositiveInteger, isRecord, optionalString } from "./validation.ts";

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

export type EncodeBarcodeMessageInput = {
  barcode: string;
  format?: string;
  insertIntoCursor?: boolean;
  contributorId?: string;
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

function scannerMessageId(prefix: string) {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${Date.now()}_${randomId}`;
}

export function encodeBarcodeMessage(input: EncodeBarcodeMessageInput): string {
  const sentAt = new Date().toISOString();
  return encodeScannerControlMessage({
    type: "capture_result",
    messageId: scannerMessageId("message"),
    sentAt,
    resultId: scannerMessageId("result"),
    resultKind: "barcode",
    value: input.barcode.trim(),
    format: optionalString(input.format),
    capturedAt: sentAt,
    insertIntoCursor: input.insertIntoCursor ?? true,
    contributorId: input.contributorId,
  });
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
