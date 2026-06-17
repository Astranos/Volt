import {
  decodePairingPayload,
  decodeScannerControlMessage,
  encodePairingPayload,
  isScannerSessionId,
  parseScannerJoinUrl,
  parseScannerProtocolVersion,
  SCANNER_ICE_GATHERING_TIMEOUT_MS,
  SCANNER_JOIN_ATTEMPT_TTL_MS,
  SCANNER_PROTOCOL_MAJOR_VERSION,
  SCANNER_PROTOCOL_VERSION,
  SCANNER_SIGNAL_URL,
  SCANNER_STUN_ONLY_RTC_CONFIGURATION,
  type ScannerControlMessage,
} from "@volt/scanner-protocol";
import { Platform } from "react-native";
import { RTCPeerConnection, RTCSessionDescription } from "react-native-webrtc";

const JOIN_ATTEMPT_POLL_INTERVAL_MS = 650;

export type MobilePairingUrl =
  | { type: "join-token"; token: string; sessionId?: string }
  | { type: "offer"; offer: string; answerUrl: string; sessionId?: string };

export type NormalizedScannerControlMessage =
  | { kind: "hello"; protocolMajor: number }
  | { kind: "session_ready"; chromeSessionId?: string; sessionLabel?: string; target?: { tabTitle?: string; cursor?: string; browser?: string } }
  | { kind: "receipt"; id: string; saved?: boolean; inserted?: boolean; target?: { tabTitle?: string; cursor?: string } }
  | { kind: "photo_chunk_ack"; id: string; chunkIndex: number; totalChunks?: number }
  | { kind: "photo_received"; id: string; photoBatchId?: string }
  | { kind: "photo_rejected"; id: string; reason?: string }
  | { kind: "protocol_error"; message: string };

type JoinAttempt = {
  attemptId: string;
  pollUrl?: string;
  answerUrl?: string;
};

function wait(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function parseJson(value: string): any | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getStringParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key);
  return value?.trim() || null;
}

export function parseMobileWebRtcPairingUrl(value: string): MobilePairingUrl | null {
  const join = parseScannerJoinUrl(value);
  if (join) {
    return { type: "join-token", token: join.token, sessionId: join.sessionId };
  }

  try {
    const url = new URL(value);
    const offer = getStringParam(url.searchParams, "offer");
    if (!offer) return null;
    decodePairingPayload(offer);

    const sessionId = getStringParam(url.searchParams, "sessionId") ?? getStringParam(url.searchParams, "session");
    if (sessionId !== null && !isScannerSessionId(sessionId)) return null;

    const answerUrl = getStringParam(url.searchParams, "answerUrl");
    if (answerUrl) {
      const parsedAnswerUrl = new URL(answerUrl);
      if (parsedAnswerUrl.origin !== new URL(SCANNER_SIGNAL_URL).origin) return null;
      return { type: "offer", offer, answerUrl, sessionId: sessionId ?? undefined };
    }

    if (!sessionId) return null;
    return {
      type: "offer",
      offer,
      answerUrl: `${SCANNER_SIGNAL_URL}/${encodeURIComponent(sessionId)}/answer`,
      sessionId,
    };
  } catch {
    return null;
  }
}

