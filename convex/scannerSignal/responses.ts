import type { Doc } from "../_generated/dataModel";
import { scannerSignalIso } from "@volt/scanner-protocol";

export function compact<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function publicJoinToken(token: Doc<"scannerJoinTokens">) {
  return compact({
    token: token.token,
    sessionId: token.sessionId,
    expiresAt: scannerSignalIso(token.expiresAt),
    graceExpiresAt: scannerSignalIso(token.graceExpiresAt),
    revokedAt: token.revokedAt ? scannerSignalIso(token.revokedAt) : undefined,
    rotatedTo: token.rotatedTo,
  });
}

export function publicJoinAttempt(attempt: Doc<"scannerJoinAttempts">) {
  return compact({
    id: attempt.attemptId,
    status: attempt.status,
    contributorId: attempt.contributorId,
    deviceLabel: attempt.deviceLabel,
    protocolVersion: attempt.protocolVersion,
    capabilities: attempt.capabilities,
    createdAt: scannerSignalIso(attempt.createdAt),
    expiresAt: scannerSignalIso(attempt.expiresAt),
    offeredAt: attempt.offeredAt ? scannerSignalIso(attempt.offeredAt) : undefined,
    answeredAt: attempt.answeredAt ? scannerSignalIso(attempt.answeredAt) : undefined,
    hasOffer: Boolean(attempt.offer),
    hasAnswer: Boolean(attempt.answer),
  });
}

export function publicReconnectRequest(request: Doc<"scannerReconnectRequests">) {
  return compact({
    id: request.requestId,
    status: request.status,
    createdAt: scannerSignalIso(request.createdAt),
    expiresAt: scannerSignalIso(request.expiresAt),
    joinUrl: request.joinUrl,
    joinToken: request.joinToken,
    sessionId: request.sessionId,
    answeredAt: request.answeredAt ? scannerSignalIso(request.answeredAt) : undefined,
  });
}

export function publicPendingReconnectRequest(
  pairing: Doc<"scannerPairings">,
  request: Doc<"scannerReconnectRequests">,
) {
  return compact({
    pairingId: pairing.pairingId,
    requestId: request.requestId,
    browserSessionId: pairing.browserSessionId,
    displayName: pairing.displayName,
    phoneDeviceId: pairing.phoneDeviceId,
    phoneLabel: pairing.phoneLabel,
    createdAt: scannerSignalIso(request.createdAt),
    expiresAt: scannerSignalIso(request.expiresAt),
  });
}
