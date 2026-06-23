import {
  SCANNER_PROTOCOL_MAJOR_VERSION,
  SCANNER_PROTOCOL_MINOR_VERSION,
  decodeScannerControlMessage,
  encodeScannerControlMessage,
  isScannerSessionId,
  isScannerProtocolVersionSupported,
  scannerControlDuplicateKey,
  type ScannerControlMessage,
  type ScannerProtocolErrorCode,
} from "@volt/scanner-protocol";
import {
  type DurablePairingCredential,
  type ExtensionIdentity,
  MOBILE_SCANNER_IDENTITY_STORAGE_KEYS,
  getMobileScannerExtensionIdentity,
  getMobileScannerPushSubscription,
  loadDurablePairings,
  saveDurablePairing,
  saveMobileScannerSessionLabel,
} from "./mobile-scanner-identity";
import { createId, createMessageId, createSecret } from "./mobile-scanner-ids";
import { MobileScannerJoinAttemptPoller, MobileScannerReconnectPoller } from "./mobile-scanner-join-attempt-poller";
import { type PeerSession, MobileScannerPeerConnections } from "./mobile-scanner-peer-connection";
import { MobileScannerPhotoReceiver } from "./mobile-scanner-photo-receiver";
import {
  type JoinWindow,
  MobileScannerSignalClient,
  parseJson,
} from "./mobile-scanner-signal-client";
import {
  type BarcodeMessage,
  MobileScannerRemoteSpeechRecognizer,
  type MobileScannerSessionEvents,
  type MobileScannerSessionState,
  type PhotoMessage,
  type SessionTarget,
  createDictationMessageFromSpeechTranscript,
  isRestartableRemoteSpeechError,
  type SpeechRecognitionTranscript,
} from "./mobile-scanner-session-types";
import { shouldInsertScannerMessage } from "./scanner-message";

export {
  MOBILE_SCANNER_IDENTITY_STORAGE_KEYS,
  getMobileScannerExtensionIdentity,
  saveMobileScannerSessionLabel,
  type BarcodeMessage,
  type ExtensionIdentity,
  type MobileScannerSessionEvents,
  type MobileScannerSessionState,
  type PhotoMessage,
  type SessionTarget,
};

const JOIN_WINDOW_TTL_MS = 2 * 60 * 1000;
const REMOTE_SPEECH_START_RETRY_DELAY_MS = 250;
const REMOTE_SPEECH_START_MAX_ATTEMPTS = 20;

const EXTENSION_PROTOCOL_VERSION = {
  major: SCANNER_PROTOCOL_MAJOR_VERSION,
  minor: SCANNER_PROTOCOL_MINOR_VERSION,
};

type RemoteSpeechAudioBridge = {
  context?: AudioContext;
  destination?: MediaStreamAudioDestinationNode;
  monitorGain?: GainNode;
  source?: MediaStreamAudioSourceNode;
  stream: MediaStream;
  track: MediaStreamTrack;
};

function controlMessageType(rawData: string) {
  const parsed = parseJson(rawData);
  if (!parsed || typeof parsed !== "object") return null;
  const type = (parsed as { type?: unknown }).type;
  return typeof type === "string" ? type : null;
}

function protocolVersionFromRawControl(rawData: string) {
  const parsed = parseJson(rawData);
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as { peer?: unknown; protocolVersion?: unknown; version?: unknown };
  if (record.peer && typeof record.peer === "object") {
    return (record.peer as { protocolVersion?: unknown }).protocolVersion ?? null;
  }
  return record.protocolVersion ?? record.version ?? null;
}

function remoteSpeechErrorDetail(error: unknown) {
  const message = remoteSpeechErrorMessage(error);
  const name = remoteSpeechErrorName(error);

  if (error instanceof Error) {
    if (error.message === "speech_recognition_unavailable") {
      return "Chrome speech recognition is not available in this browser context.";
    }
    if (error.message === "speech_recognition_audio_track_start_unavailable") {
      return "Chrome cannot start speech recognition from the App Clip audio stream on this browser version.";
    }
    if (error.message === "speech_recognition_requires_audio_track") {
      return "Chrome did not receive an audio track from the App Clip.";
    }
    if (error.message === "speech_recognition_requires_live_audio_track") {
      return "Chrome received the App Clip microphone track before it was live. Tap Dictate again.";
    }
    if (name === "InvalidStateError" && message.includes("MediaStreamTrack")) {
      return "Chrome received the App Clip microphone track before it was live. Tap Dictate again.";
    }
    return error.message;
  }

  if (name === "InvalidStateError" && message.includes("MediaStreamTrack")) {
    return "Chrome received the App Clip microphone track before it was live. Tap Dictate again.";
  }
  if (message) return message;

  if (error && typeof error === "object" && "error" in error) {
    const value = (error as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) {
      return `Chrome speech recognition failed: ${value}`;
    }
  }

  return "Chrome speech recognition failed to start.";
}

function remoteSpeechErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string") return value;
  }
  return "";
}

function remoteSpeechErrorName(error: unknown) {
  if (error instanceof Error) return error.name;
  if (error && typeof error === "object" && "name" in error) {
    const value = (error as { name?: unknown }).name;
    if (typeof value === "string") return value;
  }
  return "";
}

function isTransientRemoteSpeechTrackStartError(error: unknown) {
  const message = remoteSpeechErrorMessage(error);
  const name = remoteSpeechErrorName(error);
  return name === "InvalidStateError" && message.includes("MediaStreamTrack");
}

function scanFromControlMessage(message: ScannerControlMessage): (BarcodeMessage & { id?: string }) | null {
  if (message.type === "capture_result") {
    return {
      id: message.resultId,
      barcode: message.value,
      format: message.format,
      insertIntoCursor: message.insertIntoCursor,
      kind: message.resultKind,
      scannedAt: message.capturedAt,
    };
  }

  if (message.type !== "dictation") return null;
  if (message.phase !== "partial" && message.phase !== "final") return null;
  if (typeof message.text !== "string" || !message.text) return null;
  return {
    id: message.messageId,
    barcode: message.text,
    dictationPhase: message.phase,
    dictationSessionId: message.dictationSessionId,
    format: "dictation",
    insertIntoCursor: message.insertIntoCursor,
    kind: "text",
    scannedAt: message.capturedAt,
  };
}

export class MobileScannerSession {
  private readonly events: MobileScannerSessionEvents;
  private joinWindow: JoinWindow | null = null;
  private peerPairings = new Map<string, DurablePairingCredential>();
  private readonly joinAttemptPoller: MobileScannerJoinAttemptPoller;
  private readonly identityReady: Promise<void>;
  private readonly peerConnections: MobileScannerPeerConnections;
  private readonly photoReceiver: MobileScannerPhotoReceiver;
  private readonly reconnectPoller: MobileScannerReconnectPoller;
  private readonly signalClient = new MobileScannerSignalClient(JOIN_WINDOW_TTL_MS);
  private readonly remoteSpeechRecognizers = new Map<string, MobileScannerRemoteSpeechRecognizer>();
  private readonly remoteSpeechAudioBridges = new Map<string, RemoteSpeechAudioBridge>();
  private readonly remoteSpeechSessionIds = new Map<string, string>();
  private readonly remoteSpeechTracks = new Map<string, MediaStreamTrack>();
  private readonly remoteSpeechSinks = new Map<string, HTMLAudioElement>();
  private readonly pendingRemoteSpeechStarts = new Set<string>();
  private readonly remoteSpeechStartAttempts = new Map<string, number>();
  private readonly remoteSpeechStartRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private seenControlMessages = new Set<string>();
  private target: SessionTarget | null = null;
  private state: MobileScannerSessionState;

