import {
  PHOTO_TRANSFER_CHANNEL_LABEL,
  SCANNER_APP_PAIR_URL,
  SCANNER_CONTROL_CHANNEL_LABEL,
  SCANNER_ICE_GATHERING_TIMEOUT_MS,
  SCANNER_ICE_SERVERS,
  SCANNER_PROTOCOL_MAJOR_VERSION,
  SCANNER_PROTOCOL_MINOR_VERSION,
  SCANNER_SIGNAL_URL,
  decodePhotoTransferChunkFrame,
  decodePhotoTransferMessage,
  decodeScannerControlMessage,
  encodeScannerControlMessage,
  isScannerProtocolVersionSupported,
  isScannerSessionId,
  scannerControlDuplicateKey,
  type PhotoTransferBinaryChunkMessage,
  type PhotoTransferMessage,
  type PhotoTransferStartMessage,
  type ScannerControlMessage,
  type ScannerConnectionStatus,
} from "../../../scanner-protocol/src";
import { shouldInsertScannerMessage } from "./scanner-message";

type SessionTimer = ReturnType<typeof setTimeout>;

const JOIN_WINDOW_TTL_MS = 2 * 60 * 1000;
const HIDDEN_JOIN_ATTEMPT_POLL_GRACE_MS = 60 * 1000;
const JOIN_ATTEMPT_INITIAL_POLL_INTERVAL_MS = 1000;
const JOIN_ATTEMPT_MAX_POLL_INTERVAL_MS = 10 * 1000;

export const MOBILE_SCANNER_IDENTITY_STORAGE_KEYS = {
  installId: "volt.mobileScanner.extensionInstallId",
  sessionLabel: "volt.mobileScanner.sessionLabel",
  pairings: "volt.mobileScanner.pairedBrowsers.v1",
} as const;

export type BarcodeMessage = {
  id?: string;
  barcode: string;
  dictationPhase?: "partial" | "final";
  dictationSessionId?: string;
  format?: string;
  insertIntoCursor?: boolean;
  kind?: "barcode" | "text";
  scannedAt?: string;
};

export type PhotoMessage = {
  kind: "photo";
  id: string;
  name: string;
  mimeType: string;
  dataUrl?: string;
  contributorId?: string;
  size: number;
  width?: number;
  height?: number;
  capturedAt?: string;
  photoBatchId?: string;
};

export type SessionTarget = {
  browser?: string;
  tabTitle?: string;
  url?: string;
  cursor?: string;
};

export type ExtensionIdentity = {
  installId: string;
  sessionLabel: string;
};

type DurablePairingCredential = {
  pairingId: string;
  pairingSecret: string;
  browserSessionId: string;
  displayName: string;
  createdAt: string;
  lastConnectedAt: string;
};

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

type PeerSession = {
  answerApplied: boolean;
  control: RTCDataChannel | null;
  id: string;
  pc: RTCPeerConnection;
  photoTransfer: RTCDataChannel | null;
  ready: boolean;
};

type PendingPhoto = PhotoTransferStartMessage & {
  chunks: string[];
  receivedChunks: number;
  updatedAt: number;
};

const EXTENSION_PROTOCOL_VERSION = {
  major: SCANNER_PROTOCOL_MAJOR_VERSION,
  minor: SCANNER_PROTOCOL_MINOR_VERSION,
};

const RECONNECT_POLL_INTERVAL_MS = 5000;

