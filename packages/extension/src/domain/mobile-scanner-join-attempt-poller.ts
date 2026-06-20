import type { MobileScannerPeerConnections } from "./mobile-scanner-peer-connection";
import type { JoinWindow, MobileScannerSignalClient } from "./mobile-scanner-signal-client";

type SessionTimer = ReturnType<typeof setTimeout>;

const HIDDEN_JOIN_ATTEMPT_POLL_GRACE_MS = 60 * 1000;
const JOIN_ATTEMPT_INITIAL_POLL_INTERVAL_MS = 1000;
const JOIN_ATTEMPT_MAX_POLL_INTERVAL_MS = 10 * 1000;

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
        this.seenJoinAttempts.add(attempt.joinAttemptId);
        this.options.log?.("[Volt Scanner Pairing] join attempt seen", {
          joinAttemptId: attempt.joinAttemptId,
        });
        await this.options.peerConnections.createPeerOffer(joinWindow, attempt.joinAttemptId);
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
