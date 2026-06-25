import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createFileRoute } from "@tanstack/react-router";
import QRCode from "qrcode";
import {
  Camera,
  CheckCircle2,
  Copy,
  Download,
  Image as ImageIcon,
  Images,
  Loader2,
  Radio,
  ScanBarcode,
  ShieldCheck,
  Smartphone,
  Trash2,
  Type,
} from "lucide-react";
import {
  PHOTO_TRANSFER_CHANNEL_LABEL,
  SCANNER_ANSWER_POLL_INTERVAL_MS,
  SCANNER_APP_PAIR_URL,
  SCANNER_CONTROL_CHANNEL_LABEL,
  SCANNER_ICE_GATHERING_TIMEOUT_MS,
  SCANNER_JOIN_TOKEN_TTL_MS,
  SCANNER_PROTOCOL_MAJOR_VERSION,
  SCANNER_PROTOCOL_MINOR_VERSION,
  SCANNER_SIGNAL_URL,
  SCANNER_STUN_ONLY_ICE_SERVERS,
  decodePhotoTransferChunkFrame,
  decodePhotoTransferMessage,
  decodeScannerControlMessage,
  encodeScannerControlMessage,
  normalizeScannerIceServers,
  scannerControlDuplicateKey,
  type PhotoTransferBinaryChunkMessage,
  type PhotoTransferMessage,
  type PhotoTransferStartMessage,
  type ScannerControlMessage,
  type ScannerIceServer,
} from "@volt/scanner-protocol";

import {
  nextReviewInputAfterLiveDictation,
  type LiveDictationInsertion,
} from "./-scanner-demo-dictation";

export const Route = createFileRoute("/scanner-demo")({
  component: ScannerDemo,
});

const SIGNAL_URL = scannerSignalUrl();
const DEFAULT_SESSION_LABEL = "Private browser session";
const REVIEW_INPUT_LABEL = "Review test input";
const WEB_PROTOCOL_VERSION = {
  major: SCANNER_PROTOCOL_MAJOR_VERSION,
  minor: SCANNER_PROTOCOL_MINOR_VERSION,
};

type DemoStatus = "idle" | "creating" | "waiting" | "connecting" | "connected" | "error";

type JoinWindow = {
  browserClaim: string;
  expiresAt: string | null;
  joinToken: string;
  label: string;
  qrCodeUrl: string;
  sessionId: string;
};

type JoinAttempt = {
  answer: RTCSessionDescriptionInit | null;
  hasAnswer: boolean;
  id: string;
};

type PeerSession = {
  answerApplied: boolean;
  control: RTCDataChannel | null;
  id: string;
  pc: RTCPeerConnection;
  photoTransfer: RTCDataChannel | null;
  ready: boolean;
};

type CaptureItem = {
  capturedAt: string;
  format?: string;
  id: string;
  kind: "barcode" | "text" | "dictation";
  value: string;
};

type PhotoItem = {
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

const MAX_CAPTURE_ITEMS = 50;
const MAX_PHOTO_ITEMS = 24;

type PendingPhoto = PhotoTransferStartMessage & {
  chunks: Uint8Array[];
  receivedChunks: number;
  updatedAt: number;
};

function scannerSignalUrl() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_SCANNER_SIGNAL_URL || SCANNER_SIGNAL_URL;
}

