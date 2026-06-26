import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import QRCode from "qrcode";
import {
  CheckCircle2,
  Loader2,
  Radio,
  ScanBarcode,
  Smartphone,
  Trash2,
} from "lucide-react";
import {
  PHOTO_TRANSFER_CHANNEL_LABEL,
  SCANNER_ANSWER_POLL_INTERVAL_MS,
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
  buildScannerAppClipJoinUrl,
} from "@volt/scanner-protocol";

import {
  createRemoteSpeechAudioBridge,
  isRestartableRemoteSpeechError,
  isTransientRemoteSpeechTrackStartError,
  nextReviewInputAfterLiveDictation,
  remoteSpeechErrorDetail,
  WebRemoteSpeechRecognizer,
  type LiveDictationInsertion,
  type RemoteSpeechAudioBridge,
  type RemoteSpeechTranscript,
} from "./-scanner-demo-dictation";
import {
  PairingDialog,
  PhotosPanel,
  ResultsPanel,
  StatusText,
} from "./-scanner-demo-ui";
import { SiteFooter, SiteHeader } from "../site-chrome";

export const Route = createFileRoute("/scanner-demo")({
  component: ScannerDemo,
});

const SIGNAL_URL = scannerSignalUrl();
const DEFAULT_SESSION_LABEL = "Browser session";
const REVIEW_INPUT_LABEL = "Review test input";
const WEB_PROTOCOL_VERSION = {
  major: SCANNER_PROTOCOL_MAJOR_VERSION,
  minor: SCANNER_PROTOCOL_MINOR_VERSION,
};
const REMOTE_SPEECH_START_RETRY_DELAY_MS = 250;
const REMOTE_SPEECH_START_MAX_ATTEMPTS = 20;

export type DemoStatus =
  | "idle"
  | "creating"
  | "waiting"
  | "connecting"
  | "connected"
  | "error";

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

const MAX_CAPTURE_ITEMS = 50;
const MAX_PHOTO_ITEMS = 24;

type PendingPhoto = PhotoTransferStartMessage & {
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

function createId(prefix: string) {
  const random = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${random}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_",
  );
}

