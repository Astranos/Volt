import {
  PHOTO_TRANSFER_CHANNEL_LABEL,
  SCANNER_CONTROL_CHANNEL_LABEL,
  buildScannerAppClipJoinUrl,
  normalizeScannerIceServers,
} from "@volt/scanner-protocol";
import type { ScannerIceServer } from "@volt/scanner-protocol";
import type { DurablePairingCredential, WebPushSubscriptionRecord } from "./mobile-scanner-identity";
import { EXTENSION_SCANNER_SIGNAL_URL } from "./mobile-scanner-signal-url.ts";
import type { SessionTarget } from "./mobile-scanner-session-types";

type JoinAttempt = {
  hasAnswer?: unknown;
  id?: unknown;
  joinAttemptId?: unknown;
  answer?: unknown;
};

type SignalFetchOptions = RequestInit & {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
};

export type JoinWindow = {
  expiresAt?: string;
  joinToken: string;
  qrCodeUrl: string;
  sessionId: string;
};

export type NormalizedJoinAttempt = {
  joinAttemptId: string;
  answer?: RTCSessionDescriptionInit | null;
  hasAnswer: boolean;
};

export type ReconnectRequest = {
  browserSessionId?: string;
  pairingId: string;
  requestId: string;
};

export function parseJson(data: string) {
  try {
    return JSON.parse(data);
  } catch (_error) {
    return null;
  }
}

export function normalizeSessionDescription(value: unknown): RTCSessionDescriptionInit | null {
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

export function normalizeScannerIceServersResponse(value: unknown): ScannerIceServer[] | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as { iceServers?: unknown };
  const iceServers = normalizeScannerIceServers(payload.iceServers);
  return iceServers && iceServers.length > 0 ? iceServers : null;
}

const DEFAULT_SIGNAL_FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_SIGNAL_FETCH_RETRIES = 2;
const DEFAULT_SIGNAL_FETCH_RETRY_DELAY_MS = 250;

function retryDelay(attempt: number, baseDelayMs: number) {
  return baseDelayMs * 2 ** attempt;
}

