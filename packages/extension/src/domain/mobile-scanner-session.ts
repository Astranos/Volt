import {
  SCANNER_PROTOCOL_MAJOR_VERSION,
  SCANNER_PROTOCOL_MINOR_VERSION,
  decodeScannerControlMessage,
  encodeScannerControlMessage,
  isScannerProtocolVersionSupported,
  isScannerSessionId,
  scannerControlDuplicateKey,
  type ScannerControlMessage,
} from "../../../scanner-protocol/src";
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
import { type PeerSession, MobileScannerPeerConnections } from "./mobile-scanner-peer-connection";
import { MobileScannerPhotoReceiver } from "./mobile-scanner-photo-receiver";
import {
  type JoinWindow,
  MobileScannerSignalClient,
  parseJson,
} from "./mobile-scanner-signal-client";
import {
  type BarcodeMessage,
  type MobileScannerSessionEvents,
  type MobileScannerSessionState,
  type PhotoMessage,
  type SessionTarget,
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

type SessionTimer = ReturnType<typeof setTimeout>;

const JOIN_WINDOW_TTL_MS = 2 * 60 * 1000;
const HIDDEN_JOIN_ATTEMPT_POLL_GRACE_MS = 60 * 1000;
const JOIN_ATTEMPT_INITIAL_POLL_INTERVAL_MS = 1000;
const JOIN_ATTEMPT_MAX_POLL_INTERVAL_MS = 10 * 1000;
const RECONNECT_POLL_INTERVAL_MS = 5000;

const EXTENSION_PROTOCOL_VERSION = {
  major: SCANNER_PROTOCOL_MAJOR_VERSION,
  minor: SCANNER_PROTOCOL_MINOR_VERSION,
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
  private answerPoll: SessionTimer | null = null;
  private answerPollJoinWindow: JoinWindow | null = null;
  private answerPollDelayMs = JOIN_ATTEMPT_INITIAL_POLL_INTERVAL_MS;
  private hiddenPollingExpiresAt: number | null = null;
  private joinWindow: JoinWindow | null = null;
  private peerPairings = new Map<string, DurablePairingCredential>();
  private reconnectPoll: SessionTimer | null = null;
  private readonly identityReady: Promise<void>;
  private readonly peerConnections: MobileScannerPeerConnections;
  private readonly photoReceiver: MobileScannerPhotoReceiver;
  private readonly signalClient = new MobileScannerSignalClient(JOIN_WINDOW_TTL_MS);
  private seenReconnectRequests = new Set<string>();
  private seenJoinAttempts = new Set<string>();
  private seenControlMessages = new Set<string>();
  private target: SessionTarget | null = null;
  private state: MobileScannerSessionState;

  constructor(private readonly events: MobileScannerSessionEvents) {
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
    void this.refreshDurablePairingRegistrations().catch((error) => {
      this.events.log?.("Failed to refresh scanner pairing registrations", error);
    });
    this.scheduleReconnectPoll(RECONNECT_POLL_INTERVAL_MS);
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
      this.answerPollJoinWindow = joinWindow;
      this.hiddenPollingExpiresAt = null;
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
      this.pollForJoinAttempts();
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
      this.hiddenPollingExpiresAt = Date.now() + HIDDEN_JOIN_ATTEMPT_POLL_GRACE_MS;
      await this.signalClient.revokeJoinWindow(previous).catch((error) => {
        this.events.log?.("Failed to revoke scanner join window", error);
      });
      this.events.log?.("[Volt Scanner Pairing] join window closed", {
        pendingPeers: this.peerConnections.peers.size,
        tokenTail: previous.joinToken.slice(-6),
      });
    }
    this.stopHiddenJoinAttemptPollingIfIdle();
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
    this.answerPollJoinWindow = null;
    this.hiddenPollingExpiresAt = null;
    this.stopJoinAttemptPolling();
    this.seenJoinAttempts.clear();
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
    await this.pollReconnectRequests();
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

  private scheduleReconnectPoll(delayMs: number) {
    if (this.reconnectPoll) return;
    this.reconnectPoll = setTimeout(() => {
      this.reconnectPoll = null;
      void this.pollReconnectRequests()
        .catch((error) => {
          this.events.log?.("Failed to poll scanner reconnect requests", error);
        })
        .finally(() => {
          this.scheduleReconnectPoll(RECONNECT_POLL_INTERVAL_MS);
        });
    }, delayMs);
  }

  private async pollReconnectRequests() {
    await this.identityReady;
    const sessionId = this.state.sessionId;
    if (!isScannerSessionId(sessionId)) {
      this.events.log?.("[Volt Scanner Reconnect] poll skipped: invalid session id", { sessionId });
      return;
    }
    const pairings = await loadDurablePairings();
    const pairingById = new Map(pairings.map((pairing) => [pairing.pairingId, pairing]));
    if (pairingById.size === 0) {
      this.events.log?.("[Volt Scanner Reconnect] poll skipped: no durable pairings", { sessionId });
      return;
    }

    const { response, requests } = await this.signalClient.fetchReconnectRequests(sessionId);
    this.events.log?.("[Volt Scanner Reconnect] reconnect requests fetched", {
      sessionId,
      status: response.status,
      pairingCount: pairingById.size,
    });
    if (!response.ok) return;
    this.events.log?.("[Volt Scanner Reconnect] reconnect requests decoded", {
      sessionId,
      requestCount: requests.length,
    });
    for (const request of requests) {
      const pairing = pairingById.get(request.pairingId);
      if (!pairing) continue;
      const key = `${request.pairingId}:${request.requestId}`;
      if (this.seenReconnectRequests.has(key)) continue;
      this.events.log?.("[Volt Scanner Reconnect] answering reconnect request", {
        sessionId,
        pairingId: request.pairingId,
        requestId: request.requestId,
      });
      await this.answerReconnectRequest(pairing, request.requestId);
      this.seenReconnectRequests.add(key);
    }
  }

  private async answerReconnectRequest(pairing: DurablePairingCredential, requestId: string) {
    const joinWindow = await this.createJoinWindow(this.target);
    this.joinWindow = joinWindow;
    this.answerPollJoinWindow = joinWindow;
    this.hiddenPollingExpiresAt = null;
    this.setState({
      status: this.peerConnections.peers.size > 0 ? "connected" : "waiting",
      qrCodeUrl: joinWindow.qrCodeUrl,
      error: null,
      joinWindowExpiresAt: joinWindow.expiresAt ?? null,
    });
    this.pollForJoinAttempts();

    await this.signalClient.postReconnectJoinWindow(pairing, requestId, joinWindow);
    this.events.log?.("[Volt Scanner Reconnect] join window posted", {
      pairingId: pairing.pairingId,
      requestId,
      sessionId: joinWindow.sessionId,
    });
  }

  private pollForJoinAttempts() {
    this.stopJoinAttemptPolling();
    this.answerPollDelayMs = JOIN_ATTEMPT_INITIAL_POLL_INTERVAL_MS;
    this.scheduleJoinAttemptPoll(0);
  }

  private stopJoinAttemptPolling() {
    if (!this.answerPoll) return;
    clearTimeout(this.answerPoll);
    this.answerPoll = null;
  }

  private shouldContinueJoinAttemptPolling() {
    if (this.joinWindow) return true;
    if (!this.answerPollJoinWindow) return false;
    return this.hiddenPollingExpiresAt === null || this.hiddenPollingExpiresAt > Date.now();
  }

  private scheduleJoinAttemptPoll(delayMs: number) {
    if (!this.shouldContinueJoinAttemptPolling()) {
      this.answerPollJoinWindow = null;
      this.hiddenPollingExpiresAt = null;
      return;
    }
    this.answerPoll = setTimeout(() => {
      this.answerPoll = null;
      void this.fetchJoinAttempts()
        .then((hadActivity) => {
          if (!this.shouldContinueJoinAttemptPolling()) {
            this.answerPollJoinWindow = null;
            this.hiddenPollingExpiresAt = null;
            return;
          }
          this.answerPollDelayMs = hadActivity
            ? JOIN_ATTEMPT_INITIAL_POLL_INTERVAL_MS
            : Math.min(
                Math.ceil(this.answerPollDelayMs * 1.5),
                JOIN_ATTEMPT_MAX_POLL_INTERVAL_MS,
              );
          this.scheduleJoinAttemptPoll(this.answerPollDelayMs);
        })
        .catch((error) => {
          this.events.log?.("Failed to poll scanner join attempts", error);
          this.answerPollDelayMs = JOIN_ATTEMPT_MAX_POLL_INTERVAL_MS;
          this.scheduleJoinAttemptPoll(this.answerPollDelayMs);
        });
    }, delayMs);
  }

  private async fetchJoinAttempts() {
    const joinWindow = this.joinWindow ?? this.answerPollJoinWindow;
    if (!joinWindow) return false;
    let hadActivity = false;
    const acceptingNewAttempts = this.joinWindow?.joinToken === joinWindow.joinToken;
    const attempts = await this.signalClient.fetchJoinAttempts(joinWindow);
    for (const attempt of attempts) {
      if (!this.seenJoinAttempts.has(attempt.joinAttemptId)) {
        if (!acceptingNewAttempts) continue;
        this.seenJoinAttempts.add(attempt.joinAttemptId);
        this.events.log?.("[Volt Scanner Pairing] join attempt seen", {
          joinAttemptId: attempt.joinAttemptId,
        });
        await this.peerConnections.createPeerOffer(joinWindow, attempt.joinAttemptId);
        hadActivity = true;
      }
      if (this.peerConnections.peers.get(attempt.joinAttemptId)?.answerApplied) continue;
      const answer = attempt.answer ?? (attempt.hasAnswer ? await this.signalClient.fetchPeerAnswer(joinWindow, attempt.joinAttemptId) : null);
      if (answer) {
        await this.peerConnections.applyPeerAnswer(attempt.joinAttemptId, answer);
        hadActivity = true;
      }
    }
    this.stopHiddenJoinAttemptPollingIfIdle();
    return hadActivity;
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
      const stored = accepted ? await this.events.onScan(scannerMessage) : true;
      const insertedIntoCursor = shouldInsertScannerMessage(scannerMessage);
      if (insertedIntoCursor) {
        this.events.onInsert?.(scannerMessage.barcode, scannerMessage);
      }
      this.sendControl(peer, {
        type: "result_received",
        messageId: createMessageId("control"),
        sentAt: new Date().toISOString(),
        resultId: control.type === "capture_result" ? control.resultId : control.messageId,
        savedToResults: stored,
        insertedIntoCursor,
      });
    }
  }

  private sendProtocolError(peer: PeerSession, code: "unsupported_protocol" | "invalid_message", receivedType?: string) {
    this.sendControl(peer, {
      type: "protocol_error",
      messageId: createMessageId("control"),
      sentAt: new Date().toISOString(),
      code,
      receivedType,
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
    const peer = this.peerConnections.closePeer(joinAttemptId);
    if (!peer) return;
    this.peerPairings.delete(joinAttemptId);
    this.setState({
      status: this.peerConnections.peers.size > 0 ? "connected" : this.joinWindow ? "waiting" : "disconnected",
      connectedAt: this.peerConnections.peers.size > 0 ? this.state.connectedAt : null,
    });
    this.stopHiddenJoinAttemptPollingIfIdle();
  }

  private stopHiddenJoinAttemptPollingIfIdle() {
    if (this.joinWindow || !this.answerPollJoinWindow) return;
    if (this.hiddenPollingExpiresAt !== null && this.hiddenPollingExpiresAt <= Date.now()) {
      this.answerPollJoinWindow = null;
      this.hiddenPollingExpiresAt = null;
      this.stopJoinAttemptPolling();
      return;
    }
    for (const peer of this.peerConnections.peers.values()) {
      if (!peer.answerApplied) return;
    }
    this.answerPollJoinWindow = null;
    this.hiddenPollingExpiresAt = null;
    this.stopJoinAttemptPolling();
  }
}