function createSecret(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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

function normalizeSessionDescription(
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

function normalizeJoinAttempt(value: unknown): JoinAttempt | null {
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
  const [pairingDialogOpen, setPairingDialogOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [reviewInputValue, setReviewInputValue] = useState("");
  const [sessionLabel, setSessionLabel] = useState(DEFAULT_SESSION_LABEL);
  const [status, setStatus] = useState<DemoStatus>("idle");

  const capturesRef = useRef(new Set<string>());
  const joinWindowRef = useRef<JoinWindow | null>(null);
  const liveDictationInsertionsRef = useRef(
    new Map<string, LiveDictationInsertion>(),
  );
  const objectUrlsRef = useRef(new Set<string>());
  const peersRef = useRef(new Map<string, PeerSession>());
  const pendingPhotosRef = useRef(new Map<string, PendingPhoto>());
  const pollTimerRef = useRef<number | null>(null);
  const remoteAudioBridgesRef = useRef(
    new Map<string, RemoteSpeechAudioBridge>(),
  );
  const remoteAudioTracksRef = useRef(new Map<string, MediaStreamTrack>());
  const remoteDictationSessionIdsRef = useRef(new Map<string, string>());
  const remoteSpeechSinksRef = useRef(new Map<string, HTMLAudioElement>());
  const remoteSpeechStartAttemptsRef = useRef(new Map<string, number>());
  const remoteSpeechStartRetryTimersRef = useRef(new Map<string, number>());
  const remoteSpeechRecognizersRef = useRef(
    new Map<string, WebRemoteSpeechRecognizer>(),
  );
  const reviewInputRef = useRef<HTMLTextAreaElement | null>(null);
  const reviewInputValueRef = useRef("");

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
    for (const recognizer of remoteSpeechRecognizersRef.current.values()) {
      recognizer.stop();
    }
    for (const retryTimer of remoteSpeechStartRetryTimersRef.current.values()) {
      window.clearTimeout(retryTimer);
    }
    for (const bridge of remoteAudioBridgesRef.current.values()) {
      try {
        bridge.source?.disconnect();
      } catch {}
      try {
        bridge.monitorGain?.disconnect();
      } catch {}
      try {
        bridge.destination?.disconnect();
      } catch {}
      for (const track of bridge.stream.getTracks()) {
        if (track !== bridge.track) track.stop();
      }
      bridge.track.stop();
      void bridge.context?.close().catch(() => {});
    }
    for (const sink of remoteSpeechSinksRef.current.values()) {
      sink.srcObject = null;
      sink.remove();
    }
    remoteAudioBridgesRef.current.clear();
    remoteAudioTracksRef.current.clear();
    remoteDictationSessionIdsRef.current.clear();
    remoteSpeechRecognizersRef.current.clear();
    remoteSpeechSinksRef.current.clear();
    remoteSpeechStartAttemptsRef.current.clear();
    remoteSpeechStartRetryTimersRef.current.clear();
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    objectUrlsRef.current.clear();
    joinWindowRef.current = null;
  }, [clearPollTimer]);

  const sendControl = useCallback(
    (peer: PeerSession, message: ScannerControlMessage) => {
      if (peer.control?.readyState !== "open") return;
      peer.control.send(encodeScannerControlMessage(message));
    },
    [],
  );

  const webPeerInfo = useCallback(
    () => ({
      protocolVersion: WEB_PROTOCOL_VERSION,
      platform: "web" as const,
      capabilities: [
        "ocr" as const,
        "barcode" as const,
        "dictation" as const,
        "photo" as const,
      ],
      chromeSessionId:
        joinWindowRef.current?.sessionId ?? createId("web-session"),
      deviceLabel:
        joinWindowRef.current?.label ?? normalizedSessionLabel(sessionLabel),
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
    const current = reviewInputValueRef.current;
    const start = input?.selectionStart ?? current.length;
    const end = input?.selectionEnd ?? current.length;
    const nextValue = input
      ? `${current.slice(0, start)}${value}${current.slice(end)}`
      : current
        ? `${current}\n${value}`
        : value;
    reviewInputValueRef.current = nextValue;
    setReviewInputValue(nextValue);

    window.requestAnimationFrame(() => {
      const inputAfterRender = reviewInputRef.current;
      if (!inputAfterRender) return;
      inputAfterRender.focus();
      const insertionPoint = inputAfterRender.value.length;
      inputAfterRender.setSelectionRange(insertionPoint, insertionPoint);
    });

    return true;
  }, []);

  const replaceLiveDictationInReviewInput = useCallback(
    (message: Extract<ScannerControlMessage, { type: "dictation" }>) => {
      const liveSessionId = message.dictationSessionId;
      if (message.phase === "started" || message.phase === "stopped") {
        liveDictationInsertionsRef.current.delete(liveSessionId);
        return false;
      }

      const value = message.text?.trim();
      if (!value) return false;

      const current = reviewInputValueRef.current;
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
      reviewInputValueRef.current = result.value;
      if (result.insertion) {
        liveDictationInsertionsRef.current.set(
          liveSessionId,
          result.insertion,
        );
      } else {
        liveDictationInsertionsRef.current.delete(liveSessionId);
      }
      setReviewInputValue(result.value);

      window.requestAnimationFrame(() => {
        const inputAfterRender = reviewInputRef.current;
        if (!inputAfterRender) return;
        const liveInsertion =
          liveDictationInsertionsRef.current.get(liveSessionId);
        if (!liveInsertion) return;
        inputAfterRender.focus();
        inputAfterRender.setSelectionRange(
          liveInsertion.end,
          liveInsertion.end,
        );
      });

      return true;
    },
    [],
  );

  const closePeer = useCallback(
    (peerId: string) => {
      const peer = peersRef.current.get(peerId);
      if (!peer) return;
      peersRef.current.delete(peerId);
      remoteSpeechRecognizersRef.current.get(peerId)?.stop();
      remoteSpeechRecognizersRef.current.delete(peerId);
      const retryTimer = remoteSpeechStartRetryTimersRef.current.get(peerId);
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        remoteSpeechStartRetryTimersRef.current.delete(peerId);
      }
      const bridge = remoteAudioBridgesRef.current.get(peerId);
      remoteAudioBridgesRef.current.delete(peerId);
      if (bridge) {
        try {
          bridge.source?.disconnect();
        } catch {}
        try {
          bridge.monitorGain?.disconnect();
        } catch {}
        try {
          bridge.destination?.disconnect();
        } catch {}
        const sourceTrack = remoteAudioTracksRef.current.get(peerId);
        for (const track of bridge.stream.getTracks()) {
          if (track !== sourceTrack) track.stop();
        }
        if (bridge.track !== sourceTrack) {
          bridge.track.stop();
        }
        void bridge.context?.close().catch(() => {});
      }
      const sink = remoteSpeechSinksRef.current.get(peerId);
      remoteSpeechSinksRef.current.delete(peerId);
      if (sink) {
        sink.srcObject = null;
        sink.remove();
      }
      remoteAudioTracksRef.current.delete(peerId);
      remoteDictationSessionIdsRef.current.delete(peerId);
      remoteSpeechStartAttemptsRef.current.delete(peerId);
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
      if (message.type !== "capture_result" && message.type !== "dictation")
        return;
      const duplicateKey = scannerControlDuplicateKey(message);
      if (
        capturesRef.current.has(duplicateKey) &&
        message.type !== "dictation"
      ) {
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
      if (
        message.type === "dictation" &&
        (message.phase === "started" || message.phase === "stopped")
      ) {
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
              kind:
                message.resultKind === "barcode"
                  ? ("barcode" as const)
                  : ("text" as const),
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
          if (message.type !== "dictation")
            return [item, ...current].slice(0, MAX_CAPTURE_ITEMS);
          const withoutSession = current.filter(
            (capture) => capture.id !== item.id,
          );
          return [item, ...withoutSession].slice(0, MAX_CAPTURE_ITEMS);
        });
      }
      const insertedIntoCursor =
        message.type === "dictation"
          ? replaceLiveDictationInReviewInput(message)
          : insertIntoReviewInput(item.value);
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

  const closeRemoteSpeechAudioBridge = useCallback((peerId: string) => {
    const bridge = remoteAudioBridgesRef.current.get(peerId);
    remoteAudioBridgesRef.current.delete(peerId);
    if (!bridge) return;
    try {
      bridge.source?.disconnect();
    } catch {}
    try {
      bridge.monitorGain?.disconnect();
    } catch {}
    try {
      bridge.destination?.disconnect();
    } catch {}
    const sourceTrack = remoteAudioTracksRef.current.get(peerId);
    for (const track of bridge.stream.getTracks()) {
      if (track !== sourceTrack) track.stop();
    }
    if (bridge.track !== sourceTrack) {
      bridge.track.stop();
    }
    void bridge.context?.close().catch(() => {});
  }, []);

  const attachRemoteSpeechSink = useCallback((peerId: string, track: MediaStreamTrack) => {
    const previousSink = remoteSpeechSinksRef.current.get(peerId);
    if (previousSink) {
      previousSink.srcObject = null;
      previousSink.remove();
    }

    const sink = document.createElement("audio");
    sink.autoplay = true;
    sink.muted = true;
    sink.setAttribute("playsinline", "true");
    sink.srcObject = new MediaStream([track]);
    sink.style.display = "none";
    document.body?.appendChild(sink);
    void sink.play().catch(() => {});
    remoteSpeechSinksRef.current.set(peerId, sink);
  }, []);

  const recognitionTrackForRemoteSpeech = useCallback(
    (peerId: string, track: MediaStreamTrack) => {
      const existingBridge = remoteAudioBridgesRef.current.get(peerId);
      if (existingBridge?.track.readyState === "live") return existingBridge.track;
      closeRemoteSpeechAudioBridge(peerId);

      try {
        const bridge = createRemoteSpeechAudioBridge(track);
        if (!bridge) return track;
        remoteAudioBridgesRef.current.set(peerId, bridge);
        return bridge.track;
      } catch (_error) {
        return track;
      }
    },
    [closeRemoteSpeechAudioBridge],
  );

  const handleRemoteSpeechTranscript = useCallback(
    (peer: PeerSession, transcript: RemoteSpeechTranscript) => {
      const dictationSessionId =
        remoteDictationSessionIdsRef.current.get(peer.id) ??
        createMessageId("web-dictation-session");
      remoteDictationSessionIdsRef.current.set(peer.id, dictationSessionId);
      addCapture(peer, {
        type: "dictation",
        messageId: createMessageId("dictation"),
        sentAt: new Date().toISOString(),
        dictationSessionId,
        phase: transcript.phase,
        capturedAt: new Date().toISOString(),
        text: transcript.text,
        insertIntoCursor: true,
      });
    },
    [addCapture],
  );

  const stopRemoteSpeechRecognition = useCallback(
    (peerId: string) => {
      remoteSpeechRecognizersRef.current.get(peerId)?.stop();
      remoteSpeechRecognizersRef.current.delete(peerId);
      remoteDictationSessionIdsRef.current.delete(peerId);
      remoteSpeechStartAttemptsRef.current.delete(peerId);
      const retryTimer = remoteSpeechStartRetryTimersRef.current.get(peerId);
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        remoteSpeechStartRetryTimersRef.current.delete(peerId);
      }
      closeRemoteSpeechAudioBridge(peerId);
    },
    [closeRemoteSpeechAudioBridge],
  );

  const startRemoteSpeechRecognition = useCallback(
    (peer: PeerSession) => {
      if (remoteSpeechRecognizersRef.current.has(peer.id)) return;
      const retryTimer = remoteSpeechStartRetryTimersRef.current.get(peer.id);
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        remoteSpeechStartRetryTimersRef.current.delete(peer.id);
      }
      const track = remoteAudioTracksRef.current.get(peer.id);
      if (!track) {
        setError("Waiting for the App Clip microphone track.");
        return;
      }
      if (track.kind !== "audio" || track.readyState !== "live") {
        setError("Chrome received the App Clip microphone track before it was live. Tap Dictate again.");
        return;
      }
      const recognitionTrack = recognitionTrackForRemoteSpeech(peer.id, track);
      if (recognitionTrack.kind !== "audio" || recognitionTrack.readyState !== "live") {
        setError("Chrome could not prepare the App Clip microphone stream for speech recognition.");
        return;
      }
      const recognizer = new WebRemoteSpeechRecognizer({
        onTranscript: (transcript) =>
          handleRemoteSpeechTranscript(peer, transcript),
        onError: (recognitionError) => {
          if (
            isRestartableRemoteSpeechError(recognitionError) &&
            remoteDictationSessionIdsRef.current.has(peer.id)
          ) {
            return;
          }
          if (
            isTransientRemoteSpeechTrackStartError(recognitionError) &&
            remoteDictationSessionIdsRef.current.has(peer.id)
          ) {
            const attempts = (remoteSpeechStartAttemptsRef.current.get(peer.id) ?? 0) + 1;
            remoteSpeechStartAttemptsRef.current.set(peer.id, attempts);
            if (
              attempts <= REMOTE_SPEECH_START_MAX_ATTEMPTS &&
              !remoteSpeechStartRetryTimersRef.current.has(peer.id)
            ) {
              const nextTimer = window.setTimeout(() => {
                remoteSpeechStartRetryTimersRef.current.delete(peer.id);
                if (remoteDictationSessionIdsRef.current.has(peer.id)) {
                  startRemoteSpeechRecognition(peer);
                }
              }, REMOTE_SPEECH_START_RETRY_DELAY_MS);
              remoteSpeechStartRetryTimersRef.current.set(peer.id, nextTimer);
              return;
            }
          }
          setError(remoteSpeechErrorDetail(recognitionError));
        },
        onEnd: () => {
          remoteSpeechRecognizersRef.current.delete(peer.id);
          if (remoteDictationSessionIdsRef.current.has(peer.id)) {
            window.setTimeout(() => startRemoteSpeechRecognition(peer), 250);
          }
        },
      });
      if (recognizer.start(recognitionTrack)) {
        remoteSpeechStartAttemptsRef.current.delete(peer.id);
        remoteSpeechRecognizersRef.current.set(peer.id, recognizer);
      }
    },
    [handleRemoteSpeechTranscript, recognitionTrackForRemoteSpeech],
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
        setPairingDialogOpen(false);
        sendSessionReady(peer);
        setStatus("connected");
        refreshPeerCount();
        return;
      }
      if (message.type === "dictation" && message.phase === "started") {
        remoteDictationSessionIdsRef.current.set(
          peer.id,
          message.dictationSessionId,
        );
        startRemoteSpeechRecognition(peer);
        addCapture(peer, message);
        return;
      }
      if (message.type === "dictation" && message.phase === "stopped") {
        stopRemoteSpeechRecognition(peer.id);
        addCapture(peer, message);
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
    [
      addCapture,
      closePeer,
      refreshPeerCount,
      sendControl,
      sendSessionReady,
      startRemoteSpeechRecognition,
      stopRemoteSpeechRecognition,
    ],
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
    (
      peer: PeerSession,
      message: PhotoTransferMessage | PhotoTransferBinaryChunkMessage,
    ) => {
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
        if (
          !pending ||
          message.chunkIndex < 0 ||
          message.chunkIndex >= pending.totalChunks
        )
          return;
        if (!pending.chunks[message.chunkIndex]) pending.receivedChunks += 1;
        pending.chunks[message.chunkIndex] =
          typeof message.data === "string"
            ? bytesFromBase64(message.data)
            : message.data;
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
        if (typeof event.data === "string")
          handleControlMessage(peer, event.data);
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
      if (!response.ok)
        throw new Error(`ICE server request failed (${response.status})`);
      const iceServers = normalizeIceResponse(await response.json());
      if (!iceServers) throw new Error("ICE server response was invalid");
      const hasTurn = iceServers.some((server) =>
        (Array.isArray(server.urls) ? server.urls : [server.urls]).some(
          (url) => url.startsWith("turn:") || url.startsWith("turns:"),
        ),
      );
      setIceLabel(hasTurn ? "Cloudflare TURN ready" : "STUN ready");
      return iceServers;
    } catch (_error) {
      setIceLabel("STUN fallback");
      return SCANNER_STUN_ONLY_ICE_SERVERS;
    }
  }, []);

  const postPeerOffer = useCallback(
    async (
      windowState: JoinWindow,
      attemptId: string,
      offer: RTCSessionDescriptionInit,
    ) => {
      const response = await fetch(
        `${SIGNAL_URL}/join-token/${encodeURIComponent(windowState.joinToken)}/attempt/${encodeURIComponent(attemptId)}/offer`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Volt-Browser-Claim": windowState.browserClaim,
          },
          body: JSON.stringify({
            browserClaim: windowState.browserClaim,
            channels: [
              SCANNER_CONTROL_CHANNEL_LABEL,
              PHOTO_TRANSFER_CHANNEL_LABEL,
            ],
            offer: JSON.stringify(offer),
          }),
        },
      );
      if (!response.ok)
        throw new Error(`Failed to post WebRTC offer (${response.status})`);
    },
    [],
  );

  const createPeerOffer = useCallback(
    async (windowState: JoinWindow, attemptId: string) => {
      if (peersRef.current.has(attemptId)) return;
      setStatus("connecting");
      const iceServers = await fetchIceServers();
      const pc = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: "all",
      });
      const peer: PeerSession = {
        answerApplied: false,
        control: null,
        id: attemptId,
        pc,
        photoTransfer: null,
        ready: false,
      };
      peersRef.current.set(attemptId, peer);

      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.ontrack = (event) => {
        if (event.track.kind !== "audio") return;
        remoteAudioTracksRef.current.set(peer.id, event.track);
        attachRemoteSpeechSink(peer.id, event.track);
        event.track.addEventListener(
          "ended",
          () => stopRemoteSpeechRecognition(peer.id),
          { once: true },
        );
        event.track.addEventListener("unmute", () => {
          if (remoteDictationSessionIdsRef.current.has(peer.id)) {
            startRemoteSpeechRecognition(peer);
          }
        });
        if (remoteDictationSessionIdsRef.current.has(peer.id)) {
          startRemoteSpeechRecognition(peer);
        }
      };

      peer.control = pc.createDataChannel(SCANNER_CONTROL_CHANNEL_LABEL, {
        ordered: true,
      });
      peer.photoTransfer = pc.createDataChannel(PHOTO_TRANSFER_CHANNEL_LABEL, {
        ordered: true,
      });
      configureControlChannel(peer, peer.control);
      configurePhotoChannel(peer, peer.photoTransfer);

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "disconnected" ||
          pc.connectionState === "closed"
        ) {
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
      if (!pc.localDescription)
        throw new Error("Failed to create WebRTC offer");
      await postPeerOffer(windowState, attemptId, pc.localDescription);
    },
    [
      closePeer,
      configureControlChannel,
      configurePhotoChannel,
      fetchIceServers,
      postPeerOffer,
      refreshPeerCount,
      attachRemoteSpeechSink,
      startRemoteSpeechRecognition,
      stopRemoteSpeechRecognition,
    ],
  );

  const applyPeerAnswer = useCallback(
    async (attemptId: string, answer: RTCSessionDescriptionInit) => {
      const peer = peersRef.current.get(attemptId);
      if (!peer || peer.answerApplied) return;
      await peer.pc.setRemoteDescription(answer);
      peer.answerApplied = true;
    },
    [],
  );

  const fetchPeerAnswer = useCallback(
    async (windowState: JoinWindow, attemptId: string) => {
      const response = await fetch(
        `${SIGNAL_URL}/join-token/${encodeURIComponent(windowState.joinToken)}/attempt/${encodeURIComponent(attemptId)}/answer`,
        { headers: { "X-Volt-Browser-Claim": windowState.browserClaim } },
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as { answer?: unknown };
      return normalizeSessionDescription(payload.answer);
    },
    [],
  );

  const pollJoinAttempts = useCallback(async () => {
    const windowState = joinWindowRef.current;
    if (!windowState) return;
    try {
      const response = await fetch(
        `${SIGNAL_URL}/join-token/${encodeURIComponent(windowState.joinToken)}/attempts`,
        {
          headers: { "X-Volt-Browser-Claim": windowState.browserClaim },
        },
      );
      if (!response.ok)
        throw new Error(`Join attempt poll failed (${response.status})`);
      const payload = (await response.json()) as {
        attempts?: unknown[];
        joinAttempts?: unknown[];
      };
      const rawAttempts = Array.isArray(payload.attempts)
        ? payload.attempts
        : Array.isArray(payload.joinAttempts)
          ? payload.joinAttempts
          : [];
      const attempts = rawAttempts
        .map(normalizeJoinAttempt)
        .filter((attempt): attempt is JoinAttempt => !!attempt);
      for (const attempt of attempts) {
        if (!peersRef.current.has(attempt.id)) {
          await createPeerOffer(windowState, attempt.id);
        }
        if (peersRef.current.get(attempt.id)?.answerApplied) continue;
        const answer =
          attempt.answer ??
          (attempt.hasAnswer
            ? await fetchPeerAnswer(windowState, attempt.id)
            : null);
        if (answer) await applyPeerAnswer(attempt.id, answer);
      }
    } catch (pollError) {
      setError(
        pollError instanceof Error
          ? pollError.message
          : "Failed to poll join attempts",
      );
    } finally {
      if (joinWindowRef.current) {
        pollTimerRef.current = window.setTimeout(
          () => void pollJoinAttempts(),
          SCANNER_ANSWER_POLL_INTERVAL_MS,
        );
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
    setPairingDialogOpen(false);
    setQrDataUrl(null);
    reviewInputValueRef.current = "";
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
          capabilities: [
            "text",
            "barcode",
            "dictation",
            "photo",
            "photo-chunk-ack",
          ],
          deviceLabel: label,
          role: "browser",
          sessionId,
          transport: "webrtc",
          ttlMs: SCANNER_JOIN_TOKEN_TTL_MS,
          webRtcOnly: true,
        }),
      });
      if (!response.ok)
        throw new Error(`Failed to create join token (${response.status})`);
      const payload = (await response.json()) as Record<string, unknown>;
      const joinToken =
        typeof payload.token === "string" && payload.token
          ? payload.token
          : typeof payload.joinToken === "string" && payload.joinToken
            ? payload.joinToken
            : "";
      if (!joinToken)
        throw new Error("Signal service did not return a join token");
      const returnedSessionId =
        typeof payload.sessionId === "string" && payload.sessionId
          ? payload.sessionId
          : sessionId;
      const qrCodeUrl =
        typeof payload.qrCodeUrl === "string" && payload.qrCodeUrl
          ? payload.qrCodeUrl
          : buildScannerAppClipJoinUrl({
              token: joinToken,
              sessionId: returnedSessionId,
              signalUrl: SIGNAL_URL,
            });
      const nextWindow: JoinWindow = {
        browserClaim,
        expiresAt:
          typeof payload.expiresAt === "string" ? payload.expiresAt : null,
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
      setPairingDialogOpen(true);
      setStatus("waiting");
      pollTimerRef.current = window.setTimeout(
        () => void pollJoinAttempts(),
        0,
      );
    } catch (startError) {
      setStatus("error");
      setError(
        startError instanceof Error
          ? startError.message
          : "Failed to start scanner demo",
      );
    }
  }, [fetchIceServers, pollJoinAttempts, reset, sessionLabel]);

  const handleReviewInputChange = useCallback((value: string) => {
    reviewInputValueRef.current = value;
    setReviewInputValue(value);
  }, []);

  const copyPairingUrl = useCallback(async () => {
    if (!joinWindow?.qrCodeUrl) return;
    await navigator.clipboard.writeText(joinWindow.qrCodeUrl);
  }, [joinWindow?.qrCodeUrl]);

  useEffect(() => {
    if (
      status === "connecting" ||
      status === "connected" ||
      connectedPeerCount > 0
    ) {
      setPairingDialogOpen(false);
    }
  }, [connectedPeerCount, status]);

  useEffect(() => disposeRuntime, [disposeRuntime]);

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <SiteHeader variant="scanner" />

      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="space-y-5">
          <div className="min-w-0 rounded-[1.35rem] border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(28rem,1fr)] lg:items-start">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">
                  Scan to this browser.
                </h1>
                <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-600">
                  No Chrome extension needed. Pair Volt on iPhone with this tab,
                  then copy text results or download photo batches before
                  closing the session.
                </p>
                <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-zinc-500">
                  <StatusText
                    icon={Smartphone}
                    label="Session"
                    value={statusLabel(status)}
                  />
                  <StatusText
                    icon={Radio}
                    label="Connection"
                    value={iceLabel}
                  />
                  <StatusText
                    icon={CheckCircle2}
                    label="Received"
                    value={String(receivedCount)}
                  />
                  {joinWindow?.expiresAt ? (
                    <span className="min-w-0 truncate">
                      Expires{" "}
                      {new Date(joinWindow.expiresAt).toLocaleTimeString()}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="min-w-0">
                <label
                  htmlFor="private-session-label"
                  className="text-sm font-semibold text-zinc-800"
                >
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

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => void startPairing()}
                    disabled={status === "creating" || status === "connecting"}
                    className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-[0.85rem] bg-zinc-950 px-4 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {status === "creating" || status === "connecting" ? (
                      <Loader2 size={17} className="animate-spin" />
                    ) : (
                      <ScanBarcode size={17} />
                    )}
                    <span className="truncate">
                      {joinWindow ? "New session" : "Create session"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={reset}
                    className="inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-[0.85rem] border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:border-zinc-950"
                  >
                    <Trash2 size={17} />
                    <span className="truncate">Reset</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPairingDialogOpen(true)}
                    disabled={!joinWindow?.qrCodeUrl}
                    className="col-span-2 inline-flex h-11 min-w-0 items-center justify-center gap-2 rounded-[0.85rem] border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:border-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-1"
                  >
                    <ScanBarcode size={17} />
                    <span className="truncate">Show QR</span>
                  </button>
                </div>
              </div>
            </div>

            {error ? (
              <div className="mt-4 rounded-[0.95rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            ) : null}

          </div>

          <div className="grid gap-5 lg:grid-cols-[minmax(20rem,0.78fr)_minmax(0,1.22fr)] lg:items-start">
            <div className="min-w-0">
              <ResultsPanel
                captures={captures}
                reviewInputRef={reviewInputRef}
                reviewInputValue={reviewInputValue}
                onReviewInputChange={handleReviewInputChange}
              />
            </div>

            <div className="min-w-0">
              <PhotosPanel photos={photos} />
            </div>
          </div>
        </div>
      </section>
      {pairingDialogOpen ? (
        <PairingDialog
          copyPairingUrl={copyPairingUrl}
          qrDataUrl={qrDataUrl}
          status={status}
          statusLabel={statusLabel}
          onClose={() => setPairingDialogOpen(false)}
        />
      ) : null}
      <SiteFooter />
    </main>
  );
}
