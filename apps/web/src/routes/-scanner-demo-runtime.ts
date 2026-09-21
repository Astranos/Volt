import { useScannerReviewInput } from "./-scanner-demo-review-input";
import { usePhotoReceiver } from "./-scanner-demo-photos";
import type { PhotoCollection } from "./-scanner-demo-photo-collection";
import { scheduleRecognitionRestart } from "./-scanner-demo-restart";
import {
  SIGNAL_URL,
  DEFAULT_SESSION_LABEL,
  WEB_PROTOCOL_VERSION,
  REMOTE_SPEECH_START_RETRY_DELAY_MS,
  REMOTE_SPEECH_START_MAX_ATTEMPTS,
  type DemoStatus,
  type JoinWindow,
  type JoinAttempt,
  type PeerSession,
  type CaptureItem,
  MAX_CAPTURE_ITEMS,
  type PendingPhoto,
  createId,
  createSecret,
  createMessageId,
  normalizedSessionLabel,
  normalizeSessionDescription,
  normalizeJoinAttempt,
  normalizeIceResponse,
  waitForIceGathering,
  reviewCursorTarget,
} from "./-scanner-demo-model";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  PHOTO_TRANSFER_CHANNEL_LABEL,
  SCANNER_ANSWER_POLL_INTERVAL_MS,
  SCANNER_CONTROL_CHANNEL_LABEL,
  SCANNER_JOIN_TOKEN_TTL_MS,
  SCANNER_STUN_ONLY_ICE_SERVERS,
  decodeScannerControlMessage,
  encodeScannerControlMessage,
  scannerControlDuplicateKey,
  type ScannerControlMessage,
  buildScannerAppClipJoinUrl,
} from "@volt/scanner-protocol";

import {
  createRemoteSpeechAudioBridge,
  isRestartableRemoteSpeechError,
  isTransientRemoteSpeechTrackStartError,
  remoteSpeechErrorDetail,
  WebRemoteSpeechRecognizer,
  type RemoteSpeechAudioBridge,
  type RemoteSpeechTranscript,
} from "./-scanner-demo-dictation";

export function useScannerDemoRuntime() {
  const {
    reviewInputValue, reviewInputRef, handleReviewInputChange,
    insertIntoReviewInput, replaceLiveDictationInReviewInput,
    clearDictationInsertions,
  } = useScannerReviewInput();
  const [captures, setCaptures] = useState<CaptureItem[]>([]);
  const [connectedPeerCount, setConnectedPeerCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [iceLabel, setIceLabel] = useState("Not fetched");
  const [joinWindow, setJoinWindow] = useState<JoinWindow | null>(null);
  const [photoCollection, setPhotoCollection] = useState<PhotoCollection>({ items: [], retiredUrls: [] });
  const photos = photoCollection.items;
  const [pairingDialogOpen, setPairingDialogOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState(DEFAULT_SESSION_LABEL);
  const [status, setStatus] = useState<DemoStatus>("idle");

  const capturesRef = useRef(new Set<string>());
  const joinWindowRef = useRef<JoinWindow | null>(null);
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
    clearDictationInsertions();
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
  }, [clearPollTimer, clearDictationInsertions]);

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
          const sessionId = remoteDictationSessionIdsRef.current.get(peer.id);
          scheduleRecognitionRestart({
            timers: remoteSpeechStartRetryTimersRef.current,
            peerId: peer.id,
            isActive: () => sessionId !== undefined
              && remoteDictationSessionIdsRef.current.get(peer.id) === sessionId
              && peersRef.current.get(peer.id) === peer,
            restart: () => startRemoteSpeechRecognition(peer),
            delay: REMOTE_SPEECH_START_RETRY_DELAY_MS,
          });
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

  const configurePhotoChannel = usePhotoReceiver({ pendingPhotosRef, objectUrlsRef, collection: photoCollection, setCollection: setPhotoCollection, sendControl });

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
    setPhotoCollection({ items: [], retiredUrls: [] });
    setPairingDialogOpen(false);
    setQrDataUrl(null);
    handleReviewInputChange("");
    setStatus("idle");
  }, [disposeRuntime, handleReviewInputChange]);

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

  return {
    captures,
    photos,
    reviewInputRef,
    reviewInputValue,
    handleReviewInputChange,
    pairingDialogOpen,
    copyPairingUrl,
    qrDataUrl,
    status,
    setPairingDialogOpen,
    iceLabel,
    receivedCount,
    joinWindow,
    sessionLabel,
    setSessionLabel,
    startPairing,
    reset,
    error,
  };
}
