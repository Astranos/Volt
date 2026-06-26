import { isScannerSessionId } from "@volt/scanner-protocol";
import type { DurablePairingCredential } from "./mobile-scanner-identity";
import type { MobileScannerPeerConnections } from "./mobile-scanner-peer-connection";
import type { JoinWindow, MobileScannerSignalClient } from "./mobile-scanner-signal-client";

type SessionTimer = ReturnType<typeof setTimeout>;

const HIDDEN_JOIN_ATTEMPT_POLL_GRACE_MS = 60 * 1000;
const JOIN_ATTEMPT_INITIAL_POLL_INTERVAL_MS = 1000;
const JOIN_ATTEMPT_MAX_POLL_INTERVAL_MS = 10 * 1000;
const RECONNECT_FALLBACK_POLL_INTERVAL_MS = 5000;
const RECONNECT_ACTIVE_WINDOW_POLL_INTERVAL_MS = 1000;
const RECONNECT_ACTIVE_WINDOW_MS = 95 * 1000;

type MobileScannerJoinAttemptPollerOptions = {
  getActiveJoinWindow: () => JoinWindow | null;
  hiddenPollingGraceMs?: number;
  initialPollIntervalMs?: number;
  log?: (...args: unknown[]) => void;
  maxPollIntervalMs?: number;
  peerConnections: MobileScannerPeerConnections;
  signalClient: MobileScannerSignalClient;
};

export class MobileScannerJoinAttemptPoller {
  private hiddenPollingExpiresAt: number | null = null;
  private readonly options: MobileScannerJoinAttemptPollerOptions;
  private poll: SessionTimer | null = null;
  private pollDelayMs = JOIN_ATTEMPT_INITIAL_POLL_INTERVAL_MS;
  private pollJoinWindow: JoinWindow | null = null;
  private seenJoinAttempts = new Set<string>();

  constructor(options: MobileScannerJoinAttemptPollerOptions) {
    this.options = options;
  }

  start(joinWindow: JoinWindow) {
    this.stop();
    this.pollDelayMs = this.initialPollIntervalMs;
    this.pollJoinWindow = joinWindow;
    this.hiddenPollingExpiresAt = null;
    this.schedule(0);
  }

  continueHiddenPollingFor(joinWindow: JoinWindow) {
    if (this.pollJoinWindow?.joinToken !== joinWindow.joinToken) {
      this.pollJoinWindow = joinWindow;
    }
    this.hiddenPollingExpiresAt = Date.now() + this.hiddenPollingGraceMs;
    this.stopIfIdle();
  }

  clear() {
    this.stop();
    this.pollJoinWindow = null;
    this.hiddenPollingExpiresAt = null;
    this.seenJoinAttempts.clear();
  }

  stopIfIdle() {
    if (this.options.getActiveJoinWindow() || !this.pollJoinWindow) return;
    if (this.hiddenPollingExpiresAt !== null && this.hiddenPollingExpiresAt <= Date.now()) {
      this.clearPollingWindow();
      return;
    }
    for (const peer of this.options.peerConnections.peers.values()) {
      if (!peer.answerApplied) return;
    }
    this.clearPollingWindow();
  }

  private stop() {
    if (!this.poll) return;
    clearTimeout(this.poll);
    this.poll = null;
  }

  private shouldContinue() {
    if (this.options.getActiveJoinWindow()) return true;
    if (!this.pollJoinWindow) return false;
    return this.hiddenPollingExpiresAt === null || this.hiddenPollingExpiresAt > Date.now();
  }

  private schedule(delayMs: number) {
    if (!this.shouldContinue()) {
      this.pollJoinWindow = null;
      this.hiddenPollingExpiresAt = null;
      return;
    }
    this.poll = setTimeout(() => {
      this.poll = null;
      void this.fetchJoinAttempts()
        .then((hadActivity) => {
          if (!this.shouldContinue()) {
            this.pollJoinWindow = null;
            this.hiddenPollingExpiresAt = null;
            return;
          }
          this.pollDelayMs = hadActivity
            ? this.initialPollIntervalMs
            : Math.min(Math.ceil(this.pollDelayMs * 1.5), this.maxPollIntervalMs);
          this.schedule(this.pollDelayMs);
        })
        .catch((error) => {
          this.options.log?.("Failed to poll scanner join attempts", error);
          this.pollDelayMs = this.maxPollIntervalMs;
          this.schedule(this.pollDelayMs);
        });
    }, delayMs);
  }

  private async fetchJoinAttempts() {
    const activeJoinWindow = this.options.getActiveJoinWindow();
    const joinWindow = activeJoinWindow ?? this.pollJoinWindow;
    if (!joinWindow) return false;

    let hadActivity = false;
    const acceptingNewAttempts = activeJoinWindow?.joinToken === joinWindow.joinToken;
    const attempts = await this.options.signalClient.fetchJoinAttempts(joinWindow);
    for (const attempt of attempts) {
      if (!this.seenJoinAttempts.has(attempt.joinAttemptId)) {
        if (!acceptingNewAttempts) continue;
        this.options.log?.("[Volt Scanner Pairing] join attempt seen", {
          joinAttemptId: attempt.joinAttemptId,
        });
        await this.options.peerConnections.createPeerOffer(joinWindow, attempt.joinAttemptId);
        this.seenJoinAttempts.add(attempt.joinAttemptId);
        hadActivity = true;
      }
      if (this.options.peerConnections.peers.get(attempt.joinAttemptId)?.answerApplied) continue;
      const answer = attempt.answer ??
        (attempt.hasAnswer
          ? await this.options.signalClient.fetchPeerAnswer(joinWindow, attempt.joinAttemptId)
          : null);
      if (answer) {
        await this.options.peerConnections.applyPeerAnswer(attempt.joinAttemptId, answer);
        hadActivity = true;
      }
    }
    this.stopIfIdle();
    return hadActivity;
  }