export type MobileScannerSessionState = {
  status: ScannerConnectionStatus;
  qrCodeUrl: string | null;
  error: string | null;
  connectedAt: string | null;
  connectedPeerCount: number;
  joinWindowExpiresAt: string | null;
  sessionId: string;
  target: SessionTarget | null;
  extensionIdentity: ExtensionIdentity | null;
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

function createSecret(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let value = "";
  for (const byte of bytes) {
    value += String.fromCharCode(byte);
  }
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeIdentityLabel(value: unknown) {
  const label = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return label.slice(0, 80);
}

function defaultSessionLabel() {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    "";
  if (/mac/i.test(platform)) return "Chrome on Mac";
  if (/win/i.test(platform)) return "Chrome on Windows";
  if (/linux|cros/i.test(platform)) return "Chrome on Linux";
  return "Chrome session";
}

function storageLocalGet(keys: string[]) {
  const chromeApi = globalThis as typeof globalThis & { chrome?: typeof chrome };
  if (chromeApi.chrome?.storage?.local?.get) {
    return chromeApi.chrome.storage.local.get(keys) as Promise<Record<string, unknown>>;
  }
  const fallback: Record<string, unknown> = {};
  try {
    for (const key of keys) {
      fallback[key] = globalThis.localStorage?.getItem(key) ?? undefined;
    }
  } catch (_error) {}
  return Promise.resolve(fallback);
}

function storageLocalSet(values: Record<string, unknown>) {
  const chromeApi = globalThis as typeof globalThis & { chrome?: typeof chrome };
  if (chromeApi.chrome?.storage?.local?.set) {
    return chromeApi.chrome.storage.local.set(values) as Promise<void>;
  }
  try {
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "string") {
        globalThis.localStorage?.setItem(key, value);
      }
    }
  } catch (_error) {}
  return Promise.resolve();
}

function normalizePairingCredential(value: unknown): DurablePairingCredential | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<DurablePairingCredential>;
  if (
    typeof record.pairingId !== "string" ||
    typeof record.pairingSecret !== "string" ||
    typeof record.browserSessionId !== "string" ||
    typeof record.displayName !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.lastConnectedAt !== "string"
  ) {
    return null;
  }
  return {
    pairingId: record.pairingId,
    pairingSecret: record.pairingSecret,
    browserSessionId: record.browserSessionId,
    displayName: record.displayName,
    createdAt: record.createdAt,
    lastConnectedAt: record.lastConnectedAt,
  };
}

async function loadDurablePairings() {
  const key = MOBILE_SCANNER_IDENTITY_STORAGE_KEYS.pairings;
  const stored = await storageLocalGet([key]);
  const value = stored[key];
  if (!Array.isArray(value)) return [];
  return value.map(normalizePairingCredential).filter((item): item is DurablePairingCredential => !!item);
}

async function saveDurablePairing(pairing: DurablePairingCredential) {
  const key = MOBILE_SCANNER_IDENTITY_STORAGE_KEYS.pairings;
  const pairings = await loadDurablePairings();
  const nextPairings = [
    pairing,
    ...pairings.filter((item) => item.pairingId !== pairing.pairingId && item.browserSessionId !== pairing.browserSessionId),
  ].slice(0, 12);
  await storageLocalSet({ [key]: nextPairings });
}

export async function getMobileScannerExtensionIdentity(): Promise<ExtensionIdentity> {
  const keys = MOBILE_SCANNER_IDENTITY_STORAGE_KEYS;
  const stored = await storageLocalGet([keys.installId, keys.sessionLabel]);
  const storedInstallId = stored[keys.installId];
  const installId = isScannerSessionId(storedInstallId) ? storedInstallId : createId("chrome-install");
  const sessionLabel = normalizeIdentityLabel(stored[keys.sessionLabel]) || defaultSessionLabel();

  if (installId !== storedInstallId || sessionLabel !== stored[keys.sessionLabel]) {
    await storageLocalSet({
      [keys.installId]: installId,
      [keys.sessionLabel]: sessionLabel,
    });
  }

  return { installId, sessionLabel };
}

export async function saveMobileScannerSessionLabel(label: string): Promise<ExtensionIdentity> {
  const sessionLabel = normalizeIdentityLabel(label) || defaultSessionLabel();
  const identity = await getMobileScannerExtensionIdentity();
  const nextIdentity = { ...identity, sessionLabel };
  await storageLocalSet({
    [MOBILE_SCANNER_IDENTITY_STORAGE_KEYS.installId]: nextIdentity.installId,
    [MOBILE_SCANNER_IDENTITY_STORAGE_KEYS.sessionLabel]: nextIdentity.sessionLabel,
  });
  return nextIdentity;
}

