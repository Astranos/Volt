import {
  SCANNER_JOIN_ATTEMPT_TTL_MS,
  SCANNER_JOIN_TOKEN_GRACE_MS,
  SCANNER_JOIN_TOKEN_TTL_MS,
  SCANNER_PAIRING_TTL_MS,
  SCANNER_RECONNECT_REQUEST_TTL_MS,
  SCANNER_SESSION_TTL_MS,
  type ScannerJoinAttemptRecord,
  type ScannerReconnectRequestRecord,
  isScannerSessionId,
  normalizeScannerJoinAttempt,
  normalizeScannerPairing,
  normalizeScannerReconnectRequest,
} from "../../../../packages/scanner-protocol/src/index.ts";
import type { WebPushSubscriptionRecord } from "./push.ts";
import { clampNumber, makeSecretId, stringArrayFromBody, stringFromBody } from "./request.ts";
import type { JoinTokenRecord, PairingRecord } from "./storage.ts";

export type JoinAttemptRecord = ScannerJoinAttemptRecord;
export type ReconnectRequestRecord = ScannerReconnectRequestRecord;

export function createJoinTokenRecord(body: Record<string, unknown>, now = Date.now()) {
  const tokenTtlMs = clampNumber(body.ttlMs, SCANNER_JOIN_TOKEN_TTL_MS, 1, SCANNER_SESSION_TTL_MS);
  const graceMs = clampNumber(body.graceMs, SCANNER_JOIN_TOKEN_GRACE_MS, 0, 60 * 1000);
  return {
    record: {
      token: makeSecretId(),
      sessionId: isScannerSessionId(body.sessionId) ? body.sessionId : makeSecretId(12),
      browserClaim: stringFromBody(body.browserClaim, 240),
      createdAt: now,
      expiresAt: now + tokenTtlMs,
      graceExpiresAt: now + tokenTtlMs + graceMs,
      attempts: [],
    } satisfies JoinTokenRecord,
  };
}

export function revokeJoinToken(record: JoinTokenRecord, now = Date.now()) {
  return { ...record, revokedAt: record.revokedAt ?? now, graceExpiresAt: Math.max(record.graceExpiresAt, now) };
}

export function rotateJoinToken(record: JoinTokenRecord, body: Record<string, unknown>, now = Date.now()) {
  const tokenTtlMs = clampNumber(body.ttlMs, SCANNER_JOIN_TOKEN_TTL_MS, 1, SCANNER_SESSION_TTL_MS);
  const graceMs = clampNumber(body.graceMs, SCANNER_JOIN_TOKEN_GRACE_MS, 0, 60 * 1000);
  const nextToken = makeSecretId();
  const nextRecord: JoinTokenRecord = {
    token: nextToken,
    sessionId: record.sessionId,
    browserClaim: record.browserClaim,
    createdAt: now,
    expiresAt: now + tokenTtlMs,
    graceExpiresAt: now + tokenTtlMs + graceMs,
    attempts: [],
  };
  const previousRecord: JoinTokenRecord = {
    ...record,
    rotatedTo: nextToken,
    expiresAt: Math.min(record.expiresAt, now + graceMs),
    graceExpiresAt: Math.max(record.graceExpiresAt, now + graceMs),
  };
  return { previousRecord, nextRecord };
}

export function appendJoinAttempt(record: JoinTokenRecord, body: Record<string, unknown>, now = Date.now()) {
  const attemptTtlMs = clampNumber(body.attemptTtlMs, SCANNER_JOIN_ATTEMPT_TTL_MS, 1, SCANNER_JOIN_ATTEMPT_TTL_MS);
  const attempt: JoinAttemptRecord = {
    id: makeSecretId(18),
    createdAt: now,
    expiresAt: now + attemptTtlMs,
    status: "waiting_for_offer",
    contributorId: stringFromBody(body.contributorId, 120),
    deviceLabel: stringFromBody(body.deviceLabel, 120),
    protocolVersion: stringFromBody(body.protocolVersion, 80),
    capabilities: stringArrayFromBody(body.capabilities),
  };
  return { nextRecord: { ...record, attempts: [...record.attempts, attempt] }, attempt };
}

export function refreshJoinAttemptExpiry(record: JoinTokenRecord, attemptId: string) {
  const attempt = record.attempts.find((item) => item.id === attemptId);
  if (!attempt) return { attempt: undefined, nextRecord: record, changed: false };
  const normalizedAttempt = normalizeScannerJoinAttempt(attempt);
  const changed = normalizedAttempt.status !== attempt.status;
  return {
    attempt: normalizedAttempt,
    nextRecord: changed ? replaceJoinAttempt(record, attemptId, normalizedAttempt) : record,
    changed,
  };
}

