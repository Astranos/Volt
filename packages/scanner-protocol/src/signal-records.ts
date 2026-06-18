export type ScannerJoinAttemptStatus = "waiting_for_offer" | "offer_posted" | "answer_posted" | "expired";

export type ScannerJoinAttemptRecord = {
  id: string;
  createdAt: number;
  expiresAt: number;
  status: ScannerJoinAttemptStatus;
  contributorId?: string;
  deviceLabel?: string;
  protocolVersion?: string;
  capabilities?: string[];
  offer?: string;
  answer?: string;
  offeredAt?: number;
  answeredAt?: number;
};

export type ScannerJoinTokenRecord = {
  token: string;
  sessionId: string;
  browserClaim?: string;
  createdAt: number;
  expiresAt: number;
  graceExpiresAt: number;
  revokedAt?: number;
  rotatedTo?: string;
  attempts: ScannerJoinAttemptRecord[];
};

export type ScannerReconnectRequestStatus = "waiting_for_browser" | "join_window_ready" | "expired";

export type ScannerReconnectRequestRecord = {
  id: string;
  createdAt: number;
  expiresAt: number;
  status: ScannerReconnectRequestStatus;
  joinUrl?: string;
  joinToken?: string;
  sessionId?: string;
  answeredAt?: number;
};

export type ScannerWebPushSubscription = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
};

export type ScannerPairingRecord = {
  id: string;
  secret: string;
  browserSessionId: string;
  displayName?: string;
  phoneDeviceId?: string;
  phoneLabel?: string;
  pushSubscription?: ScannerWebPushSubscription;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  reconnectRequests: ScannerReconnectRequestRecord[];
};

export type PublicScannerJoinToken = {
  token: string;
  sessionId: string;
  expiresAt: string;
  graceExpiresAt: string;
  revokedAt?: string;
  rotatedTo?: string;
};

export type PublicScannerJoinAttempt = {
  id: string;
  status: ScannerJoinAttemptStatus;
  contributorId?: string;
  deviceLabel?: string;
  protocolVersion?: string;
  capabilities?: string[];
  createdAt: string;
  expiresAt: string;
  offeredAt?: string;
  answeredAt?: string;
  hasOffer: boolean;
  hasAnswer: boolean;
};

export type PublicScannerReconnectRequest = {
  id: string;
  status: ScannerReconnectRequestStatus;
  createdAt: string;
  expiresAt: string;
  joinUrl?: string;
  joinToken?: string;
  sessionId?: string;
  answeredAt?: string;
};

export type PublicPendingScannerReconnectRequest = {
  pairingId: string;
  requestId: string;
  browserSessionId: string;
  displayName?: string;
  phoneDeviceId?: string;
  phoneLabel?: string;
  createdAt: string;
  expiresAt: string;
};

export function scannerSignalIso(timestamp: number) {
  return new Date(timestamp).toISOString();
}

export function isScannerJoinTokenActiveForNewAttempt(record: ScannerJoinTokenRecord, now = Date.now()) {
  return !record.revokedAt && record.expiresAt > now;
}

export function normalizeScannerJoinAttempt(
  record: ScannerJoinAttemptRecord,
  now = Date.now()
): ScannerJoinAttemptRecord {
  if (record.expiresAt <= now && record.status !== "answer_posted") {
    return { ...record, status: "expired" };
  }
  return record;
}

export function normalizeScannerJoinToken(record: ScannerJoinTokenRecord, now = Date.now()): ScannerJoinTokenRecord {
  return { ...record, attempts: record.attempts.map((attempt) => normalizeScannerJoinAttempt(attempt, now)) };
}

export function normalizeScannerReconnectRequest(
  record: ScannerReconnectRequestRecord,
  now = Date.now()
): ScannerReconnectRequestRecord {
  if (record.expiresAt <= now && record.status === "waiting_for_browser") {
    return { ...record, status: "expired" };
  }
  return record;
}

export function normalizeScannerPairing(record: ScannerPairingRecord, now = Date.now()): ScannerPairingRecord {
  return {
    ...record,
    reconnectRequests: record.reconnectRequests
      .map((request) => normalizeScannerReconnectRequest(request, now))
      .filter((request) => request.expiresAt > now || request.status === "join_window_ready"),
  };
}

export function publicScannerJoinToken(record: ScannerJoinTokenRecord): PublicScannerJoinToken {
  return {
    token: record.token,
    sessionId: record.sessionId,
    expiresAt: scannerSignalIso(record.expiresAt),
    graceExpiresAt: scannerSignalIso(record.graceExpiresAt),
    revokedAt: record.revokedAt ? scannerSignalIso(record.revokedAt) : undefined,
    rotatedTo: record.rotatedTo,
  };
}

export function publicScannerJoinAttempt(attempt: ScannerJoinAttemptRecord): PublicScannerJoinAttempt {
  return {
    id: attempt.id,
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
  };
}

export function publicScannerReconnectRequest(
  request: ScannerReconnectRequestRecord
): PublicScannerReconnectRequest {
  return {
    id: request.id,
    status: request.status,
    createdAt: scannerSignalIso(request.createdAt),
    expiresAt: scannerSignalIso(request.expiresAt),
    joinUrl: request.joinUrl,
    joinToken: request.joinToken,
    sessionId: request.sessionId,
    answeredAt: request.answeredAt ? scannerSignalIso(request.answeredAt) : undefined,
  };
}

export function publicPendingScannerReconnectRequest(
  pairing: ScannerPairingRecord,
  request: ScannerReconnectRequestRecord
): PublicPendingScannerReconnectRequest {
  return {
    pairingId: pairing.id,
    requestId: request.id,
    browserSessionId: pairing.browserSessionId,
    displayName: pairing.displayName,
    phoneDeviceId: pairing.phoneDeviceId,
    phoneLabel: pairing.phoneLabel,
    createdAt: scannerSignalIso(request.createdAt),
    expiresAt: scannerSignalIso(request.expiresAt),
  };
}