function sleep(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function isRetryableSignalStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function signalFetchTimeoutMessage(input: string | URL | Request, timeoutMs: number) {
  const url = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
  return `Scanner signal request timed out after ${timeoutMs}ms (${url})`;
}

export async function signalFetch(input: string | URL | Request, options: SignalFetchOptions = {}) {
  const {
    retries = DEFAULT_SIGNAL_FETCH_RETRIES,
    retryDelayMs = DEFAULT_SIGNAL_FETCH_RETRY_DELAY_MS,
    timeoutMs = DEFAULT_SIGNAL_FETCH_TIMEOUT_MS,
    ...init
  } = options;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      if (attempt < retries && isRetryableSignalStatus(response.status)) {
        await sleep(retryDelay(attempt, retryDelayMs));
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = controller.signal.aborted ? new Error(signalFetchTimeoutMessage(input, timeoutMs)) : error;
      if (attempt >= retries) break;
      await sleep(retryDelay(attempt, retryDelayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Scanner signal request failed");
}

function normalizeJoinAttempt(value: unknown): NormalizedJoinAttempt | null {
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

export class MobileScannerSignalClient {
  private readonly ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  async createJoinWindow({
    sessionId,
    target,
    deviceLabel,
  }: {
    sessionId: string;
    target?: SessionTarget | null;
    deviceLabel?: string;
  }): Promise<JoinWindow> {
    const body = {
      transport: "webrtc",
      webRtcOnly: true,
      role: "browser",
      sessionId,
      ttlMs: this.ttlMs,
      target: target ?? undefined,
      deviceLabel,
      capabilities: ["text", "barcode", "dictation", "photo", "photo-chunk-ack"],
    };
    const response = await signalFetch(`${EXTENSION_SCANNER_SIGNAL_URL}/join-token`, {
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
        : buildScannerAppClipJoinUrl({
            token: returnedJoinToken,
            sessionId: returnedSessionId,
            signalUrl: EXTENSION_SCANNER_SIGNAL_URL,
          });
    return {
      sessionId: returnedSessionId,
      joinToken: returnedJoinToken,
      qrCodeUrl,
      expiresAt:
        typeof payload.expiresAt === "string"
          ? payload.expiresAt
          : new Date(Date.now() + this.ttlMs).toISOString(),
    };
  }

  async revokeJoinWindow(joinWindow: JoinWindow) {
    await signalFetch(`${EXTENSION_SCANNER_SIGNAL_URL}/join-token/${encodeURIComponent(joinWindow.joinToken)}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: joinWindow.sessionId }),
      retries: 0,
    });
  }

  async fetchJoinAttempts(joinWindow: JoinWindow) {
    const response = await signalFetch(
      `${EXTENSION_SCANNER_SIGNAL_URL}/join-token/${encodeURIComponent(joinWindow.joinToken)}/attempts`
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as { joinAttempts?: unknown[]; attempts?: unknown[] };
    const attempts = Array.isArray(payload.joinAttempts)
      ? payload.joinAttempts
      : Array.isArray(payload.attempts)
        ? payload.attempts
        : [];
    return attempts.map(normalizeJoinAttempt).filter((attempt): attempt is NormalizedJoinAttempt => !!attempt);
  }

  async fetchPeerAnswer(joinWindow: JoinWindow, joinAttemptId: string) {
    const response = await signalFetch(
      `${EXTENSION_SCANNER_SIGNAL_URL}/join-token/${encodeURIComponent(joinWindow.joinToken)}/attempt/${encodeURIComponent(joinAttemptId)}/answer`
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { answer?: unknown };
    return normalizeSessionDescription(payload.answer);
  }

  async fetchIceServers() {
    const response = await signalFetch(`${EXTENSION_SCANNER_SIGNAL_URL}/ice-servers`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch scanner ICE servers (${response.status})`);
    }
    const iceServers = normalizeScannerIceServersResponse(await response.json());
    if (!iceServers) throw new Error("Scanner signal returned invalid ICE servers");
    return iceServers;
  }

  async postPeerOffer(joinWindow: JoinWindow, joinAttemptId: string, offer: RTCSessionDescriptionInit) {
    const response = await signalFetch(
      `${EXTENSION_SCANNER_SIGNAL_URL}/join-token/${encodeURIComponent(joinWindow.joinToken)}/attempt/${encodeURIComponent(joinAttemptId)}/offer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offer: JSON.stringify(offer),
          channels: [SCANNER_CONTROL_CHANNEL_LABEL, PHOTO_TRANSFER_CHANNEL_LABEL],
        }),
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to post scanner WebRTC offer (${response.status})`);
    }
  }

  async registerPairing(pairing: DurablePairingCredential, pushSubscription?: WebPushSubscriptionRecord | null) {
    const response = await signalFetch(`${EXTENSION_SCANNER_SIGNAL_URL}/pairings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pairingId: pairing.pairingId,
        pairingSecret: pairing.pairingSecret,
        browserSessionId: pairing.browserSessionId,
        displayName: pairing.displayName,
        pushSubscription: pushSubscription ?? undefined,
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to register scanner pairing (${response.status})`);
    }
  }

  async fetchReconnectRequests(sessionId: string) {
    const response = await signalFetch(`${EXTENSION_SCANNER_SIGNAL_URL}/pairings/reconnect-requests?sessionId=${encodeURIComponent(sessionId)}`);
    const requests: ReconnectRequest[] = [];
    if (!response.ok) return { response, requests };
    const payload = (await response.json()) as { requests?: unknown[] };
    const rawRequests = Array.isArray(payload.requests) ? payload.requests : [];
    for (const rawRequest of rawRequests) {
      if (!rawRequest || typeof rawRequest !== "object") continue;
      const request = rawRequest as { browserSessionId?: unknown; pairingId?: unknown; requestId?: unknown };
      if (typeof request.pairingId !== "string" || typeof request.requestId !== "string") continue;
      requests.push({
        browserSessionId: typeof request.browserSessionId === "string" ? request.browserSessionId : undefined,
        pairingId: request.pairingId,
        requestId: request.requestId,
      });
    }
    return { response, requests };
  }

  async postReconnectJoinWindow(
    pairing: DurablePairingCredential,
    requestId: string,
    joinWindow: JoinWindow,
    requestPairingId = pairing.pairingId
  ) {
    const response = await signalFetch(
      `${EXTENSION_SCANNER_SIGNAL_URL}/pairings/${encodeURIComponent(requestPairingId)}/reconnect/${encodeURIComponent(requestId)}/join-window`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Volt-Pairing-Secret": pairing.pairingSecret },
        body: JSON.stringify({
          answeringPairingId: pairing.pairingId,
          pairingSecret: pairing.pairingSecret,
          joinUrl: joinWindow.qrCodeUrl,
          joinToken: joinWindow.joinToken,
          sessionId: joinWindow.sessionId,
        }),
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to post scanner reconnect join window (${response.status})`);
    }
  }
}