  private clearPollingWindow() {
    this.pollJoinWindow = null;
    this.hiddenPollingExpiresAt = null;
    this.stop();
  }

  private get hiddenPollingGraceMs() {
    return this.options.hiddenPollingGraceMs ?? HIDDEN_JOIN_ATTEMPT_POLL_GRACE_MS;
  }

  private get initialPollIntervalMs() {
    return this.options.initialPollIntervalMs ?? JOIN_ATTEMPT_INITIAL_POLL_INTERVAL_MS;
  }

  private get maxPollIntervalMs() {
    return this.options.maxPollIntervalMs ?? JOIN_ATTEMPT_MAX_POLL_INTERVAL_MS;
  }
}

type MobileScannerReconnectPollerOptions = {
  activeWindowMs?: number;
  activeWindowPollIntervalMs?: number;
  createReconnectJoinWindow: (pairing: DurablePairingCredential, requestId: string) => Promise<JoinWindow>;
  fallbackPollIntervalMs?: number;
  getDurablePairings: () => Promise<DurablePairingCredential[]>;
  getSessionId: () => string;
  identityReady?: Promise<void>;
  log?: (...args: unknown[]) => void;
  signalClient: MobileScannerSignalClient;
};

export class MobileScannerReconnectPoller {
  private readonly options: MobileScannerReconnectPollerOptions;
  private poll: SessionTimer | null = null;
  private reconnectFastPollUntil = 0;
  private seenReconnectRequests = new Set<string>();

  constructor(options: MobileScannerReconnectPollerOptions) {
    this.options = options;
  }

  start(delayMs = 0) {
    this.schedule(delayMs);
  }

  stop() {
    if (!this.poll) return;
    clearTimeout(this.poll);
    this.poll = null;
  }

  clear() {
    this.stop();
    this.reconnectFastPollUntil = 0;
    this.seenReconnectRequests.clear();
  }

  async pollNow() {
    await this.pollReconnectRequests();
  }

  private schedule(delayMs: number) {
    if (this.poll) return;
    this.poll = setTimeout(() => {
      this.poll = null;
      void this.pollReconnectRequests()
        .catch((error) => {
          this.options.log?.("Failed to poll scanner reconnect requests", error);
        })
        .finally(() => {
          this.schedule(this.nextPollDelay());
        });
    }, delayMs);
  }

  private nextPollDelay() {
    return Date.now() < this.reconnectFastPollUntil
      ? this.activeWindowPollIntervalMs
      : this.fallbackPollIntervalMs;
  }

  private async pollReconnectRequests() {
    await this.options.identityReady;
    const sessionId = this.options.getSessionId();
    if (!isScannerSessionId(sessionId)) {
      this.options.log?.("[Volt Scanner Reconnect] poll skipped: invalid session id", { sessionId });
      return;
    }
    const pairings = await this.options.getDurablePairings();
    const pairingById = new Map(pairings.map((pairing) => [pairing.pairingId, pairing]));
    const pairingByBrowserSessionId = new Map(
      pairings.map((pairing) => [pairing.browserSessionId, pairing]),
    );
    if (pairingById.size === 0) {
      this.options.log?.("[Volt Scanner Reconnect] poll skipped: no durable pairings", { sessionId });
      return;
    }

    const { response, requests } = await this.options.signalClient.fetchReconnectRequests(sessionId);
    this.options.log?.("[Volt Scanner Reconnect] reconnect requests fetched", {
      sessionId,
      status: response.status,
      pairingCount: pairingById.size,
    });
    if (!response.ok) return;
    this.options.log?.("[Volt Scanner Reconnect] reconnect requests decoded", {
      sessionId,
      requestCount: requests.length,
    });
    if (requests.length > 0) {
      this.reconnectFastPollUntil = Date.now() + this.activeWindowMs;
    }
    for (const request of requests) {
      const pairing =
        pairingById.get(request.pairingId) ??
        (request.browserSessionId ? pairingByBrowserSessionId.get(request.browserSessionId) : undefined);
      if (!pairing) continue;
      const key = `${request.pairingId}:${request.requestId}`;
      if (this.seenReconnectRequests.has(key)) continue;
      this.options.log?.("[Volt Scanner Reconnect] answering reconnect request", {
        sessionId,
        pairingId: request.pairingId,
        requestId: request.requestId,
      });
      const joinWindow = await this.options.createReconnectJoinWindow(pairing, request.requestId);
      await this.options.signalClient.postReconnectJoinWindow(pairing, request.requestId, joinWindow, request.pairingId);
      this.options.log?.("[Volt Scanner Reconnect] join window posted", {
        pairingId: pairing.pairingId,
        requestPairingId: request.pairingId,
        requestId: request.requestId,
        sessionId: joinWindow.sessionId,
      });
      this.seenReconnectRequests.add(key);
    }
  }

  private get activeWindowMs() {
    return this.options.activeWindowMs ?? RECONNECT_ACTIVE_WINDOW_MS;
  }

  private get activeWindowPollIntervalMs() {
    return this.options.activeWindowPollIntervalMs ?? RECONNECT_ACTIVE_WINDOW_POLL_INTERVAL_MS;
  }

  private get fallbackPollIntervalMs() {
    return this.options.fallbackPollIntervalMs ?? RECONNECT_FALLBACK_POLL_INTERVAL_MS;
  }
}