  constructor(events: MobileScannerSessionEvents) {
    this.events = events;
    this.state = {
      status: "disconnected",
      qrCodeUrl: null,
      error: null,
      connectedAt: null,
      connectedPeerCount: 0,
      joinWindowExpiresAt: null,
      sessionId: createId("global-session"),
      target: null,
      extensionIdentity: null,
    };
    this.peerConnections = new MobileScannerPeerConnections(this.signalClient, {
      configureControlChannel: (peer, channel) => this.configureControlChannel(peer, channel),
      configurePhotoChannel: (peer, channel) => this.configurePhotoChannel(peer, channel),
      onPeerConnected: () => this.handlePeerConnected(),
      onPeerDisconnected: (peer) => this.closePeer(peer.id),
      onRemoteAudioTrack: (peer, track) => this.handleRemoteAudioTrack(peer, track),
      log: (...args) => this.events.log?.(...args),
    });
    this.joinAttemptPoller = new MobileScannerJoinAttemptPoller({
      getActiveJoinWindow: () => this.joinWindow,
      peerConnections: this.peerConnections,
      signalClient: this.signalClient,
      log: (...args) => this.events.log?.(...args),
    });
    this.photoReceiver = new MobileScannerPhotoReceiver({
      onPhoto: (message) => this.events.onPhoto(message),
      sendControl: (peer, message) => this.sendControl(peer, message),
    });
    this.identityReady = this.refreshExtensionIdentity().then(
      () => {},
      (error) => {
        this.events.log?.("Failed to load scanner extension identity", error);
      },
    );
    this.reconnectPoller = new MobileScannerReconnectPoller({
      createReconnectJoinWindow: (pairing, requestId) => this.openReconnectJoinWindow(pairing, requestId),
      getDurablePairings: () => loadDurablePairings(),
      getSessionId: () => this.state.sessionId,
      identityReady: this.identityReady,
      signalClient: this.signalClient,
      log: (...args) => this.events.log?.(...args),
    });
    void this.refreshDurablePairingRegistrations().catch((error) => {
      this.events.log?.("Failed to refresh scanner pairing registrations", error);
    });
    this.reconnectPoller.start();
  }

  getState() {
    return { ...this.state };
  }

  async openJoinWindow(target?: SessionTarget | null) {
    this.target = target ?? this.target;
    this.setState({ status: this.peerConnections.peers.size > 0 ? "connected" : "creating", error: null, target: this.target });
    try {
      const extensionIdentity = await this.refreshExtensionIdentity();
      const joinWindow = await this.createJoinWindow(target);
      this.joinWindow = joinWindow;
      this.events.log?.("[Volt Scanner Pairing] join window opened", {
        sessionId: joinWindow.sessionId,
        tokenTail: joinWindow.joinToken.slice(-6),
      });
      this.setState({
        status: this.peerConnections.peers.size > 0 ? "connected" : "waiting",
        qrCodeUrl: joinWindow.qrCodeUrl,
        error: null,
        joinWindowExpiresAt: joinWindow.expiresAt ?? null,
        extensionIdentity,
      });
      this.joinAttemptPoller.start(joinWindow);
    } catch (err) {
      this.setState({
        status: this.peerConnections.peers.size > 0 ? "connected" : "error",
        error: err instanceof Error ? err.message : "Failed to open scanner join window",
        qrCodeUrl: null,
        joinWindowExpiresAt: null,
      });
    }
    return this.getState();
  }

  async closeJoinWindow() {
    const previous = this.joinWindow;
    this.joinWindow = null;
    if (previous) {
      this.joinAttemptPoller.continueHiddenPollingFor(previous);
      await this.signalClient.revokeJoinWindow(previous).catch((error) => {
        this.events.log?.("Failed to revoke scanner join window", error);
      });
      this.events.log?.("[Volt Scanner Pairing] join window closed", {
        pendingPeers: this.peerConnections.peers.size,
        tokenTail: previous.joinToken.slice(-6),
      });
    }
    this.joinAttemptPoller.stopIfIdle();
    this.setState({
      status: this.peerConnections.peers.size > 0 ? "connected" : "disconnected",
      qrCodeUrl: null,
      joinWindowExpiresAt: null,
      error: null,
    });
    return this.getState();
  }

  async disconnect() {
    await this.closeJoinWindow();
    for (const peer of Array.from(this.peerConnections.peers.values())) {
      this.closePeer(peer.id);
    }
    this.peerConnections.peers.clear();
    this.photoReceiver.clear();
    this.joinAttemptPoller.clear();
    this.setState({
      status: "disconnected",
      qrCodeUrl: null,
      error: null,
      connectedAt: null,
      connectedPeerCount: 0,
    });
    return this.getState();
  }

  async updateTarget(target?: SessionTarget | null) {
    this.target = target ?? null;
    this.setState({ target: this.target });
    for (const peer of this.peerConnections.peers.values()) {
      if (peer.ready) {
        this.sendSessionReady(peer);
      }
    }
    return this.getState();
  }

  async updateExtensionIdentity(identity?: ExtensionIdentity | null) {
    const nextIdentity = identity ?? await getMobileScannerExtensionIdentity();
    this.state.sessionId = nextIdentity.installId;
    this.setState({ extensionIdentity: nextIdentity });
    for (const peer of this.peerConnections.peers.values()) {
      if (peer.ready) {
        this.sendSessionReady(peer);
      }
    }
    return this.getState();
  }