export function normalizeScannerControlMessage(data: unknown): NormalizedScannerControlMessage | null {
  if (typeof data !== "string") return null;

  const shared = decodeScannerControlMessage(data);
  if (shared) return normalizeSharedControlMessage(shared);

  const parsed = parseJson(data);
  if (!parsed || typeof parsed !== "object") return null;
  const message = parsed as Record<string, any>;
  const kind = typeof message.kind === "string" ? message.kind : typeof message.type === "string" ? message.type : null;
  if (!kind) return null;

  if (kind === "hello") {
    const version = parseScannerProtocolVersion(message.protocolVersion);
    return {
      kind: "hello",
      protocolMajor: typeof message.protocolMajor === "number" ? message.protocolMajor : version?.major ?? 0,
    };
  }

  if (kind === "session_ready") {
    return {
      kind: "session_ready",
      chromeSessionId: typeof message.chromeSessionId === "string" ? message.chromeSessionId : typeof message.sessionId === "string" ? message.sessionId : undefined,
      target: message.target,
    };
  }

  if (kind === "receipt") {
    return {
      kind: "receipt",
      id: typeof message.id === "string" ? message.id : typeof message.messageId === "string" ? message.messageId : "",
      saved: typeof message.saved === "boolean" ? message.saved : undefined,
      inserted: typeof message.inserted === "boolean" ? message.inserted : undefined,
      target: message.target,
    };
  }

  if (kind === "photo_chunk_ack") {
    const id = typeof message.id === "string" ? message.id : typeof message.photoId === "string" ? message.photoId : "";
    return typeof message.chunkIndex === "number" ? { kind: "photo_chunk_ack", id, chunkIndex: message.chunkIndex, totalChunks: message.totalChunks } : null;
  }

  if (kind === "photo_received") {
    const id = typeof message.id === "string" ? message.id : typeof message.photoId === "string" ? message.photoId : "";
    return id ? { kind: "photo_received", id, photoBatchId: typeof message.photoBatchId === "string" ? message.photoBatchId : undefined } : null;
  }

  if (kind === "photo_rejected") {
    const id = typeof message.id === "string" ? message.id : typeof message.photoId === "string" ? message.photoId : "";
    return id ? { kind: "photo_rejected", id, reason: typeof message.reason === "string" ? message.reason : message.detail } : null;
  }

  if (kind === "protocol_error") {
    return { kind: "protocol_error", message: typeof message.message === "string" ? message.message : message.detail ?? "Protocol error" };
  }

  return null;
}

function normalizeSharedControlMessage(message: ScannerControlMessage): NormalizedScannerControlMessage | null {
  if (message.type === "hello") return { kind: "hello", protocolMajor: message.peer.protocolVersion.major };
  if (message.type === "session_ready") {
    return {
      kind: "session_ready",
      chromeSessionId: message.peer.chromeSessionId,
      sessionLabel: message.peer.deviceLabel,
      target: {
        tabTitle: message.cursorTarget?.tabTitle,
        cursor: message.cursorTarget?.label,
        browser: message.peer.platform === "chrome_extension" ? "Chrome" : undefined,
      },
    };
  }
  if (message.type === "result_received") {
    return {
      kind: "receipt",
      id: message.resultId,
      saved: message.savedToResults,
      inserted: message.insertedIntoCursor,
      target: {
        tabTitle: message.cursorTarget?.tabTitle,
        cursor: message.cursorTarget?.label,
      },
    };
  }
  if (message.type === "photo_chunk_ack") {
    return { kind: "photo_chunk_ack", id: message.photoId, chunkIndex: message.chunkIndex, totalChunks: message.totalChunks };
  }
  if (message.type === "photo_received") {
    return { kind: "photo_received", id: message.photoId, photoBatchId: message.photoBatchId };
  }
  if (message.type === "photo_rejected") {
    return { kind: "photo_rejected", id: message.photoId, reason: message.detail ?? message.reason };
  }
  if (message.type === "protocol_error") {
    return { kind: "protocol_error", message: message.detail ?? message.code };
  }
  return null;
}

export function buildMobileHelloMessage(contributorId: string, chromeSessionId = "local"): ScannerControlMessage {
  return {
    type: "hello",
    messageId: createSessionMessageId("hello"),
    sentAt: new Date().toISOString(),
    peer: {
      protocolVersion: parseScannerProtocolVersion(SCANNER_PROTOCOL_VERSION)!,
      appVersion: "0.1.0",
      platform: Platform.OS === "ios" ? "ios" : "unknown",
      capabilities: ["ocr", "barcode", "dictation", "photo", "photo_retry_queue"],
      contributorId,
      deviceLabel: Platform.OS === "ios" ? "iPhone" : "Android",
      chromeSessionId,
    },
  };
}