export function postJoinOffer(record: JoinTokenRecord, attempt: JoinAttemptRecord, offer: string, now = Date.now()) {
  const nextAttempt = { ...attempt, offer, offeredAt: now, status: "offer_posted" as const };
  return { nextAttempt, nextRecord: replaceJoinAttempt(record, attempt.id, nextAttempt) };
}

export function postJoinAnswer(record: JoinTokenRecord, attempt: JoinAttemptRecord, answer: string, now = Date.now()) {
  const nextAttempt = { ...attempt, answer, answeredAt: now, status: "answer_posted" as const };
  return { nextAttempt, nextRecord: replaceJoinAttempt(record, attempt.id, nextAttempt) };
}

function replaceJoinAttempt(record: JoinTokenRecord, attemptId: string, nextAttempt: JoinAttemptRecord) {
  return {
    ...record,
    attempts: record.attempts.map((item) => (item.id === attemptId ? nextAttempt : item)),
  };
}

export function upsertPairingRecord(
  existing: PairingRecord | undefined,
  input: {
    pairingId: string;
    pairingSecret: string;
    browserSessionId: string;
    body: Record<string, unknown>;
    pushSubscription?: WebPushSubscriptionRecord;
  },
  now = Date.now()
) {
  return {
    id: input.pairingId,
    secret: input.pairingSecret,
    browserSessionId: input.browserSessionId,
    displayName: stringFromBody(input.body.displayName, 120),
    phoneDeviceId: stringFromBody(input.body.phoneDeviceId, 120),
    phoneLabel: stringFromBody(input.body.phoneLabel, 120),
    pushSubscription: input.pushSubscription ?? existing?.pushSubscription,
    createdAt: existing?.createdAt ?? now,
    lastSeenAt: now,
    expiresAt: now + SCANNER_PAIRING_TTL_MS,
    reconnectRequests: existing?.reconnectRequests ?? [],
  } satisfies PairingRecord;
}

export function normalizePairingsForPendingReconnect(records: PairingRecord[], now = Date.now()) {
  return records.map((record) => {
    const pairing = normalizeScannerPairing(record, now);
    return { pairing, changed: pairing.reconnectRequests.length !== record.reconnectRequests.length };
  });
}

export function appendReconnectRequest(record: PairingRecord, now = Date.now()) {
  const reconnectRequest: ReconnectRequestRecord = {
    id: makeSecretId(18),
    createdAt: now,
    expiresAt: now + SCANNER_RECONNECT_REQUEST_TTL_MS,
    status: "waiting_for_browser",
  };
  const nextRecord = {
    ...record,
    lastSeenAt: now,
    reconnectRequests: [...record.reconnectRequests, reconnectRequest],
  };
  return { nextRecord, reconnectRequest };
}

export function refreshReconnectRequestExpiry(record: PairingRecord, requestId: string) {
  const reconnectRequest = record.reconnectRequests.find((item) => item.id === requestId);
  if (!reconnectRequest) return { reconnectRequest: undefined, nextRecord: record, changed: false };
  const normalizedRequest = normalizeScannerReconnectRequest(reconnectRequest);
  const changed = normalizedRequest.status !== reconnectRequest.status;
  return {
    reconnectRequest: normalizedRequest,
    nextRecord: changed ? replaceReconnectRequest(record, requestId, normalizedRequest) : record,
    changed,
  };
}

export function postReconnectJoinWindow(
  record: PairingRecord,
  reconnectRequest: ReconnectRequestRecord,
  input: { joinUrl: string; joinToken: string; sessionId: string },
  now = Date.now()
) {
  const nextRequest: ReconnectRequestRecord = {
    ...reconnectRequest,
    status: "join_window_ready",
    joinUrl: input.joinUrl,
    joinToken: input.joinToken,
    sessionId: input.sessionId,
    answeredAt: now,
  };
  return {
    nextRequest,
    nextRecord: {
      ...record,
      lastSeenAt: now,
      reconnectRequests: record.reconnectRequests.map((item) => (item.id === reconnectRequest.id ? nextRequest : item)),
    },
  };
}

function replaceReconnectRequest(
  record: PairingRecord,
  requestId: string,
  nextRequest: ReconnectRequestRecord
) {
  return {
    ...record,
    reconnectRequests: record.reconnectRequests.map((item) => (item.id === requestId ? nextRequest : item)),
  };
}