  async pollReconnectRequestsNow() {
    await this.reconnectPoller.pollNow();
    return this.getState();
  }

  private setState(patch: Partial<MobileScannerSessionState>) {
    this.state = {
      ...this.state,
      ...patch,
      connectedPeerCount: this.peerConnections.countConnectedPeers(),
    };
    this.events.onState(this.getState());
  }

  private async refreshExtensionIdentity() {
    const extensionIdentity = await getMobileScannerExtensionIdentity();
    this.state.sessionId = extensionIdentity.installId;
    this.setState({ extensionIdentity });
    return extensionIdentity;
  }

  private async createJoinWindow(target?: SessionTarget | null): Promise<JoinWindow> {
    const sessionId = isScannerSessionId(this.state.sessionId) ? this.state.sessionId : createId("global-session");
    const joinWindow = await this.signalClient.createJoinWindow({
      sessionId,
      target,
      deviceLabel: this.state.extensionIdentity?.sessionLabel,
    });
    this.state.sessionId = joinWindow.sessionId;
    return joinWindow;
  }

  private cursorTargetSummary() {
    if (!this.target) return undefined;
    return {
      tabTitle: this.target.tabTitle,
      url: this.target.url,
      label: this.target.cursor,
      hasCursorTarget: Boolean(this.target.cursor),
    };
  }

  private sendSessionReady(peer: PeerSession) {
    const identity = this.state.extensionIdentity;
    const pairing = this.ensurePairingForPeer(peer);
    this.sendControl(peer, {
      type: "session_ready",
      messageId: createMessageId("control"),
      sentAt: new Date().toISOString(),
      peer: {
        protocolVersion: EXTENSION_PROTOCOL_VERSION,
        extensionVersion: "1.0.35",
        platform: "chrome_extension",
        capabilities: ["ocr", "barcode", "dictation", "photo", "cursor_insert", "sidepanel_results"],
        chromeSessionId: this.state.sessionId,
        deviceLabel: identity?.sessionLabel,
      },
      pairing: {
        pairingId: pairing.pairingId,
        pairingSecret: pairing.pairingSecret,
        browserSessionId: pairing.browserSessionId,
        displayName: pairing.displayName,
      },
      cursorTarget: this.cursorTargetSummary(),
    });
  }

  private ensurePairingForPeer(peer: PeerSession) {
    const existing = this.peerPairings.get(peer.id);
    if (existing) return existing;

    const now = new Date().toISOString();
    const displayName = this.state.extensionIdentity?.sessionLabel ?? "Chrome session";
    const pairing: DurablePairingCredential = {
      pairingId: createId("pairing").replace(/[^a-zA-Z0-9_-]/g, "_"),
      pairingSecret: createSecret(32),
      browserSessionId: this.state.sessionId,
      displayName,
      createdAt: now,
      lastConnectedAt: now,
    };
    this.peerPairings.set(peer.id, pairing);
    void saveDurablePairing(pairing).catch((error) => {
      this.events.log?.("Failed to save scanner pairing", error);
    });
    void this.registerPairing(pairing).catch((error) => {
      this.events.log?.("Failed to register scanner pairing", error);
    });
    return pairing;
  }

  private async refreshDurablePairingRegistrations() {
    await this.identityReady;
    const pairings = await loadDurablePairings();
    if (pairings.length === 0) return;
    const pushSubscription = await getMobileScannerPushSubscription();
    await Promise.all(
      pairings.map((pairing) =>
        this.registerPairing(pairing, pushSubscription).catch((error) => {
          this.events.log?.("Failed to refresh scanner pairing registration", error);
        }),
      ),
    );
  }

  private async registerPairing(pairing: DurablePairingCredential, pushSubscription?: Awaited<ReturnType<typeof getMobileScannerPushSubscription>>) {
    const subscription = pushSubscription ?? await getMobileScannerPushSubscription();
    await this.signalClient.registerPairing(pairing, subscription);
  }

  private async openReconnectJoinWindow(_pairing: DurablePairingCredential, _requestId: string) {
    const joinWindow = await this.createJoinWindow(this.target);
    this.joinWindow = joinWindow;
    this.setState({
      status: this.peerConnections.peers.size > 0 ? "connected" : "waiting",
      qrCodeUrl: joinWindow.qrCodeUrl,
      error: null,
      joinWindowExpiresAt: joinWindow.expiresAt ?? null,
    });
    this.joinAttemptPoller.start(joinWindow);
    return joinWindow;
  }

