import {
  SCANNER_APP_PAIR_URL,
  SCANNER_ICE_GATHERING_TIMEOUT_MS,
  SCANNER_ICE_SERVERS,
  SCANNER_RESULT_POLL_INTERVAL_MS,
  SCANNER_SIGNAL_URL,
  createScannerMessageDuplicateGuard,
  decodeScannerTransportMessage,
  isScannerSessionId,
  type BarcodeMessage,
  type PhotoChunkStartMessage,
  type PhotoMessage,
  type ScannerConnectionStatus,
  type ScannerTransportMessage,
  type SessionTarget,
} from "../../../scanner-protocol/src";
import { shouldInsertScannerMessage } from "./scanner-message";

const SCANNER_CONTROL_CHANNEL = "scanner-control";
const PHOTO_TRANSFER_CHANNEL = "photo-transfer";
const SCANNER_PROTOCOL_VERSION = "1.0.0";
const JOIN_WINDOW_TTL_MS = 30_000;

type SessionTimer = ReturnType<typeof setInterval>;

type JoinWindow = {
  expiresAt?: string;
  joinToken: string;
  qrCodeUrl: string;
  sessionId: string;
};

type JoinAttempt = {
  hasAnswer?: unknown;
  id?: unknown;
  joinAttemptId?: unknown;
  answer?: unknown;
};

type ControlMessage = {
  type?: unknown;
  messageId?: unknown;
  mode?: unknown;
  payload?: unknown;
  protocolVersion?: unknown;
  version?: unknown;
  capabilities?: unknown;
  platform?: unknown;
  deviceLabel?: unknown;
  contributorId?: unknown;
  reason?: unknown;
  photoId?: unknown;
  chunkIndex?: unknown;
  totalChunks?: unknown;
};

type PeerSession = {
  answerApplied: boolean;
  control: RTCDataChannel | null;
  id: string;
  pc: RTCPeerConnection;
  photoTransfer: RTCDataChannel | null;
  ready: boolean;
};

type PendingPhoto = PhotoChunkStartMessage & {
  chunks: string[];
  receivedChunks: number;
  updatedAt: number;
};

export type MobileScannerSessionState = {
  status: ScannerConnectionStatus;
  qrCodeUrl: string | null;
  error: string | null;
  connectedAt: string | null;
  connectedPeerCount: number;
  joinWindowExpiresAt: string | null;
  sessionId: string;
};

export type MobileScannerSessionEvents = {
  onState: (state: MobileScannerSessionState) => void;
  onScan: (message: BarcodeMessage) => Promise<boolean> | boolean;
  onPhoto: (message: PhotoMessage) => Promise<boolean> | boolean;
  onInsert?: (text: string, message: BarcodeMessage) => void;
  log?: (...args: unknown[]) => void;
};