function createId(prefix: string) {
  const random = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${random}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function createSecret(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createMessageId(prefix = "control") {
  return createId(prefix);
}

function normalizedSessionLabel(value: string) {
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

function normalizeSessionDescription(value: unknown): RTCSessionDescriptionInit | null {
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

function normalizeJoinAttempt(value: unknown): JoinAttempt | null {
  if (!value || typeof value !== "object") return null;
  const attempt = value as { answer?: unknown; hasAnswer?: unknown; id?: unknown; joinAttemptId?: unknown };
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

function normalizeIceResponse(value: unknown): ScannerIceServer[] | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as { iceServers?: unknown };
  const servers = normalizeScannerIceServers(payload.iceServers);
  return servers && servers.length > 0 ? servers : null;
}

function waitForIceGathering(pc: RTCPeerConnection) {
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

function bytesFromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status: DemoStatus) {
  if (status === "creating") return "Creating pairing";
  if (status === "waiting") return "Waiting for iPhone";
  if (status === "connecting") return "Connecting WebRTC";
  if (status === "connected") return "Connected";
  if (status === "error") return "Needs attention";
  return "Ready";
}

function reviewCursorTarget() {
  return {
    hasCursorTarget: true,
    label: REVIEW_INPUT_LABEL,
    tabTitle: "Volt Scanner",
    url: window.location.href,
  };
}

export function ScannerDemo() {
  const [captures, setCaptures] = useState<CaptureItem[]>([]);
  const [connectedPeerCount, setConnectedPeerCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [iceLabel, setIceLabel] = useState("Not fetched");
  const [joinWindow, setJoinWindow] = useState<JoinWindow | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [reviewInputValue, setReviewInputValue] = useState("");
  const [sessionLabel, setSessionLabel] = useState(DEFAULT_SESSION_LABEL);
  const [status, setStatus] = useState<DemoStatus>("idle");

  const capturesRef = useRef(new Set<string>());
  const joinWindowRef = useRef<JoinWindow | null>(null);
  const liveDictationInsertionsRef = useRef(new Map<string, LiveDictationInsertion>());
  const objectUrlsRef = useRef(new Set<string>());
  const peersRef = useRef(new Map<string, PeerSession>());
  const pendingPhotosRef = useRef(new Map<string, PendingPhoto>());
  const pollTimerRef = useRef<number | null>(null);
  const reviewInputRef = useRef<HTMLTextAreaElement | null>(null);

  const receivedCount = captures.length + photos.length;

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current === null) return;
    window.clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  const disposeRuntime = useCallback(() => {
    clearPollTimer();
    for (const peer of peersRef.current.values()) {
      peer.control?.close();
      peer.photoTransfer?.close();
      peer.pc.close();
    }
    peersRef.current.clear();
    pendingPhotosRef.current.clear();
    capturesRef.current.clear();
    liveDictationInsertionsRef.current.clear();
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    objectUrlsRef.current.clear();
    joinWindowRef.current = null;
  }, [clearPollTimer]);

  const sendControl = useCallback((peer: PeerSession, message: ScannerControlMessage) => {
    if (peer.control?.readyState !== "open") return;
    peer.control.send(encodeScannerControlMessage(message));
  }, []);

  const webPeerInfo = useCallback(
    () => ({
      protocolVersion: WEB_PROTOCOL_VERSION,
      platform: "web" as const,
      capabilities: ["ocr" as const, "barcode" as const, "dictation" as const, "photo" as const],
      chromeSessionId: joinWindowRef.current?.sessionId ?? createId("web-session"),
      deviceLabel: joinWindowRef.current?.label ?? normalizedSessionLabel(sessionLabel),
    }),
    [sessionLabel],
  );

  const sendHello = useCallback(
    (peer: PeerSession) => {
      sendControl(peer, {
        type: "hello",
        messageId: createMessageId("hello"),
        sentAt: new Date().toISOString(),
        peer: webPeerInfo(),
      });
    },
    [sendControl, webPeerInfo],
  );

  const sendSessionReady = useCallback(
    (peer: PeerSession) => {
      sendControl(peer, {
        type: "session_ready",
        messageId: createMessageId("ready"),
        sentAt: new Date().toISOString(),
        peer: webPeerInfo(),
        cursorTarget: reviewCursorTarget(),
      });
    },
    [sendControl, webPeerInfo],
  );

  const refreshPeerCount = useCallback(() => {
    let ready = 0;
    for (const peer of peersRef.current.values()) {
      if (peer.ready) ready += 1;
    }
    setConnectedPeerCount(ready);
  }, []);

  const insertIntoReviewInput = useCallback((value: string) => {
    if (!value) return false;

    const input = reviewInputRef.current;
    setReviewInputValue((current) => {
      if (!input) return current ? `${current}\n${value}` : value;

      const start = input.selectionStart ?? current.length;
      const end = input.selectionEnd ?? current.length;
      return `${current.slice(0, start)}${value}${current.slice(end)}`;
    });

    window.requestAnimationFrame(() => {
      const inputAfterRender = reviewInputRef.current;
      if (!inputAfterRender) return;
      inputAfterRender.focus();
      const insertionPoint = inputAfterRender.value.length;
      inputAfterRender.setSelectionRange(insertionPoint, insertionPoint);
    });

    return true;
  }, []);

  const replaceLiveDictationInReviewInput = useCallback((message: Extract<ScannerControlMessage, { type: "dictation" }>) => {
    const liveSessionId = message.dictationSessionId;
    if (message.phase === "started" || message.phase === "stopped") {
      liveDictationInsertionsRef.current.delete(liveSessionId);
      return false;
    }

    const value = message.text?.trim();
    if (!value) return false;

    setReviewInputValue((current) => {
      const existing = liveDictationInsertionsRef.current.get(liveSessionId);
      const input = reviewInputRef.current;
      const result = nextReviewInputAfterLiveDictation({
        current,
        existing,
        phase: message.phase,
        selectionEnd: input?.selectionEnd ?? current.length,
        selectionStart: input?.selectionStart ?? current.length,
        text: value,
      });
      if (result.insertion) {
        liveDictationInsertionsRef.current.set(liveSessionId, result.insertion);
      } else {
        liveDictationInsertionsRef.current.delete(liveSessionId);
      }
      return result.value;
    });

    window.requestAnimationFrame(() => {
      const inputAfterRender = reviewInputRef.current;
      if (!inputAfterRender) return;
      const liveInsertion = liveDictationInsertionsRef.current.get(liveSessionId);
      if (!liveInsertion) return;
      inputAfterRender.focus();
      inputAfterRender.setSelectionRange(liveInsertion.end, liveInsertion.end);
    });

    return true;
  }, []);

  const closePeer = useCallback(
    (peerId: string) => {
      const peer = peersRef.current.get(peerId);
      if (!peer) return;
      peersRef.current.delete(peerId);
      peer.control?.close();
      peer.photoTransfer?.close();
      peer.pc.close();
      refreshPeerCount();
      if (peersRef.current.size === 0 && status !== "waiting") {
        setStatus(joinWindowRef.current ? "waiting" : "idle");
      }
    },
    [refreshPeerCount, status],
  );

  const addCapture = useCallback(
    (peer: PeerSession, message: ScannerControlMessage) => {
      if (message.type !== "capture_result" && message.type !== "dictation") return;
      const duplicateKey = scannerControlDuplicateKey(message);
      if (capturesRef.current.has(duplicateKey) && message.type !== "dictation") {
        if (message.type === "capture_result") {
          sendControl(peer, {
            type: "result_received",
            messageId: createMessageId("receipt"),
            sentAt: new Date().toISOString(),
            resultId: message.resultId,
            savedToResults: true,
            insertedIntoCursor: false,
          });
        }
        return;
      }
      capturesRef.current.add(duplicateKey);
      if (message.type === "dictation" && (message.phase === "started" || message.phase === "stopped")) {
        const insertedIntoCursor = replaceLiveDictationInReviewInput(message);
        sendControl(peer, {
          type: "result_received",
          messageId: createMessageId("receipt"),
          sentAt: new Date().toISOString(),
          resultId: message.messageId,
          savedToResults: true,
          insertedIntoCursor,
          cursorTarget: reviewCursorTarget(),
        });
        return;
      }
      const item =
        message.type === "capture_result"
          ? {
              capturedAt: message.capturedAt,
              format: message.format,
              id: message.resultId,
              kind: message.resultKind === "barcode" ? ("barcode" as const) : ("text" as const),
              value: message.value,
            }
          : {
              capturedAt: message.capturedAt,
              format: "dictation",
              id: message.dictationSessionId,
              kind: "dictation" as const,
              value: message.text ?? "",
            };
      if (item.value) {
        setCaptures((current) => {
          if (message.type !== "dictation") return [item, ...current].slice(0, MAX_CAPTURE_ITEMS);
          const withoutSession = current.filter((capture) => capture.id !== item.id);
          return [item, ...withoutSession].slice(0, MAX_CAPTURE_ITEMS);
        });
      }
      const insertedIntoCursor =
        message.type === "dictation" ? replaceLiveDictationInReviewInput(message) : insertIntoReviewInput(item.value);
      sendControl(peer, {
        type: "result_received",
        messageId: createMessageId("receipt"),
        sentAt: new Date().toISOString(),
        resultId: item.id,
        savedToResults: true,
        insertedIntoCursor,
        cursorTarget: reviewCursorTarget(),
      });
    },
    [insertIntoReviewInput, replaceLiveDictationInReviewInput, sendControl],
  );

  const handleControlMessage = useCallback(
    (peer: PeerSession, rawData: string) => {
      const message = decodeScannerControlMessage(rawData);
      if (!message) {
        sendControl(peer, {
          type: "protocol_error",
          messageId: createMessageId("protocol"),
          sentAt: new Date().toISOString(),
          code: "invalid_message",
        });
        return;
      }
      if (message.type === "hello") {
        peer.ready = true;
        sendSessionReady(peer);
        setStatus("connected");
        refreshPeerCount();
        return;
      }
      if (message.type === "capture_result" || message.type === "dictation") {
        addCapture(peer, message);
        return;
      }
      if (message.type === "session_closed") {
        closePeer(peer.id);
      }
    },
    [addCapture, closePeer, refreshPeerCount, sendControl, sendSessionReady],
  );

  const assemblePhoto = useCallback(
    (peer: PeerSession, pending: PendingPhoto) => {
      pendingPhotosRef.current.delete(pending.photoId);
      const blob = new Blob(pending.chunks, { type: pending.mimeType });
      const objectUrl = URL.createObjectURL(blob);
      objectUrlsRef.current.add(objectUrl);
      setPhotos((current) => {
        const next = [
          {
          capturedAt: pending.capturedAt,
          filename: pending.filename,
          height: pending.height,
          id: pending.photoId,
          mimeType: pending.mimeType,
          objectUrl,
          photoBatchId: pending.photoBatchId,
          size: blob.size || pending.size,
          width: pending.width,
        },
          ...current,
        ];
        for (const removed of next.slice(MAX_PHOTO_ITEMS)) {
          URL.revokeObjectURL(removed.objectUrl);
          objectUrlsRef.current.delete(removed.objectUrl);
        }
        return next.slice(0, MAX_PHOTO_ITEMS);
      });
      sendControl(peer, {
        type: "photo_received",
        messageId: createMessageId("photo"),
        sentAt: new Date().toISOString(),
        photoId: pending.photoId,
        photoBatchId: pending.photoBatchId,
        storedAt: new Date().toISOString(),
        size: Math.max(1, blob.size || pending.size),
      });
    },
    [sendControl],
  );

  const handlePhotoMessage = useCallback(
    (peer: PeerSession, message: PhotoTransferMessage | PhotoTransferBinaryChunkMessage) => {
      if (message.type === "photo_start") {
        pendingPhotosRef.current.set(message.photoId, {
          ...message,
          chunks: Array.from({ length: message.totalChunks }),
          receivedChunks: 0,
          updatedAt: Date.now(),
        });
        return;
      }
      if (message.type === "photo_cancel") {
        pendingPhotosRef.current.delete(message.photoId);
        return;
      }
      if (message.type === "photo_chunk") {
        const pending = pendingPhotosRef.current.get(message.photoId);
        if (!pending || message.chunkIndex < 0 || message.chunkIndex >= pending.totalChunks) return;
        if (!pending.chunks[message.chunkIndex]) pending.receivedChunks += 1;
        pending.chunks[message.chunkIndex] =
          typeof message.data === "string" ? bytesFromBase64(message.data) : message.data;
        pending.updatedAt = Date.now();
        sendControl(peer, {
          type: "photo_chunk_ack",
          messageId: createMessageId("photo"),
          sentAt: new Date().toISOString(),
          photoId: message.photoId,
          chunkIndex: message.chunkIndex,
          totalChunks: pending.totalChunks,
        });
        return;
      }
      if (message.type === "photo_complete") {
        const pending = pendingPhotosRef.current.get(message.photoId);
        if (!pending || pending.receivedChunks !== pending.totalChunks) return;
        assemblePhoto(peer, pending);
      }
    },
    [assemblePhoto, sendControl],
  );

  const configurePhotoChannel = useCallback(
    (peer: PeerSession, channel: RTCDataChannel) => {
      channel.binaryType = "arraybuffer";
      channel.onmessage = (event) => {
        const message =
          typeof event.data === "string"
            ? decodePhotoTransferMessage(event.data)
            : event.data instanceof ArrayBuffer
              ? decodePhotoTransferChunkFrame(event.data)
              : null;
        if (message) handlePhotoMessage(peer, message);
      };
    },
    [handlePhotoMessage],
  );

  const configureControlChannel = useCallback(
    (peer: PeerSession, channel: RTCDataChannel) => {
      channel.onopen = () => {
        sendHello(peer);
      };
      channel.onmessage = (event) => {
        if (typeof event.data === "string") handleControlMessage(peer, event.data);
      };
      channel.onclose = () => closePeer(peer.id);
      channel.onerror = () => {
        sendControl(peer, {
          type: "protocol_error",
          messageId: createMessageId("protocol"),
          sentAt: new Date().toISOString(),
          code: "invalid_state",
        });
        closePeer(peer.id);
      };
    },
    [closePeer, handleControlMessage, sendControl, sendHello],
  );

  const fetchIceServers = useCallback(async () => {
    try {
      const response = await fetch(`${SIGNAL_URL}/ice-servers`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`ICE server request failed (${response.status})`);
      const iceServers = normalizeIceResponse(await response.json());
      if (!iceServers) throw new Error("ICE server response was invalid");
      const hasTurn = iceServers.some((server) =>
        (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => url.startsWith("turn:") || url.startsWith("turns:")),
      );
      setIceLabel(hasTurn ? "Cloudflare TURN ready" : "STUN ready");
      return iceServers;
    } catch (_error) {
      setIceLabel("STUN fallback");
      return SCANNER_STUN_ONLY_ICE_SERVERS;
    }
  }, []);

  const postPeerOffer = useCallback(async (windowState: JoinWindow, attemptId: string, offer: RTCSessionDescriptionInit) => {
    const response = await fetch(
      `${SIGNAL_URL}/join-token/${encodeURIComponent(windowState.joinToken)}/attempt/${encodeURIComponent(attemptId)}/offer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Volt-Browser-Claim": windowState.browserClaim },
        body: JSON.stringify({
          browserClaim: windowState.browserClaim,
          channels: [SCANNER_CONTROL_CHANNEL_LABEL, PHOTO_TRANSFER_CHANNEL_LABEL],
          offer: JSON.stringify(offer),
        }),
      },
    );
    if (!response.ok) throw new Error(`Failed to post WebRTC offer (${response.status})`);
  }, []);

  const createPeerOffer = useCallback(
    async (windowState: JoinWindow, attemptId: string) => {
      if (peersRef.current.has(attemptId)) return;
      setStatus("connecting");
      const iceServers = await fetchIceServers();
      const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: "all" });
      const peer: PeerSession = {
        answerApplied: false,
        control: null,
        id: attemptId,
        pc,
        photoTransfer: null,
        ready: false,
      };
      peersRef.current.set(attemptId, peer);

      peer.control = pc.createDataChannel(SCANNER_CONTROL_CHANNEL_LABEL, { ordered: true });
      peer.photoTransfer = pc.createDataChannel(PHOTO_TRANSFER_CHANNEL_LABEL, { ordered: true });
      configureControlChannel(peer, peer.control);
      configurePhotoChannel(peer, peer.photoTransfer);

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
          closePeer(peer.id);
        }
        if (pc.connectionState === "connected") {
          setStatus("connected");
          refreshPeerCount();
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);
      if (!pc.localDescription) throw new Error("Failed to create WebRTC offer");
      await postPeerOffer(windowState, attemptId, pc.localDescription);
    },
    [closePeer, configureControlChannel, configurePhotoChannel, fetchIceServers, postPeerOffer, refreshPeerCount],
  );

  const applyPeerAnswer = useCallback(async (attemptId: string, answer: RTCSessionDescriptionInit) => {
    const peer = peersRef.current.get(attemptId);
    if (!peer || peer.answerApplied) return;
    await peer.pc.setRemoteDescription(answer);
    peer.answerApplied = true;
  }, []);

  const fetchPeerAnswer = useCallback(async (windowState: JoinWindow, attemptId: string) => {
    const response = await fetch(
      `${SIGNAL_URL}/join-token/${encodeURIComponent(windowState.joinToken)}/attempt/${encodeURIComponent(attemptId)}/answer`,
      { headers: { "X-Volt-Browser-Claim": windowState.browserClaim } },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { answer?: unknown };
    return normalizeSessionDescription(payload.answer);
  }, []);

  const pollJoinAttempts = useCallback(async () => {
    const windowState = joinWindowRef.current;
    if (!windowState) return;
    try {
      const response = await fetch(`${SIGNAL_URL}/join-token/${encodeURIComponent(windowState.joinToken)}/attempts`, {
        headers: { "X-Volt-Browser-Claim": windowState.browserClaim },
      });
      if (!response.ok) throw new Error(`Join attempt poll failed (${response.status})`);
      const payload = (await response.json()) as { attempts?: unknown[]; joinAttempts?: unknown[] };
      const rawAttempts = Array.isArray(payload.attempts)
        ? payload.attempts
        : Array.isArray(payload.joinAttempts)
          ? payload.joinAttempts
          : [];
      const attempts = rawAttempts.map(normalizeJoinAttempt).filter((attempt): attempt is JoinAttempt => !!attempt);
      for (const attempt of attempts) {
        if (!peersRef.current.has(attempt.id)) {
          await createPeerOffer(windowState, attempt.id);
        }
        if (peersRef.current.get(attempt.id)?.answerApplied) continue;
        const answer = attempt.answer ?? (attempt.hasAnswer ? await fetchPeerAnswer(windowState, attempt.id) : null);
        if (answer) await applyPeerAnswer(attempt.id, answer);
      }
    } catch (pollError) {
      setError(pollError instanceof Error ? pollError.message : "Failed to poll join attempts");
    } finally {
      if (joinWindowRef.current) {
        pollTimerRef.current = window.setTimeout(() => void pollJoinAttempts(), SCANNER_ANSWER_POLL_INTERVAL_MS);
      }
    }
  }, [applyPeerAnswer, createPeerOffer, fetchPeerAnswer]);

  const reset = useCallback(() => {
    disposeRuntime();
    setCaptures([]);
    setConnectedPeerCount(0);
    setError(null);
    setJoinWindow(null);
    setPhotos([]);
    setQrDataUrl(null);
    setReviewInputValue("");
    setStatus("idle");
  }, [disposeRuntime]);

  const startPairing = useCallback(async () => {
    reset();
    setStatus("creating");
    try {
      await fetchIceServers();
      const sessionId = createId("web-session");
      const browserClaim = createSecret(32);
      const label = normalizedSessionLabel(sessionLabel);
      const response = await fetch(`${SIGNAL_URL}/join-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browserClaim,
          capabilities: ["text", "barcode", "dictation", "photo", "photo-chunk-ack"],
          deviceLabel: label,
          role: "browser",
          sessionId,
          transport: "webrtc",
          ttlMs: SCANNER_JOIN_TOKEN_TTL_MS,
          webRtcOnly: true,
        }),
      });
      if (!response.ok) throw new Error(`Failed to create join token (${response.status})`);
      const payload = (await response.json()) as Record<string, unknown>;
      const joinToken =
        typeof payload.token === "string" && payload.token
          ? payload.token
          : typeof payload.joinToken === "string" && payload.joinToken
            ? payload.joinToken
            : "";
      if (!joinToken) throw new Error("Signal service did not return a join token");
      const returnedSessionId = typeof payload.sessionId === "string" && payload.sessionId ? payload.sessionId : sessionId;
      const qrCodeUrl =
        typeof payload.qrCodeUrl === "string" && payload.qrCodeUrl
          ? payload.qrCodeUrl
          : typeof payload.joinUrl === "string" && payload.joinUrl
            ? payload.joinUrl
            : `${SCANNER_APP_PAIR_URL}?sessionId=${encodeURIComponent(returnedSessionId)}&session=${encodeURIComponent(returnedSessionId)}&token=${encodeURIComponent(joinToken)}&joinToken=${encodeURIComponent(joinToken)}&transport=webrtc&label=${encodeURIComponent(label)}`;
      const nextWindow: JoinWindow = {
        browserClaim,
        expiresAt: typeof payload.expiresAt === "string" ? payload.expiresAt : null,
        joinToken,
        label,
        qrCodeUrl,
        sessionId: returnedSessionId,
      };
      const qrUrl = await QRCode.toDataURL(qrCodeUrl, {
        color: { dark: "#111827", light: "#ffffff" },
        errorCorrectionLevel: "H",
        margin: 3,
        width: 768,
      });
      joinWindowRef.current = nextWindow;
      setJoinWindow(nextWindow);
      setQrDataUrl(qrUrl);
      setStatus("waiting");
      pollTimerRef.current = window.setTimeout(() => void pollJoinAttempts(), 0);
    } catch (startError) {
      setStatus("error");
      setError(startError instanceof Error ? startError.message : "Failed to start scanner demo");
    }
  }, [fetchIceServers, pollJoinAttempts, reset, sessionLabel]);

  const copyPairingUrl = useCallback(async () => {
    if (!joinWindow?.qrCodeUrl) return;
    await navigator.clipboard.writeText(joinWindow.qrCodeUrl);
  }, [joinWindow?.qrCodeUrl]);

  useEffect(() => disposeRuntime, [disposeRuntime]);

  return (
    <main className="min-h-screen bg-[#f4f7f5] text-zinc-950">
      <header className="border-b border-zinc-950 bg-white">
        <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <a href="/" className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <img src="/assets/volt.webp" alt="" className="size-8 rounded-[0.5rem] object-cover" />
            <span className="truncate">Volt web scanner</span>
          </a>
          <div className="hidden items-center gap-2 text-xs font-semibold text-zinc-700 sm:flex">
            <span className="inline-flex items-center gap-1.5 border border-zinc-300 bg-[#f6ff7f] px-2.5 py-1">
              <ShieldCheck size={13} />
              Browser-only workspace
            </span>
            <span className="inline-flex items-center gap-1.5 border border-zinc-300 bg-cyan-50 px-2.5 py-1">
              <ImageIcon size={13} />
              Downloadable batches
            </span>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.28fr)] lg:px-8">
        <aside className="min-w-0 border border-zinc-950 bg-[#15130f] text-white">
          <div className="border-b border-white/15 p-4">
            <p className="text-xs font-semibold uppercase text-[#f6ff7f]">Private receiver</p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight sm:text-4xl lg:text-3xl xl:text-4xl">
              Scan into this browser.
            </h1>
            <p className="mt-3 text-sm leading-6 text-zinc-300">
              Use Volt on iPhone to send text, barcodes, dictation, and photo sets to this tab.
            </p>
          </div>

          <div className="grid gap-px border-b border-white/15 bg-white/15 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <StatusTile icon={Smartphone} label="Session" value={statusLabel(status)} dark />
            <StatusTile icon={Radio} label="Link" value={iceLabel} dark />
            <StatusTile icon={CheckCircle2} label="Items" value={String(receivedCount)} dark />
          </div>

          <div className="space-y-4 p-4">
            {error ? (
              <div className="border border-red-300 bg-red-950/60 px-3 py-2 text-sm text-red-100">{error}</div>
            ) : null}

            <div>
              <label htmlFor="private-session-label" className="text-xs font-semibold uppercase text-zinc-400">
                Session name
              </label>
              <input
                id="private-session-label"
                type="text"
                value={sessionLabel}
                maxLength={64}
                onChange={(event) => setSessionLabel(event.target.value)}
                placeholder={DEFAULT_SESSION_LABEL}
                className="mt-2 h-11 w-full border border-white/20 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-[#f6ff7f]"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void startPairing()}
                disabled={status === "creating" || status === "connecting"}
                className="inline-flex h-11 min-w-0 items-center justify-center gap-2 bg-[#f6ff7f] px-3 text-sm font-semibold text-zinc-950 hover:bg-[#ecf75f] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "creating" || status === "connecting" ? <Loader2 size={17} className="animate-spin" /> : <ScanBarcode size={17} />}
                <span className="truncate">{joinWindow ? "New" : "Create"}</span>
              </button>
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-11 items-center justify-center gap-2 border border-white/25 bg-transparent px-3 text-sm font-semibold text-white hover:bg-white/10"
              >
                <Trash2 size={17} />
                Reset
              </button>
            </div>
          </div>
        </aside>

        <div className="grid min-w-0 gap-4">
          <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(15rem,0.48fr)_minmax(0,1fr)]">
            <div className="border border-zinc-950 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-zinc-950">Pairing dock</h2>
                {status === "waiting" ? <span className="bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">active</span> : null}
              </div>
              <div className="mt-3 grid aspect-square max-h-[20rem] place-items-center border border-zinc-300 bg-[#f9faf8] p-3">
                {qrDataUrl ? (
                  <img src={qrDataUrl} alt="Volt scanner pairing QR code" className="h-full w-full object-contain" />
                ) : (
                  <Camera size={42} className="text-zinc-300" />
                )}
              </div>
              <button
                type="button"
                onClick={() => void copyPairingUrl()}
                disabled={!joinWindow?.qrCodeUrl}
                className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 border border-zinc-950 bg-white px-3 text-sm font-semibold text-zinc-950 hover:bg-zinc-950 hover:text-white disabled:cursor-not-allowed disabled:border-zinc-300 disabled:text-zinc-400 disabled:hover:bg-white"
              >
                <Copy size={16} />
                Copy pairing link
              </button>
            </div>

            <div className="grid min-w-0 content-between border border-zinc-950 bg-white">
              <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_13rem]">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase text-zinc-500">No extension required</p>
                  <h2 className="mt-2 text-2xl font-semibold leading-tight text-zinc-950">
                    A temporary scan desk for product photos and copied results.
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-zinc-600">
                    Keep this tab open while you scan. Copy results as they arrive, or download photo batches before closing the session.
                  </p>
                </div>
                <dl className="grid content-start gap-3 border-l-0 border-zinc-200 text-sm sm:border-l sm:pl-4">
                  <InfoRow label="Status" value={statusLabel(status)} />
                  <InfoRow label="Name" value={joinWindow?.label ?? normalizedSessionLabel(sessionLabel)} />
                  <InfoRow label="Expires" value={joinWindow?.expiresAt ? new Date(joinWindow.expiresAt).toLocaleTimeString() : "Not active"} />
                  <InfoRow label="Peers" value={String(connectedPeerCount)} />
                </dl>
              </div>
              <div className="grid border-t border-zinc-950 sm:grid-cols-3">
                <InstructionStep value="1" text="Create session" />
                <InstructionStep value="2" text="Scan the QR" />
                <InstructionStep value="3" text="Copy or download" />
              </div>
            </div>
          </section>

          <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,0.94fr)_minmax(0,1.06fr)]">
            <ResultsPanel
              captures={captures}
              reviewInputRef={reviewInputRef}
              reviewInputValue={reviewInputValue}
              onReviewInputChange={setReviewInputValue}
            />
            <PhotosPanel photos={photos} />
          </section>
        </div>
      </section>
    </main>
  );
}