  private configureControlChannel(peer: PeerSession, channel: RTCDataChannel) {
    channel.onopen = () => {
      this.events.log?.("[Volt Scanner Pairing] control channel open", { joinAttemptId: peer.id });
      this.sendControl(peer, {
        type: "hello",
        messageId: createMessageId("control"),
        sentAt: new Date().toISOString(),
        peer: {
          protocolVersion: EXTENSION_PROTOCOL_VERSION,
          extensionVersion: "1.0.35",
          platform: "chrome_extension",
          capabilities: ["ocr", "barcode", "dictation", "photo", "cursor_insert", "sidepanel_results"],
          chromeSessionId: this.state.sessionId,
          deviceLabel: this.state.extensionIdentity?.sessionLabel,
        },
      });
    };
    channel.onclose = () => {
      this.events.log?.("[Volt Scanner Pairing] control channel closed", { joinAttemptId: peer.id });
      this.closePeer(peer.id);
    };
    channel.onerror = () => {
      this.events.log?.("[Volt Scanner Pairing] control channel error", { joinAttemptId: peer.id });
      this.sendProtocolError(peer, "invalid_message");
      this.closePeer(peer.id);
    };
    channel.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      void this.handleControlMessage(peer, event.data).catch((error) => {
        this.events.log?.("Failed to handle scanner control message", error);
      });
    };
  }

  private configurePhotoChannel(peer: PeerSession, channel: RTCDataChannel) {
    channel.binaryType = "arraybuffer";
    channel.onmessage = (event) => {
      void this.photoReceiver.handlePhotoTransferMessage(peer, event.data).catch((error) => {
        this.events.log?.("Failed to handle scanner photo message", error);
      });
    };
  }

  private async handleControlMessage(peer: PeerSession, rawData: string) {
    const type = controlMessageType(rawData);
    this.events.log?.("[Volt Scanner Pairing] control message received", {
      joinAttemptId: peer.id,
      type,
    });

    const control = decodeScannerControlMessage(rawData);
    if (!control) {
      if (type === "hello" && !isScannerProtocolVersionSupported(protocolVersionFromRawControl(rawData))) {
        this.sendProtocolError(peer, "unsupported_protocol", type);
        this.closePeer(peer.id);
        return;
      }
      if (type) return;
      this.sendProtocolError(peer, "invalid_message");
      return;
    }

    if (control.type === "hello") {
      peer.ready = true;
      this.sendSessionReady(peer);
      this.events.log?.("[Volt Scanner Pairing] session_ready sent", { joinAttemptId: peer.id });
      this.handlePeerConnected();
      void this.closeJoinWindow();
      return;
    }

    if (control.type === "session_closed") {
      this.closePeer(peer.id);
      return;
    }

    if (control.type === "dictation" && control.phase === "started") {
      this.pendingRemoteSpeechStarts.add(peer.id);
      this.remoteSpeechStartAttempts.set(peer.id, 0);
      this.remoteSpeechSessionIds.set(peer.id, control.dictationSessionId);
      this.startRemoteSpeechRecognition(peer);
      return;
    }

    if (control.type === "dictation" && control.phase === "stopped") {
      this.pendingRemoteSpeechStarts.delete(peer.id);
      this.stopRemoteSpeechRecognition(peer.id);
      return;
    }

    if (
      control.type === "result_received" ||
      control.type === "photo_chunk_ack" ||
      control.type === "photo_received" ||
      control.type === "photo_rejected" ||
      control.type === "protocol_error" ||
      control.type === "mode_changed" ||
      control.type === "session_ready"
    ) {
      return;
    }

    const scannerMessage = scanFromControlMessage(control);
    if (scannerMessage) {
      const duplicateKey = scannerControlDuplicateKey(control);
      const accepted = scannerMessage.format === "dictation" || !this.seenControlMessages.has(duplicateKey);
      if (accepted) this.seenControlMessages.add(duplicateKey);
      const receipt = accepted
        ? await this.deliverScannerMessage(scannerMessage)
        : { stored: true, insertedIntoCursor: false };
      this.sendControl(peer, {
        type: "result_received",
        messageId: createMessageId("control"),
        sentAt: new Date().toISOString(),
        resultId: control.type === "capture_result" ? control.resultId : control.messageId,
        savedToResults: receipt.stored,
        insertedIntoCursor: receipt.insertedIntoCursor,
      });
    }
  }

  private handleRemoteAudioTrack(peer: PeerSession, track: MediaStreamTrack) {
    if (track.kind !== "audio") {
      this.events.log?.("[Volt Scanner Pairing] ignoring non-audio remote track", {
        joinAttemptId: peer.id,
        kind: track.kind,
      });
      return;
    }
    this.remoteSpeechTracks.set(peer.id, track);
    this.attachRemoteSpeechSink(peer.id, track);
    track.addEventListener("ended", () => this.stopRemoteSpeechRecognition(peer.id), { once: true });
    track.addEventListener("unmute", () => {
      if (this.pendingRemoteSpeechStarts.has(peer.id)) {
        this.startRemoteSpeechRecognition(peer);
      }
    });
    if (this.pendingRemoteSpeechStarts.has(peer.id)) {
      this.startRemoteSpeechRecognition(peer);
    }
  }

  private attachRemoteSpeechSink(joinAttemptId: string, track: MediaStreamTrack) {
    if (typeof document === "undefined" || typeof MediaStream === "undefined") return;
    const previousSink = this.remoteSpeechSinks.get(joinAttemptId);
    if (previousSink) {
      previousSink.remove();
    }

    const sink = document.createElement("audio");
    sink.autoplay = true;
    sink.muted = true;
    sink.setAttribute("playsinline", "true");
    sink.srcObject = new MediaStream([track]);
    sink.style.display = "none";
    document.body?.appendChild(sink);
    void sink.play().catch((error) => {
      this.events.log?.("[Volt Scanner Pairing] remote speech sink play failed", {
        joinAttemptId,
        error: error instanceof Error ? error.message : error,
      });
    });
    this.remoteSpeechSinks.set(joinAttemptId, sink);
  }

  private remoteSpeechTrackForRecognition(joinAttemptId: string, track: MediaStreamTrack) {
    const existingBridge = this.remoteSpeechAudioBridges.get(joinAttemptId);
    if (existingBridge?.track.readyState === "live") return existingBridge.track;
    this.closeRemoteSpeechAudioBridge(joinAttemptId);

    if (typeof MediaStream === "undefined") return track;
    const AudioContextCtor =
      globalThis.AudioContext ??
      (globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return track;

    try {
      const stream = new MediaStream([track]);
      const context = new AudioContextCtor();
      const source = context.createMediaStreamSource(stream);
      const destination = context.createMediaStreamDestination();
      const monitorGain = context.createGain();
      monitorGain.gain.value = 0.001;
      source.connect(destination);
      source.connect(monitorGain);
      monitorGain.connect(context.destination);
      void context.resume?.().catch(() => {});
      const speechTrack = destination.stream.getAudioTracks()[0];
      if (!speechTrack) {
        void context.close().catch(() => {});
        return track;
      }
      this.remoteSpeechAudioBridges.set(joinAttemptId, {
        context,
        destination,
        monitorGain,
        source,
        stream,
        track: speechTrack,
      });
      this.events.log?.("[Volt Scanner Pairing] bridged remote audio track for Chrome speech", {
        joinAttemptId,
        contextState: context.state,
        readyState: speechTrack.readyState,
      });
      return speechTrack;
    } catch (error) {
      this.events.log?.("[Volt Scanner Pairing] remote speech audio bridge failed", {
        joinAttemptId,
        error: error instanceof Error ? error.message : error,
      });
      return track;
    }
  }

  private closeRemoteSpeechAudioBridge(joinAttemptId: string) {
    const bridge = this.remoteSpeechAudioBridges.get(joinAttemptId);
    this.remoteSpeechAudioBridges.delete(joinAttemptId);
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
    for (const track of bridge.stream.getTracks()) {
      if (track !== this.remoteSpeechTracks.get(joinAttemptId)) track.stop();
    }
    if (bridge.track !== this.remoteSpeechTracks.get(joinAttemptId)) {
      bridge.track.stop();
    }
    void bridge.context?.close().catch(() => {});
  }

  private startRemoteSpeechRecognition(peer: PeerSession) {
    if (this.remoteSpeechRecognizers.has(peer.id)) return;
    const retryTimer = this.remoteSpeechStartRetryTimers.get(peer.id);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this.remoteSpeechStartRetryTimers.delete(peer.id);
    }
    const track = this.remoteSpeechTracks.get(peer.id);
    if (!track) {
      this.events.log?.("[Volt Scanner Pairing] remote speech track unavailable", { joinAttemptId: peer.id });
      return;
    }
    if (track.kind !== "audio") {
      this.events.log?.("[Volt Scanner Pairing] remote speech track is not audio", {
        joinAttemptId: peer.id,
        kind: track.kind,
      });
      this.sendProtocolError(peer, "invalid_state", undefined, "Chrome did not receive an audio track from the App Clip.");
      return;
    }
    if (track.readyState !== "live") {
      this.events.log?.("[Volt Scanner Pairing] remote speech track is not live", {
        joinAttemptId: peer.id,
        readyState: track.readyState,
      });
      this.sendProtocolError(
        peer,
        "invalid_state",
        undefined,
        "Chrome received the App Clip microphone track before it was live. Tap Dictate again.",
      );
      return;
    }
    const recognitionTrack = this.remoteSpeechTrackForRecognition(peer.id, track);
    if (recognitionTrack.kind !== "audio" || recognitionTrack.readyState !== "live") {
      this.events.log?.("[Volt Scanner Pairing] remote speech bridge track is not usable", {
        joinAttemptId: peer.id,
        kind: recognitionTrack.kind,
        readyState: recognitionTrack.readyState,
      });
      this.sendProtocolError(
        peer,
        "invalid_state",
        undefined,
        "Chrome could not prepare the App Clip microphone stream for speech recognition.",
      );
      return;
    }

    const recognizer = new MobileScannerRemoteSpeechRecognizer({
      onTranscript: (transcript) => {
        void this.handleRemoteSpeechTranscript(peer, transcript).catch((error) => {
          this.events.log?.("Failed to handle scanner remote speech transcript", error);
        });
      },
      onError: (error) => {
        this.events.log?.("[Volt Scanner Pairing] remote speech recognition unavailable", {
          joinAttemptId: peer.id,
          error,
        });
        if (isRestartableRemoteSpeechError(error) && this.pendingRemoteSpeechStarts.has(peer.id)) {
          this.events.log?.("[Volt Scanner Pairing] keeping remote speech active after empty input", {
            joinAttemptId: peer.id,
            error: remoteSpeechErrorDetail(error),
          });
          return;
        }
        if (isTransientRemoteSpeechTrackStartError(error) && this.scheduleRemoteSpeechStartRetry(peer, error)) {
          return;
        }
        this.sendProtocolError(peer, "invalid_state", undefined, remoteSpeechErrorDetail(error));
      },
      onEnd: () => {
        this.remoteSpeechRecognizers.delete(peer.id);
        if (this.pendingRemoteSpeechStarts.has(peer.id)) {
          setTimeout(() => this.startRemoteSpeechRecognition(peer), 250);
        }
      },
    });
    const started = recognizer.start(recognitionTrack);
    if (!started) return;
    this.remoteSpeechStartAttempts.delete(peer.id);
    this.remoteSpeechRecognizers.set(peer.id, recognizer);
  }

  private scheduleRemoteSpeechStartRetry(peer: PeerSession, error: unknown) {
    if (!this.pendingRemoteSpeechStarts.has(peer.id)) return false;
    const attempts = (this.remoteSpeechStartAttempts.get(peer.id) ?? 0) + 1;
    this.remoteSpeechStartAttempts.set(peer.id, attempts);
    if (attempts > REMOTE_SPEECH_START_MAX_ATTEMPTS) {
      this.remoteSpeechStartAttempts.delete(peer.id);
      return false;
    }
    if (this.remoteSpeechStartRetryTimers.has(peer.id)) return true;

    this.events.log?.("[Volt Scanner Pairing] retrying remote speech start after transient track state", {
      joinAttemptId: peer.id,
      attempts,
      error: remoteSpeechErrorDetail(error),
    });
    const retryTimer = setTimeout(() => {
      this.remoteSpeechStartRetryTimers.delete(peer.id);
      if (this.pendingRemoteSpeechStarts.has(peer.id)) {
        this.startRemoteSpeechRecognition(peer);
      }
    }, REMOTE_SPEECH_START_RETRY_DELAY_MS);
    this.remoteSpeechStartRetryTimers.set(peer.id, retryTimer);
    return true;
  }

  private async handleRemoteSpeechTranscript(peer: PeerSession, transcript: SpeechRecognitionTranscript) {
    const existingSessionId = this.remoteSpeechSessionIds.get(peer.id);
    const dictationSessionId = existingSessionId ?? createId("dictation-session");
    this.remoteSpeechSessionIds.set(peer.id, dictationSessionId);

    const message = createDictationMessageFromSpeechTranscript({
      dictationSessionId,
      messageId: createMessageId("dictation"),
      phase: transcript.phase,
      text: transcript.text,
    });
    const receipt = await this.deliverScannerMessage(message);
    this.sendControl(peer, {
      type: "result_received",
      messageId: createMessageId("control"),
      sentAt: new Date().toISOString(),
      resultId: message.id ?? createMessageId("dictation"),
      savedToResults: receipt.stored,
      insertedIntoCursor: receipt.insertedIntoCursor,
    });
    this.sendControl(peer, {
      type: "dictation",
      messageId: createMessageId("control"),
      sentAt: new Date().toISOString(),
      dictationSessionId,
      phase: transcript.phase,
      capturedAt: message.scannedAt ?? new Date().toISOString(),
      text: transcript.text,
      insertIntoCursor: true,
    });
  }

  private async deliverScannerMessage(scannerMessage: BarcodeMessage) {
    const scanReceipt = await this.events.onScan(scannerMessage);
    const stored = typeof scanReceipt === "object" ? scanReceipt.saved : scanReceipt;
    let insertedIntoCursor =
      typeof scanReceipt === "object" && typeof scanReceipt.insertedIntoCursor === "boolean"
        ? scanReceipt.insertedIntoCursor
        : false;
    if (typeof scanReceipt !== "object" && shouldInsertScannerMessage(scannerMessage)) {
      insertedIntoCursor = (await this.events.onInsert?.(scannerMessage.barcode, scannerMessage)) === true;
    }
    return { stored, insertedIntoCursor };
  }

  private sendProtocolError(
    peer: PeerSession,
    code: ScannerProtocolErrorCode,
    receivedType?: string,
    detail?: string,
  ) {
    this.sendControl(peer, {
      type: "protocol_error",
      messageId: createMessageId("control"),
      sentAt: new Date().toISOString(),
      code,
      receivedType,
      detail,
    });
  }

  private sendControl(peer: PeerSession, message: ScannerControlMessage) {
    if (peer.control?.readyState !== "open") return;
    peer.control.send(encodeScannerControlMessage(message));
  }

  private handlePeerConnected() {
    this.setState({ status: "connected", error: null, connectedAt: this.state.connectedAt ?? new Date().toISOString() });
    void this.closeJoinWindow();
  }

  private closePeer(joinAttemptId: string) {
    this.stopRemoteSpeechRecognition(joinAttemptId);
    this.remoteSpeechTracks.delete(joinAttemptId);
    this.closeRemoteSpeechAudioBridge(joinAttemptId);
    const sink = this.remoteSpeechSinks.get(joinAttemptId);
    this.remoteSpeechSinks.delete(joinAttemptId);
    if (sink) {
      sink.srcObject = null;
      sink.remove();
    }
    const peer = this.peerConnections.closePeer(joinAttemptId);
    if (!peer) return;
    this.peerPairings.delete(joinAttemptId);
    this.setState({
      status: this.peerConnections.peers.size > 0 ? "connected" : this.joinWindow ? "waiting" : "disconnected",
      connectedAt: this.peerConnections.peers.size > 0 ? this.state.connectedAt : null,
    });
    this.joinAttemptPoller.stopIfIdle();
  }

  private stopRemoteSpeechRecognition(joinAttemptId: string) {
    const recognizer = this.remoteSpeechRecognizers.get(joinAttemptId);
    this.remoteSpeechRecognizers.delete(joinAttemptId);
    this.remoteSpeechSessionIds.delete(joinAttemptId);
    this.pendingRemoteSpeechStarts.delete(joinAttemptId);
    this.remoteSpeechStartAttempts.delete(joinAttemptId);
    const retryTimer = this.remoteSpeechStartRetryTimers.get(joinAttemptId);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this.remoteSpeechStartRetryTimers.delete(joinAttemptId);
    }
    this.closeRemoteSpeechAudioBridge(joinAttemptId);
    recognizer?.stop();
  }
}