function createId(prefix: string) {
  const random = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function parseJson(data: string) {
  try {
    return JSON.parse(data);
  } catch (_error) {
    return null;
  }
}

function normalizeSessionDescription(value: unknown): RTCSessionDescriptionInit | null {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!parsed || typeof parsed !== "object") return null;
  const description = parsed as { type?: unknown; sdp?: unknown };
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

function normalizeJoinAttempt(value: unknown): { joinAttemptId: string; answer?: RTCSessionDescriptionInit | null; hasAnswer: boolean } | null {
  if (!value || typeof value !== "object") return null;
  const attempt = value as JoinAttempt;
  const joinAttemptId =
    typeof attempt.joinAttemptId === "string" && attempt.joinAttemptId
      ? attempt.joinAttemptId
      : typeof attempt.id === "string" && attempt.id
        ? attempt.id
        : null;
  if (!joinAttemptId) return null;
  const answer = normalizeSessionDescription(attempt.answer);
  return { joinAttemptId, answer, hasAnswer: Boolean(answer || attempt.hasAnswer) };
}

function majorVersion(version: unknown) {
  if (typeof version !== "string") return null;
  const major = Number(version.split(".")[0]);
  return Number.isFinite(major) ? major : null;
}

function normalizeBarcodePayload(value: unknown): BarcodeMessage | null {
  const candidate =
    value && typeof value === "object" && "payload" in value
      ? (value as { payload?: unknown }).payload
      : value;
  if (!candidate || typeof candidate !== "object") return null;
  const message = candidate as Record<string, unknown>;
  if (typeof message.barcode !== "string" || !message.barcode) return null;
  return {
    barcode: message.barcode,
    dictationPhase:
      message.dictationPhase === "partial" || message.dictationPhase === "final"
        ? message.dictationPhase
        : undefined,
    dictationSessionId:
      typeof message.dictationSessionId === "string" ? message.dictationSessionId : undefined,
    format: typeof message.format === "string" ? message.format : undefined,
    insertIntoCursor:
      typeof message.insertIntoCursor === "boolean" ? message.insertIntoCursor : undefined,
    kind: message.kind === "text" ? "text" : "barcode",
    scannedAt: typeof message.scannedAt === "string" ? message.scannedAt : undefined,
  };
}

export class MobileScannerSession {
  private answerPoll: SessionTimer | null = null;
  private joinWindow: JoinWindow | null = null;
  private peers = new Map<string, PeerSession>();
  private pendingPhotos = new Map<string, PendingPhoto>();
  private seenJoinAttempts = new Set<string>();
  private shouldAcceptScannerMessage = createScannerMessageDuplicateGuard();
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
    };
  }

  getState() {
    return { ...this.state };
  }

  async openJoinWindow(target?: SessionTarget | null) {
    this.setState({ status: this.peers.size > 0 ? "connected" : "creating", error: null });
    try {
      const joinWindow = await this.createJoinWindow(target);
      this.joinWindow = joinWindow;
      this.setState({
        status: this.peers.size > 0 ? "connected" : "waiting",
        qrCodeUrl: joinWindow.qrCodeUrl,
        error: null,
        joinWindowExpiresAt: joinWindow.expiresAt ?? null,
      });
      this.pollForJoinAttempts();
    } catch (err) {
      this.setState({
        status: this.peers.size > 0 ? "connected" : "error",
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
    this.stopJoinAttemptPolling();
    if (previous) {
      await this.revokeJoinWindow(previous).catch((error) => {
        this.events.log?.("Failed to revoke scanner join window", error);
      });
    }
    this.setState({
      status: this.peers.size > 0 ? "connected" : "disconnected",
      qrCodeUrl: null,
      joinWindowExpiresAt: null,
      error: null,
    });
    return this.getState();
  }

  async disconnect() {
    await this.closeJoinWindow();
    for (const peer of this.peers.values()) {
      this.closePeer(peer.id);
    }
    this.peers.clear();
    this.pendingPhotos.clear();
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

  async updateTarget(_target?: SessionTarget | null) {
    return this.getState();
  }

  private setState(patch: Partial<MobileScannerSessionState>) {
    this.state = {
      ...this.state,
      ...patch,
      connectedPeerCount: this.countConnectedPeers(),
    };
    this.events.onState(this.getState());
  }

  private countConnectedPeers() {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.ready) {
        count += 1;
      }
    }
    return count;
  }

  private async createJoinWindow(target?: SessionTarget | null): Promise<JoinWindow> {
    const sessionId = isScannerSessionId(this.state.sessionId) ? this.state.sessionId : createId("global-session");
    const body = {
      transport: "webrtc",
      webRtcOnly: true,
      role: "browser",
      sessionId,
      ttlMs: JOIN_WINDOW_TTL_MS,
      target: target ?? undefined,
      capabilities: ["text", "barcode", "dictation", "photo", "photo-chunk-ack"],
    };
    const response = await fetch(`${SCANNER_SIGNAL_URL}/join-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Failed to create scanner join window (${response.status})`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const returnedSessionId = typeof payload.sessionId === "string" && payload.sessionId ? payload.sessionId : sessionId;
    const returnedJoinToken =
      typeof payload.token === "string" && payload.token
        ? payload.token
        : typeof payload.joinToken === "string" && payload.joinToken
          ? payload.joinToken
          : "";
    if (!returnedJoinToken) throw new Error("Scanner signal did not return a join token");
    const qrCodeUrl =
      typeof payload.qrCodeUrl === "string" && payload.qrCodeUrl
        ? payload.qrCodeUrl
        : `${SCANNER_APP_PAIR_URL}?session=${encodeURIComponent(returnedSessionId)}&joinToken=${encodeURIComponent(returnedJoinToken)}&transport=webrtc`;
    this.state.sessionId = returnedSessionId;
    return {
      sessionId: returnedSessionId,
      joinToken: returnedJoinToken,
      qrCodeUrl,
      expiresAt:
        typeof payload.expiresAt === "string"
          ? payload.expiresAt
          : new Date(Date.now() + JOIN_WINDOW_TTL_MS).toISOString(),
    };
  }

  private async revokeJoinWindow(joinWindow: JoinWindow) {
    await fetch(`${SCANNER_SIGNAL_URL}/join-token/${encodeURIComponent(joinWindow.joinToken)}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: joinWindow.sessionId }),
    });
  }

  private pollForJoinAttempts() {
    this.stopJoinAttemptPolling();
    this.answerPoll = setInterval(() => {
      void this.fetchJoinAttempts().catch((error) => {
        this.events.log?.("Failed to poll scanner join attempts", error);
      });
    }, SCANNER_RESULT_POLL_INTERVAL_MS);
    void this.fetchJoinAttempts().catch((error) => {
      this.events.log?.("Failed to poll scanner join attempts", error);
    });
  }

  private stopJoinAttemptPolling() {
    if (!this.answerPoll) return;
    clearInterval(this.answerPoll);
    this.answerPoll = null;
  }

  private async fetchJoinAttempts() {
    const joinWindow = this.joinWindow;
    if (!joinWindow) return;
    const response = await fetch(
      `${SCANNER_SIGNAL_URL}/join-token/${encodeURIComponent(joinWindow.joinToken)}/attempts`
    );
    if (!response.ok) return;
    const payload = (await response.json()) as { joinAttempts?: unknown[]; attempts?: unknown[] };
    const attempts = Array.isArray(payload.joinAttempts)
      ? payload.joinAttempts
      : Array.isArray(payload.attempts)
        ? payload.attempts
        : [];
    for (const rawAttempt of attempts) {
      const attempt = normalizeJoinAttempt(rawAttempt);
      if (!attempt) continue;
      if (!this.seenJoinAttempts.has(attempt.joinAttemptId)) {
        this.seenJoinAttempts.add(attempt.joinAttemptId);
        await this.createPeerOffer(joinWindow, attempt.joinAttemptId);
      }
      const answer = attempt.answer ?? (attempt.hasAnswer ? await this.fetchPeerAnswer(joinWindow, attempt.joinAttemptId) : null);
      if (answer) {
        await this.applyPeerAnswer(attempt.joinAttemptId, answer);
      }
    }
  }

  private async fetchPeerAnswer(joinWindow: JoinWindow, joinAttemptId: string) {
    const response = await fetch(
      `${SCANNER_SIGNAL_URL}/join-token/${encodeURIComponent(joinWindow.joinToken)}/attempt/${encodeURIComponent(joinAttemptId)}/answer`
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { answer?: unknown };
    return normalizeSessionDescription(payload.answer);
  }

  private async createPeerOffer(joinWindow: JoinWindow, joinAttemptId: string) {
    const pc = new RTCPeerConnection({ iceServers: SCANNER_ICE_SERVERS });
    const peer: PeerSession = {
      answerApplied: false,
      control: null,
      id: joinAttemptId,
      pc,
      photoTransfer: null,
      ready: false,
    };
    this.peers.set(joinAttemptId, peer);

    peer.control = pc.createDataChannel(SCANNER_CONTROL_CHANNEL, { ordered: true });
    peer.photoTransfer = pc.createDataChannel(PHOTO_TRANSFER_CHANNEL, { ordered: true });
    this.configureControlChannel(peer, peer.control);
    this.configurePhotoChannel(peer, peer.photoTransfer);

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
        this.closePeer(joinAttemptId);
      } else if (pc.connectionState === "connected") {
        this.setState({ status: "connected", error: null, connectedAt: this.state.connectedAt ?? new Date().toISOString() });
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.waitForIceGathering(pc);
    if (!pc.localDescription) throw new Error("Failed to create scanner offer");

    await fetch(
      `${SCANNER_SIGNAL_URL}/join-token/${encodeURIComponent(joinWindow.joinToken)}/attempt/${encodeURIComponent(joinAttemptId)}/offer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offer: JSON.stringify(pc.localDescription),
          channels: [SCANNER_CONTROL_CHANNEL, PHOTO_TRANSFER_CHANNEL],
        }),
      }
    );
  }

  private async applyPeerAnswer(joinAttemptId: string, answer: RTCSessionDescriptionInit) {
    const peer = this.peers.get(joinAttemptId);
    if (!peer || peer.answerApplied) return;
    await peer.pc.setRemoteDescription(answer);
    peer.answerApplied = true;
  }

  private configureControlChannel(peer: PeerSession, channel: RTCDataChannel) {
    channel.onopen = () => {
      this.sendControl(peer, {
        type: "hello",
        protocolVersion: SCANNER_PROTOCOL_VERSION,
        extensionVersion: "1.0.35",
        platform: "chrome-extension",
        capabilities: ["text", "barcode", "dictation", "photo", "photo-chunk-ack"],
        sessionId: this.state.sessionId,
      });
    };
    channel.onclose = () => this.closePeer(peer.id);
    channel.onerror = () => {
      this.sendProtocolError(peer, "control_channel_error");
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
      void this.handlePhotoTransferMessage(peer, event.data).catch((error) => {
        this.events.log?.("Failed to handle scanner photo message", error);
      });
    };
  }

  private async handleControlMessage(peer: PeerSession, rawData: string) {
    const control = parseJson(rawData) as ControlMessage | null;
    if (control?.type === "hello" || control?.type === "capabilities") {
      const peerMajor = majorVersion(control.protocolVersion ?? control.version);
      if (peerMajor !== majorVersion(SCANNER_PROTOCOL_VERSION)) {
        this.sendProtocolError(peer, "unsupported_protocol_version");
        this.closePeer(peer.id);
        return;
      }
      peer.ready = true;
      this.sendControl(peer, {
        type: "session_ready",
        protocolVersion: SCANNER_PROTOCOL_VERSION,
        sessionId: this.state.sessionId,
        capabilities: ["text", "barcode", "dictation", "photo", "photo-chunk-ack"],
      });
      this.setState({ status: "connected", error: null, connectedAt: this.state.connectedAt ?? new Date().toISOString() });
      return;
    }

    if (control?.type === "session_close" || control?.type === "disconnect") {
      this.closePeer(peer.id);
      return;
    }

    if (control?.type === "photo_chunk_ack" || control?.type === "photo_received" || control?.type === "receipt") {
      return;
    }

    const scannerMessage =
      control?.type === "text_result" ||
      control?.type === "barcode_result" ||
      control?.type === "dictation_result" ||
      control?.type === "capture_result"
        ? normalizeBarcodePayload(control)
        : normalizeBarcodePayload(parseJson(rawData));

    if (scannerMessage) {
      const accepted =
        scannerMessage.format === "dictation" || this.shouldAcceptScannerMessage(scannerMessage);
      const stored = accepted ? await this.events.onScan(scannerMessage) : true;
      if (shouldInsertScannerMessage(scannerMessage)) {
        this.events.onInsert?.(scannerMessage.barcode, scannerMessage);
      }
      this.sendControl(peer, {
        type: "receipt",
        messageId: typeof control?.messageId === "string" ? control.messageId : undefined,
        status: stored ? "received" : "rejected",
        kind: scannerMessage.kind ?? "barcode",
      });
      return;
    }

    const transportMessage = decodeScannerTransportMessage(rawData);
    if (transportMessage) {
      await this.handleTransportMessage(peer, transportMessage);
      return;
    }

    if (control?.type) return;
    this.sendProtocolError(peer, "invalid_control_message");
  }

  private async handlePhotoTransferMessage(peer: PeerSession, data: unknown) {
    if (typeof data === "string") {
      const message = decodeScannerTransportMessage(data);
      if (message) await this.handleTransportMessage(peer, message);
      return;
    }
    if (data instanceof ArrayBuffer) {
      this.events.log?.("Ignoring unframed binary photo transfer", data.byteLength);
    }
  }

  private async handleTransportMessage(peer: PeerSession, data: ScannerTransportMessage) {
    if (data.kind === "photo") {
      const stored = await this.events.onPhoto({
        ...data,
        capturedAt: data.capturedAt || new Date().toISOString(),
      });
      if (stored) this.sendPhotoReceived(peer, data.id);
      return;
    }

    if (data.kind === "photo-chunk-start") {
      this.cleanupStalePhotos();
      this.pendingPhotos.set(data.id, {
        ...data,
        chunks: Array.from({ length: data.totalChunks }),
        receivedChunks: 0,
        updatedAt: Date.now(),
      });
      return;
    }

    if (data.kind === "photo-chunk") {
      const pending = this.pendingPhotos.get(data.id);
      if (!pending || data.index < 0 || data.index >= pending.totalChunks) return;
      if (!pending.chunks[data.index]) pending.receivedChunks += 1;
      pending.chunks[data.index] = data.data;
      pending.updatedAt = Date.now();
      this.sendControl(peer, {
        type: "photo_chunk_ack",
        photoId: data.id,
        chunkIndex: data.index,
        totalChunks: pending.totalChunks,
      });
      return;
    }

    if (data.kind === "photo-chunk-end") {
      const pending = this.pendingPhotos.get(data.id);
      if (!pending || pending.receivedChunks !== pending.totalChunks) return;
      this.pendingPhotos.delete(data.id);
      const { chunks, receivedChunks, totalChunks, updatedAt, kind, ...photo } = pending;
      const stored = await this.events.onPhoto({
        ...photo,
        kind: "photo",
        dataUrl: `data:${pending.mimeType};base64,${chunks.join("")}`,
      });
      if (stored) this.sendPhotoReceived(peer, data.id);
    }
  }

  private sendPhotoReceived(peer: PeerSession, photoId: string) {
    this.sendControl(peer, { type: "photo_received", photoId });
  }

  private sendProtocolError(peer: PeerSession, reason: string) {
    this.sendControl(peer, { type: "protocol_error", reason });
  }

  private sendControl(peer: PeerSession, message: Record<string, unknown>) {
    if (peer.control?.readyState !== "open") return;
    peer.control.send(JSON.stringify(message));
  }

  private closePeer(joinAttemptId: string) {
    const peer = this.peers.get(joinAttemptId);
    if (!peer) return;
    this.peers.delete(joinAttemptId);
    peer.control?.close();
    peer.photoTransfer?.close();
    peer.pc.close();
    this.setState({
      status: this.peers.size > 0 ? "connected" : this.joinWindow ? "waiting" : "disconnected",
      connectedAt: this.peers.size > 0 ? this.state.connectedAt : null,
    });
  }

  private cleanupStalePhotos() {
    const staleBefore = Date.now() - 2 * 60 * 1000;
    for (const [id, pending] of this.pendingPhotos) {
      if (pending.updatedAt < staleBefore) this.pendingPhotos.delete(id);
    }
  }

  private waitForIceGathering(pc: RTCPeerConnection) {
    return new Promise<void>((resolve) => {
      if (pc.iceGatheringState === "complete") {
        resolve();
        return;
      }

      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === "complete") {
          pc.onicegatheringstatechange = null;
          resolve();
        }
      };
      setTimeout(resolve, SCANNER_ICE_GATHERING_TIMEOUT_MS);
    });
  }
}