export function createSessionMessageId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function createJoinAttempt(joinToken: string, contributorId: string): Promise<JoinAttempt> {
  const encodedToken = encodeURIComponent(joinToken);
  const response = await fetch(`${SCANNER_SIGNAL_URL}/join-token/${encodedToken}/attempt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contributorId,
      deviceLabel: Platform.OS === "ios" ? "iPhone" : "Android",
      protocolVersion: SCANNER_PROTOCOL_VERSION,
      capabilities: ["ocr", "barcode", "dictation", "photo", "photo_retry_queue"],
    }),
  }).catch(() => null);

  if (response?.ok) {
    const payload = await response.json().catch(() => ({}));
    const attempt = payload.attempt && typeof payload.attempt === "object" ? payload.attempt : payload;
    const attemptId = typeof attempt.id === "string" ? attempt.id : typeof attempt.attemptId === "string" ? attempt.attemptId : null;
    if (attemptId) {
      return {
        attemptId,
        pollUrl: `${SCANNER_SIGNAL_URL}/join-token/${encodedToken}/attempt/${encodeURIComponent(attemptId)}/offer`,
        answerUrl: `${SCANNER_SIGNAL_URL}/join-token/${encodedToken}/attempt/${encodeURIComponent(attemptId)}/answer`,
      };
    }
  }

  throw new Error("Could not create join attempt. Reopen the Chrome QR and scan again.");
}

export async function pollJoinOffer(joinToken: string, attempt: JoinAttempt) {
  const startedAt = Date.now();
  const encodedToken = encodeURIComponent(joinToken);
  const encodedAttempt = encodeURIComponent(attempt.attemptId);
  const pollUrls = [
    attempt.pollUrl,
    `${SCANNER_SIGNAL_URL}/join-token/${encodedToken}/attempt/${encodedAttempt}/offer`,
  ].filter(Boolean) as string[];

  while (Date.now() - startedAt < SCANNER_JOIN_ATTEMPT_TTL_MS + 2000) {
    for (const url of pollUrls) {
      const response = await fetch(url).catch(() => null);
      if (!response?.ok) continue;
      const payload = await response.json().catch(() => ({}));
      const rawOffer = typeof payload.offer === "string" ? payload.offer : typeof payload.sdp === "string" ? payload.sdp : null;
      if (rawOffer) {
        const offer = rawOffer.trim().startsWith("{") ? encodePairingPayload(JSON.parse(rawOffer)) : rawOffer;
        return {
          offer,
          answerUrl:
            attempt.answerUrl ??
            (typeof payload.answerUrl === "string" ? payload.answerUrl : `${SCANNER_SIGNAL_URL}/join-token/${encodedToken}/attempt/${encodedAttempt}/answer`),
          sessionId:
            typeof payload.sessionId === "string"
              ? payload.sessionId
              : typeof payload.token?.sessionId === "string"
                ? payload.token.sessionId
                : joinToken,
        };
      }
    }
    await wait(JOIN_ATTEMPT_POLL_INTERVAL_MS);
  }

  throw new Error("Chrome did not publish an offer in time. Reopen the QR and scan again.");
}

export async function postPairingAnswer(answerUrl: string, answer: unknown) {
  const response = await fetch(answerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer: JSON.stringify(answer) }),
  });
  if (!response.ok) throw new Error("Failed to send pairing answer");
}

export async function createPeerConnectionAnswer({
  attachDataChannel,
  offerCode,
  onConnectionStateChange,
}: {
  attachDataChannel: (channel: unknown) => void;
  offerCode: string;
  onConnectionStateChange: (state: string) => void;
}) {
  const pc = new RTCPeerConnection(SCANNER_STUN_ONLY_RTC_CONFIGURATION as any);
  const pcEvents = pc as any;
  pcEvents.ondatachannel = (event: any) => attachDataChannel(event.channel);
  pcEvents.onconnectionstatechange = () => onConnectionStateChange(pc.connectionState);

  await pc.setRemoteDescription(new RTCSessionDescription(decodePairingPayload(offerCode) as any));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, SCANNER_ICE_GATHERING_TIMEOUT_MS);
    pcEvents.onicecandidate = (event: { candidate: unknown | null }) => {
      if (!event.candidate) {
        clearTimeout(timeout);
        resolve();
      }
    };
  });
  if (!pc.localDescription) throw new Error("Failed to create answer");
  return { pc, answer: pc.localDescription };
}

export function isProtocolMajorCompatible(protocolMajor: number) {
  return protocolMajor === SCANNER_PROTOCOL_MAJOR_VERSION;
}