function StatusTile({
  dark = false,
  icon: Icon,
  label,
  value,
}: {
  dark?: boolean;
  icon: typeof Smartphone;
  label: string;
  value: string;
}) {
  return (
    <div className={dark ? "bg-[#15130f] p-4 text-white" : "bg-white p-4"}>
      <div className={dark ? "flex items-center gap-2 text-xs font-medium uppercase text-zinc-400" : "flex items-center gap-2 text-xs font-medium uppercase text-zinc-500"}>
        <Icon size={14} />
        {label}
      </div>
      <div className={dark ? "mt-2 truncate text-sm font-semibold text-white" : "mt-2 truncate text-sm font-semibold text-zinc-950"}>{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="truncate font-medium text-zinc-950">{value}</dd>
    </div>
  );
}

function copyText(value: string) {
  if (!value) return Promise.resolve();
  return navigator.clipboard.writeText(value);
}

function downloadUrl(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || "volt-photo.jpg";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function downloadPhotos(photos: PhotoItem[]) {
  for (const [index, photo] of photos.entries()) {
    window.setTimeout(() => downloadUrl(photo.objectUrl, photo.filename), index * 120);
  }
}

function InstructionStep({ text, value }: { text: string; value: string }) {
  return (
    <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 p-3 text-sm">
      <span className="grid size-7 place-items-center bg-zinc-950 text-xs font-semibold text-white">{value}</span>
      <span className="min-w-0 self-center font-medium leading-5 text-zinc-800">{text}</span>
    </div>
  );
}

function ResultsPanel({
  captures,
  onReviewInputChange,
  reviewInputRef,
  reviewInputValue,
}: {
  captures: CaptureItem[];
  onReviewInputChange: (value: string) => void;
  reviewInputRef: RefObject<HTMLTextAreaElement | null>;
  reviewInputValue: string;
}) {
  const allCaptureText = useMemo(() => captures.map((capture) => capture.value).join("\n"), [captures]);

  return (
    <section className="min-w-0 border border-zinc-950 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-950 bg-[#e8fff3] px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Type size={16} />
          Text lane
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">{captures.length}</span>
          <button
            type="button"
            onClick={() => void copyText(allCaptureText || reviewInputValue)}
            disabled={!allCaptureText && !reviewInputValue}
            className="inline-flex h-8 items-center justify-center gap-1.5 border border-zinc-950 bg-white px-2.5 text-xs font-semibold text-zinc-950 hover:bg-zinc-950 hover:text-white disabled:cursor-not-allowed disabled:border-zinc-300 disabled:text-zinc-400 disabled:hover:bg-white"
          >
            <Copy size={13} />
            Copy all
          </button>
        </div>
      </div>
      <div className="border-b border-zinc-950 p-3">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="review-test-input" className="text-xs font-semibold uppercase text-zinc-500">
            Live clipboard
          </label>
          <button
            type="button"
            onClick={() => void copyText(reviewInputValue)}
            disabled={!reviewInputValue}
            className="inline-flex h-8 items-center justify-center gap-1.5 border border-zinc-300 bg-white px-2.5 text-xs font-semibold text-zinc-800 hover:border-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Copy size={13} />
            Copy
          </button>
        </div>
        <textarea
          ref={reviewInputRef}
          id="review-test-input"
          value={reviewInputValue}
          onChange={(event) => onReviewInputChange(event.target.value)}
          placeholder="Scanned text, barcodes, and dictation appear here."
          className="mt-2 min-h-24 w-full resize-y border border-zinc-300 bg-[#fbfcfa] px-3 py-2 text-sm leading-6 text-zinc-950 outline-none focus:border-zinc-950"
        />
      </div>
      <div className="max-h-[34rem] overflow-auto p-3">
        {captures.length === 0 ? (
          <EmptyState label="No scanner results yet" />
        ) : (
          <div className="space-y-3">
            {captures.map((capture) => (
              <article key={`${capture.id}:${capture.capturedAt}`} className="border border-zinc-300 bg-[#fbfcfa] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="bg-white px-2 py-1 font-medium capitalize text-zinc-700">{capture.kind}</span>
                    <time dateTime={capture.capturedAt}>{new Date(capture.capturedAt).toLocaleTimeString()}</time>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyText(capture.value)}
                    className="inline-flex h-7 items-center justify-center gap-1.5 border border-zinc-300 bg-white px-2 text-xs font-semibold text-zinc-800 hover:border-zinc-950"
                  >
                    <Copy size={12} />
                    Copy
                  </button>
                </div>
                <p className="mt-2 break-words text-sm font-medium leading-6 text-zinc-950">{capture.value}</p>
                {capture.format ? <p className="mt-2 text-xs text-zinc-500">{capture.format}</p> : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function PhotosPanel({ photos }: { photos: PhotoItem[] }) {
  const photoBatches = useMemo(() => {
    const batches = new Map<string, PhotoItem[]>();
    for (const photo of photos) {
      const batch = batches.get(photo.photoBatchId) ?? [];
      batch.push(photo);
      batches.set(photo.photoBatchId, batch);
    }
    return Array.from(batches, ([id, items]) => ({ id, items }));
  }, [photos]);

  return (
    <section className="min-w-0 border border-zinc-950 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-950 bg-[#fff4d8] px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ImageIcon size={16} />
          Photo batches
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">{photos.length}</span>
          <button
            type="button"
            onClick={() => downloadPhotos(photos)}
            disabled={photos.length === 0}
            className="inline-flex h-8 items-center justify-center gap-1.5 border border-zinc-950 bg-white px-2.5 text-xs font-semibold text-zinc-950 hover:bg-zinc-950 hover:text-white disabled:cursor-not-allowed disabled:border-zinc-300 disabled:text-zinc-400 disabled:hover:bg-white"
          >
            <Download size={13} />
            Download all
          </button>
        </div>
      </div>
      <div className="max-h-[34rem] overflow-auto p-3">
        {photos.length === 0 ? (
          <EmptyState label="No photos received yet" />
        ) : (
          <div className="space-y-4">
            {photoBatches.map((batch) => (
              <section key={batch.id} className="border border-zinc-300 bg-[#fbfcfa] p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-zinc-950">
                    <Images size={15} />
                    <span className="truncate">Batch {batch.id.slice(-6)}</span>
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span>{batch.items.length} photo{batch.items.length === 1 ? "" : "s"}</span>
                    <button
                      type="button"
                      onClick={() => downloadPhotos(batch.items)}
                      className="inline-flex h-8 items-center justify-center gap-1.5 border border-zinc-300 bg-white px-2.5 text-xs font-semibold text-zinc-800 hover:border-zinc-950"
                    >
                      <Download size={13} />
                      Download batch
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {batch.items.map((photo) => (
                    <article key={photo.id} className="min-w-0 overflow-hidden border border-zinc-200 bg-white">
                      <img src={photo.objectUrl} alt={photo.filename} className="aspect-[4/3] w-full bg-zinc-100 object-contain" />
                      <div className="space-y-2 p-3 text-xs text-zinc-500">
                        <div className="truncate text-sm font-semibold text-zinc-950">{photo.filename}</div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>{formatBytes(photo.size)}</span>
                          {photo.width && photo.height ? <span>{photo.width} x {photo.height}</span> : null}
                          <time dateTime={photo.capturedAt}>{new Date(photo.capturedAt).toLocaleString()}</time>
                        </div>
                        <button
                          type="button"
                          onClick={() => downloadUrl(photo.objectUrl, photo.filename)}
                          className="inline-flex h-8 w-full items-center justify-center gap-1.5 border border-zinc-300 bg-white px-2.5 text-xs font-semibold text-zinc-800 hover:border-zinc-950"
                        >
                          <Download size={13} />
                          Download
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="grid min-h-40 place-items-center border border-dashed border-zinc-300 bg-[#fbfcfa] px-4 text-center text-sm text-zinc-500">
      {label}
    </div>
  );
}
