import {
  PHOTO_TRANSFER_CHANNEL_LABEL,
  SCANNER_APP_PAIR_URL,
  SCANNER_CONTROL_CHANNEL_LABEL,
  SCANNER_SIGNAL_URL,
} from "../../../scanner-protocol/src";
import type { DurablePairingCredential, WebPushSubscriptionRecord } from "./mobile-scanner-identity";
import type { SessionTarget } from "./mobile-scanner-session-types";

type JoinAttempt = {
  hasAnswer?: unknown;
  id?: unknown;
  joinAttemptId?: unknown;
  answer?: unknown;
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
  constructor(private readonly ttlMs: number) {}

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
        : `${SCANNER_APP_PAIR_URL}?sessionId=${encodeURIComponent(returnedSessionId)}&session=${encodeURIComponent(returnedSessionId)}&token=${encodeURIComponent(returnedJoinToken)}&joinToken=${encodeURIComponent(returnedJoinToken)}&transport=webrtc&label=${encodeURIComponent(deviceLabel ?? "")}`;
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
    await fetch(`${SCANNER_SIGNAL_URL}/join-token/${encodeURIComponent(joinWindow.joinToken)}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: joinWindow.sessionId }),
    });
  }

  async fetchJoinAttempts(joinWindow: JoinWindow) {
    const response = await fetch(
      `${SCANNER_SIGNAL_URL}/join-token/${encodeURIComponent(joinWindow.joinToken)}/attempts`
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
    const response = await fetch(
      `${SCANNER_SIGNAL_URL}/join-token/${encodeURIComponent(joinWindow.joinToken)}/attempt/${encodeURIComponent(joinAttemptId)}/answer`
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as { answer?: unknown };
    return normalizeSessionDescription(payload.answer);
  }

  async postPeerOffer(joinWindow: JoinWindow, joinAttemptId: string, offer: RTCSessionDescriptionInit) {
    await fetch(
      `${SCANNER_SIGNAL_URL}/join-token/${encodeURIComponent(joinWindow.joinToken)}/attempt/${encodeURIComponent(joinAttemptId)}/offer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offer: JSON.stringify(offer),
          channels: [SCANNER_CONTROL_CHANNEL_LABEL, PHOTO_TRANSFER_CHANNEL_LABEL],
        }),
      }
    );
  }

  async registerPairing(pairing: DurablePairingCredential, pushSubscription?: WebPushSubscriptionRecord | null) {
    await fetch(`${SCANNER_SIGNAL_URL}/pairings`, {
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
  }

  async fetchReconnectRequests(sessionId: string) {
    const response = await fetch(`${SCANNER_SIGNAL_URL}/pairings/reconnect-requests?sessionId=${encodeURIComponent(sessionId)}`);
    const requests: ReconnectRequest[] = [];
    if (!response.ok) return { response, requests };
    const payload = (await response.json()) as { requests?: unknown[] };
    const rawRequests = Array.isArray(payload.requests) ? payload.requests : [];
    for (const rawRequest of rawRequests) {
      if (!rawRequest || typeof rawRequest !== "object") continue;
      const request = rawRequest as { pairingId?: unknown; requestId?: unknown };
      if (typeof request.pairingId !== "string" || typeof request.requestId !== "string") continue;
      requests.push({ pairingId: request.pairingId, requestId: request.requestId });
    }
    return { response, requests };
  }

  async postReconnectJoinWindow(pairing: DurablePairingCredential, requestId: string, joinWindow: JoinWindow) {
    const response = await fetch(
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
    if (!response.ok) {
      throw new Error(`Failed to post scanner reconnect join window (${response.status})`);
    }
  }
}