function parseJson(data: string) {
  try {
    return JSON.parse(data);
  } catch (_error) {
    return null;
  }
}

function createMessageId(prefix: string) {
  return createId(prefix).replace(/[^a-zA-Z0-9_-]/g, "_");
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
  private peers = new Map<string, PeerSession>();
  private peerPairings = new Map<string, DurablePairingCredential>();
  private pendingPhotos = new Map<string, PendingPhoto>();
  private reconnectPoll: SessionTimer | null = null;
  private identityReady: Promise<void>;
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
    this.identityReady = this.refreshExtensionIdentity().then(
      () => {},
      (error) => {
        this.events.log?.("Failed to load scanner extension identity", error);
      },
    );
    this.scheduleReconnectPoll(RECONNECT_POLL_INTERVAL_MS);
  }

  getState() {
    return { ...this.state };
  }

  async openJoinWindow(target?: SessionTarget | null) {
    this.target = target ?? this.target;
    this.setState({ status: this.peers.size > 0 ? "connected" : "creating", error: null, target: this.target });
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
        status: this.peers.size > 0 ? "connected" : "waiting",
        qrCodeUrl: joinWindow.qrCodeUrl,
        error: null,
        joinWindowExpiresAt: joinWindow.expiresAt ?? null,
        extensionIdentity,
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
    if (previous) {
      this.hiddenPollingExpiresAt = Date.now() + HIDDEN_JOIN_ATTEMPT_POLL_GRACE_MS;
      await this.revokeJoinWindow(previous).catch((error) => {
        this.events.log?.("Failed to revoke scanner join window", error);
      });
      this.events.log?.("[Volt Scanner Pairing] join window closed", {
        pendingPeers: this.peers.size,
        tokenTail: previous.joinToken.slice(-6),
      });
    }
    this.stopHiddenJoinAttemptPollingIfIdle();
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
    for (const peer of this.peers.values()) {
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
    for (const peer of this.peers.values()) {
      if (peer.ready) {
        this.sendSessionReady(peer);
      }
    }
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

  private async refreshExtensionIdentity() {
    const extensionIdentity = await getMobileScannerExtensionIdentity();
    this.state.sessionId = extensionIdentity.installId;
    this.setState({ extensionIdentity });
    return extensionIdentity;
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
      deviceLabel: this.state.extensionIdentity?.sessionLabel,
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
        : `${SCANNER_APP_PAIR_URL}?sessionId=${encodeURIComponent(returnedSessionId)}&session=${encodeURIComponent(returnedSessionId)}&token=${encodeURIComponent(returnedJoinToken)}&joinToken=${encodeURIComponent(returnedJoinToken)}&transport=webrtc&label=${encodeURIComponent(this.state.extensionIdentity?.sessionLabel ?? "")}`;
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

  private async registerPairing(pairing: DurablePairingCredential) {
    await fetch(`${SCANNER_SIGNAL_URL}/pairings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pairingId: pairing.pairingId,
        pairingSecret: pairing.pairingSecret,
        browserSessionId: pairing.browserSessionId,
        displayName: pairing.displayName,
      }),
    });
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
    if (!isScannerSessionId(sessionId)) return;
    const pairings = await loadDurablePairings();
    const pairingById = new Map(pairings.map((pairing) => [pairing.pairingId, pairing]));
    if (pairingById.size === 0) return;

    const response = await fetch(`${SCANNER_SIGNAL_URL}/pairings/reconnect-requests?sessionId=${encodeURIComponent(sessionId)}`);
    if (!response.ok) return;
    const payload = (await response.json()) as { requests?: unknown[] };
    const requests = Array.isArray(payload.requests) ? payload.requests : [];
    for (const rawRequest of requests) {
      if (!rawRequest || typeof rawRequest !== "object") continue;
      const request = rawRequest as { pairingId?: unknown; requestId?: unknown };
      if (typeof request.pairingId !== "string" || typeof request.requestId !== "string") continue;
      const pairing = pairingById.get(request.pairingId);
      if (!pairing) continue;
      const key = `${request.pairingId}:${request.requestId}`;
      if (this.seenReconnectRequests.has(key)) continue;
      this.seenReconnectRequests.add(key);
      await this.answerReconnectRequest(pairing, request.requestId);
    }
  }

  private async answerReconnectRequest(pairing: DurablePairingCredential, requestId: string) {
    const joinWindow = await this.createJoinWindow(this.target);
    this.joinWindow = joinWindow;
    this.answerPollJoinWindow = joinWindow;
    this.hiddenPollingExpiresAt = null;
    this.setState({
      status: this.peers.size > 0 ? "connected" : "waiting",
      qrCodeUrl: joinWindow.qrCodeUrl,
      error: null,
      joinWindowExpiresAt: joinWindow.expiresAt ?? null,
    });
    this.pollForJoinAttempts();

    await fetch(
      `${SCANNER_SIGNAL_URL}/pairings/${encodeURIComponent(pairing.pairingId)}/reconnect/${encodeURIComponent(requestId)}/join-window`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Volt-Pairing-Secret": pairing.pairingSecret },
        body: JSON.stringify({
          pairingSecret: pairing.pairingSecret,
          joinUrl: joinWindow.qrCodeUrl,
          joinToken: joinWindow.joinToken,
          sessionId: joinWindow.sessionId,
        }),
      }
    );
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
    const response = await fetch(
      `${SCANNER_SIGNAL_URL}/join-token/${encodeURIComponent(joinWindow.joinToken)}/attempts`
    );
    if (!response.ok) return false;
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
        if (!acceptingNewAttempts) continue;
        this.seenJoinAttempts.add(attempt.joinAttemptId);
        this.events.log?.("[Volt Scanner Pairing] join attempt seen", {
          joinAttemptId: attempt.joinAttemptId,
        });
        await this.createPeerOffer(joinWindow, attempt.joinAttemptId);
        hadActivity = true;
      }
      if (this.peers.get(attempt.joinAttemptId)?.answerApplied) continue;
      const answer = attempt.answer ?? (attempt.hasAnswer ? await this.fetchPeerAnswer(joinWindow, attempt.joinAttemptId) : null);
      if (answer) {
        await this.applyPeerAnswer(attempt.joinAttemptId, answer);
        hadActivity = true;
      }
    }
    this.stopHiddenJoinAttemptPollingIfIdle();
    return hadActivity;
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
    this.events.log?.("[Volt Scanner Pairing] creating WebRTC offer", { joinAttemptId });
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

    peer.control = pc.createDataChannel(SCANNER_CONTROL_CHANNEL_LABEL, { ordered: true });
    peer.photoTransfer = pc.createDataChannel(PHOTO_TRANSFER_CHANNEL_LABEL, { ordered: true });
    this.configureControlChannel(peer, peer.control);
    this.configurePhotoChannel(peer, peer.photoTransfer);

    pc.onconnectionstatechange = () => {
      this.events.log?.("[Volt Scanner Pairing] peer connection state", {
        joinAttemptId,
        state: pc.connectionState,
        ready: peer.ready,
      });
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
        this.closePeer(joinAttemptId);
      } else if (pc.connectionState === "connected" && peer.ready) {
        this.setState({ status: "connected", error: null, connectedAt: this.state.connectedAt ?? new Date().toISOString() });
        void this.closeJoinWindow();
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
          channels: [SCANNER_CONTROL_CHANNEL_LABEL, PHOTO_TRANSFER_CHANNEL_LABEL],
        }),
      }
    );
    this.events.log?.("[Volt Scanner Pairing] WebRTC offer posted", { joinAttemptId });
  }

  private async applyPeerAnswer(joinAttemptId: string, answer: RTCSessionDescriptionInit) {
    const peer = this.peers.get(joinAttemptId);
    if (!peer || peer.answerApplied) return;
    await peer.pc.setRemoteDescription(answer);
    peer.answerApplied = true;
    this.events.log?.("[Volt Scanner Pairing] WebRTC answer applied", { joinAttemptId });
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
      void this.handlePhotoTransferMessage(peer, event.data).catch((error) => {
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
      this.setState({ status: "connected", error: null, connectedAt: this.state.connectedAt ?? new Date().toISOString() });
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
      if (shouldInsertScannerMessage(scannerMessage)) {
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
      return;
    }
  }

  private async handlePhotoTransferMessage(peer: PeerSession, data: unknown) {
    if (typeof data === "string") {
      const message = decodePhotoTransferMessage(data);
      if (message) await this.handlePhotoTransferProtocolMessage(peer, message);
      return;
    }
    if (data instanceof ArrayBuffer) {
      const message = decodePhotoTransferChunkFrame(data);
      if (message) await this.handlePhotoTransferProtocolMessage(peer, message);
    }
  }

  private async handlePhotoTransferProtocolMessage(
    peer: PeerSession,
    data: PhotoTransferMessage | PhotoTransferBinaryChunkMessage,
  ) {
    if (data.type === "photo_start") {
      this.cleanupStalePhotos();
      this.pendingPhotos.set(data.photoId, {
        ...data,
        chunks: Array.from({ length: data.totalChunks }),
        receivedChunks: 0,
        updatedAt: Date.now(),
      });
      return;
    }

    if (data.type === "photo_chunk") {
      const pending = this.pendingPhotos.get(data.photoId);
      if (!pending || data.chunkIndex < 0 || data.chunkIndex >= pending.totalChunks) return;
      if (!pending.chunks[data.chunkIndex]) pending.receivedChunks += 1;
      pending.chunks[data.chunkIndex] =
        typeof data.data === "string"
          ? data.data
          : btoa(String.fromCharCode(...data.data));
      pending.updatedAt = Date.now();
      this.sendControl(peer, {
        type: "photo_chunk_ack",
        messageId: createMessageId("control"),
        sentAt: new Date().toISOString(),
        photoId: data.photoId,
        chunkIndex: data.chunkIndex,
        totalChunks: pending.totalChunks,
      });
      return;
    }

    if (data.type === "photo_complete") {
      const pending = this.pendingPhotos.get(data.photoId);
      if (!pending || pending.receivedChunks !== pending.totalChunks) return;
      this.pendingPhotos.delete(data.photoId);
      const stored = await this.events.onPhoto({
        kind: "photo",
        id: pending.photoId,
        name: pending.filename,
        mimeType: pending.mimeType,
        size: pending.size,
        width: pending.width,
        height: pending.height,
        capturedAt: pending.capturedAt,
        contributorId: pending.contributorId,
        dataUrl: `data:${pending.mimeType};base64,${pending.chunks.join("")}`,
        photoBatchId: pending.photoBatchId,
      } as PhotoMessage & { photoBatchId: string });
      if (stored) this.sendPhotoReceived(peer, pending.photoId, pending.photoBatchId, pending.size);
      return;
    }

    if (data.type === "photo_cancel") {
      this.pendingPhotos.delete(data.photoId);
    }
  }

  private sendPhotoReceived(peer: PeerSession, photoId: string, photoBatchId = "default", size = 1) {
    this.sendControl(peer, {
      type: "photo_received",
      messageId: createMessageId("control"),
      sentAt: new Date().toISOString(),
      photoId,
      photoBatchId,
      storedAt: new Date().toISOString(),
      size: Math.max(1, size),
    });
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

  private closePeer(joinAttemptId: string) {
    const peer = this.peers.get(joinAttemptId);
    if (!peer) return;
    this.peers.delete(joinAttemptId);
    this.peerPairings.delete(joinAttemptId);
    peer.control?.close();
    peer.photoTransfer?.close();
    peer.pc.close();
    this.setState({
      status: this.peers.size > 0 ? "connected" : this.joinWindow ? "waiting" : "disconnected",
      connectedAt: this.peers.size > 0 ? this.state.connectedAt : null,
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
    for (const peer of this.peers.values()) {
      if (!peer.answerApplied) return;
    }
    this.answerPollJoinWindow = null;
    this.hiddenPollingExpiresAt = null;
    this.stopJoinAttemptPolling();
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
