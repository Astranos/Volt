import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createFileRoute } from "@tanstack/react-router";
import QRCode from "qrcode";
import {
  Camera,
  CheckCircle2,
  Copy,
  Image as ImageIcon,
  Link as LinkIcon,
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
  const signalHost = useMemo(() => new URL(SIGNAL_URL).host, []);

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
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <a href="/" className="flex items-center gap-2 text-sm font-semibold">
            <img src="/assets/volt.webp" alt="" className="size-8 rounded-[0.65rem] object-cover" />
            Volt scanner pairing
          </a>
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5">
              <Radio size={13} />
              {signalHost}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5">
              <ShieldCheck size={13} />
              Local photo display only
            </span>
          </div>
        </div>
      </header>

      <section className="border-b border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[0.82fr_1.18fr] lg:px-8 lg:py-10">
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-sm font-semibold text-emerald-700">Private web receiver</p>
              <h1 className="mt-3 max-w-2xl text-4xl font-semibold leading-tight text-zinc-950 sm:text-5xl">
                Pair the iPhone scanner with a browser session
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-600">
                This page mirrors the Chrome extension receiver for testing and app review. Name the session, scan the QR in the Volt iPhone app, and receive barcode, OCR, dictation, and photo captures in this browser only.
              </p>
            </div>

            <div className="grid gap-px overflow-hidden rounded-[1.35rem] border border-zinc-200 bg-zinc-200 sm:grid-cols-3">
              <StatusTile icon={Smartphone} label="Pairing" value={statusLabel(status)} />
              <StatusTile icon={Radio} label="ICE" value={iceLabel} />
              <StatusTile icon={CheckCircle2} label="Received" value={String(receivedCount)} />
            </div>

            {error ? (
              <div className="rounded-[0.95rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
            ) : null}

            <div className="max-w-md">
              <label htmlFor="private-session-label" className="text-sm font-semibold text-zinc-800">
                Session name
              </label>
              <input
                id="private-session-label"
                type="text"
                value={sessionLabel}
                maxLength={64}
                onChange={(event) => setSessionLabel(event.target.value)}
                placeholder={DEFAULT_SESSION_LABEL}
                className="mt-2 h-11 w-full rounded-[0.85rem] border border-zinc-300 bg-white px-3 text-sm text-zinc-950 outline-none focus:border-zinc-950"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void startPairing()}
                disabled={status === "creating" || status === "connecting"}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[0.85rem] bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {status === "creating" || status === "connecting" ? <Loader2 size={17} className="animate-spin" /> : <ScanBarcode size={17} />}
                {joinWindow ? "Generate new session" : "Generate pairing session"}
              </button>
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-[0.85rem] border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-800 hover:border-zinc-950"
              >
                <Trash2 size={17} />
                Reset
              </button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.75fr)_1fr]">
            <section className="rounded-[1.35rem] border border-zinc-200 bg-zinc-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-zinc-950">Pairing QR</h2>
                {status === "waiting" ? <span className="text-xs font-medium text-emerald-700">active</span> : null}
              </div>
              <div className="mt-4 grid aspect-square place-items-center rounded-[0.95rem] border border-zinc-200 bg-white p-3">
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
                className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[0.85rem] border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 hover:border-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Copy size={16} />
                Copy pairing URL
              </button>
            </section>

            <section className="rounded-[1.35rem] border border-zinc-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-zinc-950">Session</h2>
                <span className="text-xs text-zinc-500">{connectedPeerCount} peer{connectedPeerCount === 1 ? "" : "s"}</span>
              </div>
              <dl className="mt-4 grid gap-3 text-sm">
                <InfoRow label="Status" value={statusLabel(status)} />
                <InfoRow label="Name" value={joinWindow?.label ?? normalizedSessionLabel(sessionLabel)} />
                <InfoRow label="Join token" value={joinWindow ? `...${joinWindow.joinToken.slice(-8)}` : "Not created"} />
                <InfoRow label="Expires" value={joinWindow?.expiresAt ? new Date(joinWindow.expiresAt).toLocaleTimeString() : "Not active"} />
                <InfoRow label="Storage" value="Browser memory only" />
              </dl>
              <div className="mt-4 rounded-[0.95rem] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-900">
                Photo bytes are assembled into Blob URLs in this tab and are never written to Convex, Vercel, localStorage, or IndexedDB.
              </div>
              {joinWindow?.qrCodeUrl ? (
                <div className="mt-4 flex items-start gap-2 rounded-[0.95rem] border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                  <LinkIcon size={14} className="mt-0.5 shrink-0" />
                  <span className="break-all">{joinWindow.qrCodeUrl}</span>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-2 lg:px-8">
        <ResultsPanel
          captures={captures}
          reviewInputRef={reviewInputRef}
          reviewInputValue={reviewInputValue}
          onReviewInputChange={setReviewInputValue}
        />
        <PhotosPanel photos={photos} />
      </section>
    </main>
  );
}

function StatusTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Smartphone;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-white p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-zinc-500">
        <Icon size={14} />
        {label}
      </div>
      <div className="mt-2 truncate text-sm font-semibold text-zinc-950">{value}</div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="truncate font-medium text-zinc-950">{value}</dd>
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
  return (
    <section className="rounded-[1.35rem] border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Type size={16} />
          Text and barcode
        </h2>
        <span className="text-xs text-zinc-500">{captures.length}</span>
      </div>
      <div className="border-b border-zinc-200 p-3">
        <label htmlFor="review-test-input" className="text-xs font-semibold uppercase text-zinc-500">
          {REVIEW_INPUT_LABEL}
        </label>
        <textarea
          ref={reviewInputRef}
          id="review-test-input"
          value={reviewInputValue}
          onChange={(event) => onReviewInputChange(event.target.value)}
          placeholder="Scanned text, barcodes, and dictation appear here."
          className="mt-2 min-h-24 w-full resize-y rounded-[0.85rem] border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-950 outline-none focus:border-zinc-950"
        />
      </div>
      <div className="max-h-[34rem] overflow-auto p-3">
        {captures.length === 0 ? (
          <EmptyState label="No scanner results yet" />
        ) : (
          <div className="space-y-3">
            {captures.map((capture) => (
              <article key={`${capture.id}:${capture.capturedAt}`} className="rounded-[0.95rem] border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                  <span className="font-medium capitalize text-zinc-700">{capture.kind}</span>
                  <time dateTime={capture.capturedAt}>{new Date(capture.capturedAt).toLocaleTimeString()}</time>
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
  return (
    <section className="rounded-[1.35rem] border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ImageIcon size={16} />
          Photos
        </h2>
        <span className="text-xs text-zinc-500">{photos.length}</span>
      </div>
      <div className="max-h-[34rem] overflow-auto p-3">
        {photos.length === 0 ? (
          <EmptyState label="No photos received yet" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {photos.map((photo) => (
              <article key={photo.id} className="overflow-hidden rounded-[0.95rem] border border-zinc-200 bg-zinc-50">
                <img src={photo.objectUrl} alt={photo.filename} className="aspect-[4/3] w-full bg-zinc-100 object-contain" />
                <div className="space-y-1 p-3 text-xs text-zinc-500">
                  <div className="truncate text-sm font-semibold text-zinc-950">{photo.filename}</div>
                  <div>{formatBytes(photo.size)}</div>
                  {photo.width && photo.height ? <div>{photo.width} x {photo.height}</div> : null}
                  <time dateTime={photo.capturedAt}>{new Date(photo.capturedAt).toLocaleString()}</time>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="grid min-h-40 place-items-center rounded-[0.95rem] border border-dashed border-zinc-300 bg-zinc-50 px-4 text-center text-sm text-zinc-500">
      {label}
    </div>
  );
}
