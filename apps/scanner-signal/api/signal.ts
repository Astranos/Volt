import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";

const SCANNER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SCANNER_JOIN_ATTEMPT_TTL_MS = 30 * 1000;
const SCANNER_JOIN_TOKEN_TTL_MS = 5 * 60 * 1000;
const SCANNER_JOIN_TOKEN_GRACE_MS = 10 * 1000;
const SCANNER_PAIRING_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const SCANNER_RECONNECT_REQUEST_TTL_MS = 2 * 60 * 1000;
const SCANNER_SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{4,80}$/;
const SCANNER_JOIN_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{32,160}$/;
const SCANNER_JOIN_ATTEMPT_ID_PATTERN = /^[a-zA-Z0-9_-]{12,80}$/;
const SCANNER_PAIRING_ID_PATTERN = /^[a-zA-Z0-9_-]{12,120}$/;

function isScannerSessionId(value: unknown): value is string {
  return typeof value === "string" && SCANNER_SESSION_ID_PATTERN.test(value);
}

function isScannerJoinToken(value: unknown): value is string {
  return typeof value === "string" && SCANNER_JOIN_TOKEN_PATTERN.test(value);
}

function isScannerJoinAttemptId(value: unknown): value is string {
  return typeof value === "string" && SCANNER_JOIN_ATTEMPT_ID_PATTERN.test(value);
}

function isScannerPairingId(value: unknown): value is string {
  return typeof value === "string" && SCANNER_PAIRING_ID_PATTERN.test(value);
}

const JOIN_TOKEN_KEY_PREFIX = "volt:scanner:join-token:";
const PAIRING_KEY_PREFIX = "volt:scanner:pairing:";

type JoinAttemptRecord = {
  id: string;
  createdAt: number;
  expiresAt: number;
  status: "waiting_for_offer" | "offer_posted" | "answer_posted" | "expired";
  contributorId?: string;
  deviceLabel?: string;
  protocolVersion?: string;
  capabilities?: string[];
  offer?: string;
  answer?: string;
  offeredAt?: number;
  answeredAt?: number;
};

type JoinTokenRecord = {
  token: string;
  sessionId: string;
  browserClaim?: string;
  createdAt: number;
  expiresAt: number;
  graceExpiresAt: number;
  revokedAt?: number;
  rotatedTo?: string;
  attempts: JoinAttemptRecord[];
};

type ReconnectRequestRecord = {
  id: string;
  createdAt: number;
  expiresAt: number;
  status: "waiting_for_browser" | "join_window_ready" | "expired";
  joinUrl?: string;
  joinToken?: string;
  sessionId?: string;
  answeredAt?: number;
};

type PairingRecord = {
  id: string;
  secret: string;
  browserSessionId: string;
  displayName?: string;
  phoneDeviceId?: string;
  phoneLabel?: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  reconnectRequests: ReconnectRequestRecord[];
};

const globalState = globalThis as typeof globalThis & {
  __voltScannerJoinTokens?: Map<string, JoinTokenRecord>;
  __voltScannerPairings?: Map<string, PairingRecord>;
};

const memoryJoinTokens = (globalState.__voltScannerJoinTokens ??= new Map<string, JoinTokenRecord>());
const memoryPairings = (globalState.__voltScannerPairings ??= new Map<string, PairingRecord>());
const redisUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const isVercelProduction = process.env.VERCEL === "1";

function hasRedisStorage() {
  return Boolean(redisUrl && redisToken);
}

function ensureSignalStorage() {
  if (isVercelProduction && !hasRedisStorage()) {
    throw new Error("Persistent signal storage is not configured");
  }
}

async function redisCommand<T>(command: unknown[]) {
  if (!redisUrl || !redisToken) {
    throw new Error("Redis storage is not configured");
  }

  const result = await fetch(redisUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redisToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  const payload = (await result.json()) as { result?: T; error?: string };
  if (!result.ok) {
    throw new Error(`Redis command failed with ${result.status}: ${payload.error ?? "unknown error"}`);
  }
  if (payload.error) {
    throw new Error(payload.error);
  }

  return payload.result;
}

function joinTokenKey(token: string) {
  return `${JOIN_TOKEN_KEY_PREFIX}${token}`;
}

function pairingKey(pairingId: string) {
  return `${PAIRING_KEY_PREFIX}${pairingId}`;
}

function setCors(response: VercelResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Volt-Browser-Claim, X-Volt-Pairing-Secret");
  response.setHeader("Cache-Control", "no-store");
}

function cleanupMemoryJoinTokens() {
  const now = Date.now();
  for (const [token, record] of memoryJoinTokens.entries()) {
    if (record.graceExpiresAt < now && record.attempts.every((attempt) => attempt.expiresAt < now)) {
      memoryJoinTokens.delete(token);
    }
  }
}

function cleanupMemoryPairings() {
  const now = Date.now();
  for (const [pairingId, record] of memoryPairings.entries()) {
    if (record.expiresAt < now) {
      memoryPairings.delete(pairingId);
    }
  }
}

async function getJoinToken(token: string) {
  if (hasRedisStorage()) {
    const rawToken = await redisCommand<string | null>(["GET", joinTokenKey(token)]);
    return rawToken ? (JSON.parse(rawToken) as JoinTokenRecord) : undefined;
  }

  cleanupMemoryJoinTokens();
  return memoryJoinTokens.get(token);
}

async function saveJoinToken(record: JoinTokenRecord) {
  const now = Date.now();
  const latestAttemptExpiry = Math.max(0, ...record.attempts.map((attempt) => attempt.expiresAt));
  const expiresAt = Math.max(record.graceExpiresAt, latestAttemptExpiry);
  const ttlSeconds = Math.max(1, Math.ceil((expiresAt - now) / 1000));

  if (hasRedisStorage()) {
    await redisCommand<string>(["SET", joinTokenKey(record.token), JSON.stringify(record), "EX", ttlSeconds]);
    return;
  }

  cleanupMemoryJoinTokens();
  memoryJoinTokens.set(record.token, record);
}

async function getPairing(pairingId: string) {
  if (hasRedisStorage()) {
    const rawPairing = await redisCommand<string | null>(["GET", pairingKey(pairingId)]);
    return rawPairing ? (JSON.parse(rawPairing) as PairingRecord) : undefined;
  }

  cleanupMemoryPairings();
  return memoryPairings.get(pairingId);
}

async function savePairing(record: PairingRecord) {
  const now = Date.now();
  const requestExpiry = Math.max(0, ...record.reconnectRequests.map((request) => request.expiresAt));
  const expiresAt = Math.max(record.expiresAt, requestExpiry);
  const ttlSeconds = Math.max(1, Math.ceil((expiresAt - now) / 1000));

  if (hasRedisStorage()) {
    await redisCommand<string>(["SET", pairingKey(record.id), JSON.stringify(record), "EX", ttlSeconds]);
    return;
  }

  cleanupMemoryPairings();
  memoryPairings.set(record.id, record);
}

async function getPairingsForBrowserSession(browserSessionId: string) {
  if (hasRedisStorage()) {
    const keys = await redisCommand<string[]>(["KEYS", `${PAIRING_KEY_PREFIX}*`]);
    const records: PairingRecord[] = [];
    for (const key of keys ?? []) {
      const rawPairing = await redisCommand<string | null>(["GET", key]);
      if (!rawPairing) continue;
      const pairing = JSON.parse(rawPairing) as PairingRecord;
      if (pairing.browserSessionId === browserSessionId) {
        records.push(pairing);
      }
    }
    return records;
  }

  cleanupMemoryPairings();
  return [...memoryPairings.values()].filter((pairing) => pairing.browserSessionId === browserSessionId);
}

function pathParts(request: VercelRequest) {
  const path = request.query.path;
  return typeof path === "string" ? path.split("/").filter(Boolean) : [];
}

function requestOrigin(request: VercelRequest) {
  const proto = Array.isArray(request.headers["x-forwarded-proto"])
    ? request.headers["x-forwarded-proto"][0]
    : request.headers["x-forwarded-proto"] || "https";
  const host = Array.isArray(request.headers.host) ? request.headers.host[0] : request.headers.host || "scanner-signal.vercel.app";
  return `${proto}://${host}`;
}

function makeSecretId(byteLength = 24) {
  return randomBytes(byteLength).toString("base64url");
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function stringFromBody(value: unknown, maxLength = 4000) {
  return typeof value === "string" && value ? value.slice(0, maxLength) : undefined;
}

function stringArrayFromBody(value: unknown, maxItems = 20, maxLength = 80) {
  if (!Array.isArray(value)) return undefined;
  const strings = value
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .map((item) => item.slice(0, maxLength))
    .slice(0, maxItems);
  return strings.length ? strings : undefined;
}

function iso(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function tokenRouteParts(request: VercelRequest) {
  const parts = pathParts(request);
  return parts[0] === "join-token" ? parts : [];
}

function pairingRouteParts(request: VercelRequest) {
  const parts = pathParts(request);
  return parts[0] === "pairings" ? parts : [];
}

function isTokenActiveForNewAttempt(record: JoinTokenRecord, now = Date.now()) {
  return !record.revokedAt && record.expiresAt > now;
}

function normalizeJoinAttempt(record: JoinAttemptRecord, now = Date.now()): JoinAttemptRecord {
  if (record.expiresAt <= now && record.status !== "answer_posted") {
    return { ...record, status: "expired" };
  }
  return record;
}

function normalizeJoinToken(record: JoinTokenRecord, now = Date.now()): JoinTokenRecord {
  return { ...record, attempts: record.attempts.map((attempt) => normalizeJoinAttempt(attempt, now)) };
}

function normalizeReconnectRequest(record: ReconnectRequestRecord, now = Date.now()): ReconnectRequestRecord {
  if (record.expiresAt <= now && record.status === "waiting_for_browser") {
    return { ...record, status: "expired" };
  }
  return record;
}

function normalizePairing(record: PairingRecord, now = Date.now()): PairingRecord {
  return {
    ...record,
    reconnectRequests: record.reconnectRequests
      .map((request) => normalizeReconnectRequest(request, now))
      .filter((request) => request.expiresAt > now || request.status === "join_window_ready"),
  };
}

function publicToken(record: JoinTokenRecord) {
  return {
    token: record.token,
    sessionId: record.sessionId,
    expiresAt: iso(record.expiresAt),
    graceExpiresAt: iso(record.graceExpiresAt),
    revokedAt: record.revokedAt ? iso(record.revokedAt) : undefined,
    rotatedTo: record.rotatedTo,
  };
}

function publicAttempt(attempt: JoinAttemptRecord) {
  return {
    id: attempt.id,
    status: attempt.status,
    contributorId: attempt.contributorId,
    deviceLabel: attempt.deviceLabel,
    protocolVersion: attempt.protocolVersion,
    capabilities: attempt.capabilities,
    createdAt: iso(attempt.createdAt),
    expiresAt: iso(attempt.expiresAt),
    offeredAt: attempt.offeredAt ? iso(attempt.offeredAt) : undefined,
    answeredAt: attempt.answeredAt ? iso(attempt.answeredAt) : undefined,
    hasOffer: Boolean(attempt.offer),
    hasAnswer: Boolean(attempt.answer),
  };
}

function publicReconnectRequest(request: ReconnectRequestRecord) {
  return {
    id: request.id,
    status: request.status,
    createdAt: iso(request.createdAt),
    expiresAt: iso(request.expiresAt),
    joinUrl: request.joinUrl,
    joinToken: request.joinToken,
    sessionId: request.sessionId,
    answeredAt: request.answeredAt ? iso(request.answeredAt) : undefined,
  };
}

function publicPendingReconnectRequest(pairing: PairingRecord, request: ReconnectRequestRecord) {
  return {
    pairingId: pairing.id,
    requestId: request.id,
    browserSessionId: pairing.browserSessionId,
    displayName: pairing.displayName,
    phoneDeviceId: pairing.phoneDeviceId,
    phoneLabel: pairing.phoneLabel,
    createdAt: iso(request.createdAt),
    expiresAt: iso(request.expiresAt),
  };
}

function pairingSecretFromRequest(request: VercelRequest) {
  const header = request.headers["x-volt-pairing-secret"];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value ? value : stringFromBody(request.body?.pairingSecret, 240);
}

function requirePairingSecret(record: PairingRecord, request: VercelRequest, response: VercelResponse) {
  if (pairingSecretFromRequest(request) !== record.secret) {
    response.status(403).json({ error: "Pairing secret required" });
    return false;
  }
  return true;
}

function browserClaimFromRequest(request: VercelRequest) {
  const header = request.headers["x-volt-browser-claim"];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value ? value : undefined;
}

function browserClaimMatches(record: JoinTokenRecord, request: VercelRequest) {
  if (!record.browserClaim) return true;
  const claim = browserClaimFromRequest(request) ?? stringFromBody(request.body?.browserClaim, 240);
  return claim === record.browserClaim;
}

function requireJoinTokenBrowserClaim(record: JoinTokenRecord, request: VercelRequest, response: VercelResponse) {
  if (!browserClaimMatches(record, request)) {
    response.status(403).json({ error: "Browser claim required" });
    return false;
  }
  return true;
}

async function handleJoinTokenRoute(request: VercelRequest, response: VercelResponse) {
  const parts = tokenRouteParts(request);
  if (parts.length === 0) return false;

  if (request.method === "POST" && parts.length === 1) {
    const now = Date.now();
    const tokenTtlMs = clampNumber(request.body?.ttlMs, SCANNER_JOIN_TOKEN_TTL_MS, 1, SCANNER_SESSION_TTL_MS);
    const graceMs = clampNumber(request.body?.graceMs, SCANNER_JOIN_TOKEN_GRACE_MS, 0, 60 * 1000);
    const sessionId = isScannerSessionId(request.body?.sessionId) ? request.body.sessionId : makeSecretId(12);
    const browserClaim = stringFromBody(request.body?.browserClaim, 240);
    const token = makeSecretId();
    const record: JoinTokenRecord = {
      token,
      sessionId,
      browserClaim,
      createdAt: now,
      expiresAt: now + tokenTtlMs,
      graceExpiresAt: now + tokenTtlMs + graceMs,
      attempts: [],
    };
    await saveJoinToken(record);
    response.status(200).json({
      ...publicToken(record),
      browserClaim,
      joinUrl: `${requestOrigin(request)}/api/signal/join-token/${encodeURIComponent(token)}`,
    });
    return true;
  }

  const token = parts[1];
  if (!isScannerJoinToken(token)) {
    response.status(400).json({ error: "Invalid join token" });
    return true;
  }

  const existing = await getJoinToken(token);
  if (!existing) {
    response.status(404).json({ error: "Join token not found" });
    return true;
  }
  const record = normalizeJoinToken(existing);

  if (request.method === "GET" && parts.length === 2) {
    response.status(200).json({
      ...publicToken(record),
      active: isTokenActiveForNewAttempt(record),
      attempts: record.attempts.map(publicAttempt),
    });
    return true;
  }

  if (request.method === "POST" && parts[2] === "revoke" && parts.length === 3) {
    if (!requireJoinTokenBrowserClaim(record, request, response)) return true;
    const now = Date.now();
    const revoked = { ...record, revokedAt: record.revokedAt ?? now, graceExpiresAt: Math.max(record.graceExpiresAt, now) };
    await saveJoinToken(revoked);
    response.status(200).json({ success: true, ...publicToken(revoked) });
    return true;
  }

  if (request.method === "POST" && parts[2] === "rotate" && parts.length === 3) {
    if (!requireJoinTokenBrowserClaim(record, request, response)) return true;
    const now = Date.now();
    const tokenTtlMs = clampNumber(request.body?.ttlMs, SCANNER_JOIN_TOKEN_TTL_MS, 1, SCANNER_SESSION_TTL_MS);
    const graceMs = clampNumber(request.body?.graceMs, SCANNER_JOIN_TOKEN_GRACE_MS, 0, 60 * 1000);
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
    const previousRecord = {
      ...record,
      rotatedTo: nextToken,
      expiresAt: Math.min(record.expiresAt, now + graceMs),
      graceExpiresAt: Math.max(record.graceExpiresAt, now + graceMs),
    };
    await saveJoinToken(previousRecord);
    await saveJoinToken(nextRecord);
    response.status(200).json({
      previous: publicToken(previousRecord),
      token: publicToken(nextRecord),
      joinUrl: `${requestOrigin(request)}/api/signal/join-token/${encodeURIComponent(nextToken)}`,
    });
    return true;
  }

  if (request.method === "GET" && parts[2] === "attempts" && parts.length === 3) {
    if (!requireJoinTokenBrowserClaim(record, request, response)) return true;
    response.status(200).json({ attempts: record.attempts.map(publicAttempt) });
    return true;
  }

  if (request.method === "POST" && parts[2] === "attempt" && parts.length === 3) {
    if (!isTokenActiveForNewAttempt(record)) {
      response.status(410).json({ error: record.revokedAt ? "Join token revoked" : "Join token expired" });
      return true;
    }
    const now = Date.now();
    const attemptTtlMs = clampNumber(request.body?.attemptTtlMs, SCANNER_JOIN_ATTEMPT_TTL_MS, 1, SCANNER_JOIN_ATTEMPT_TTL_MS);
    const attempt: JoinAttemptRecord = {
      id: makeSecretId(18),
      createdAt: now,
      expiresAt: now + attemptTtlMs,
      status: "waiting_for_offer",
      contributorId: stringFromBody(request.body?.contributorId, 120),
      deviceLabel: stringFromBody(request.body?.deviceLabel, 120),
      protocolVersion: stringFromBody(request.body?.protocolVersion, 80),
      capabilities: stringArrayFromBody(request.body?.capabilities),
    };
    const nextRecord = { ...record, attempts: [...record.attempts, attempt] };
    await saveJoinToken(nextRecord);
    response.status(200).json({ attempt: publicAttempt(attempt), token: publicToken(nextRecord) });
    return true;
  }

  if (parts[2] !== "attempt" || !isScannerJoinAttemptId(parts[3])) {
    response.status(404).json({ error: "Not found" });
    return true;
  }

  const attemptId = parts[3];
  const route = parts[4];
  const attempt = record.attempts.find((item) => item.id === attemptId);
  if (!attempt) {
    response.status(404).json({ error: "Join attempt not found" });
    return true;
  }
  const normalizedAttempt = normalizeJoinAttempt(attempt);
  const attemptExpired = normalizedAttempt.status === "expired";

  if (route === "offer" && request.method === "POST" && parts.length === 5) {
    if (!requireJoinTokenBrowserClaim(record, request, response)) return true;
    if (attemptExpired) {
      await saveJoinToken({ ...record, attempts: record.attempts.map((item) => (item.id === attemptId ? normalizedAttempt : item)) });
      response.status(410).json({ error: "Join attempt expired" });
      return true;
    }
    const offer = stringFromBody(request.body?.offer, 200_000);
    if (!offer) {
      response.status(400).json({ error: "Missing offer" });
      return true;
    }
    const now = Date.now();
    const nextAttempt = { ...normalizedAttempt, offer, offeredAt: now, status: "offer_posted" as const };
    await saveJoinToken({ ...record, attempts: record.attempts.map((item) => (item.id === attemptId ? nextAttempt : item)) });
    response.status(200).json({ success: true, attempt: publicAttempt(nextAttempt) });
    return true;
  }

  if (route === "offer" && request.method === "GET" && parts.length === 5) {
    if (attemptExpired) {
      await saveJoinToken({ ...record, attempts: record.attempts.map((item) => (item.id === attemptId ? normalizedAttempt : item)) });
      response.status(410).json({ error: "Join attempt expired" });
      return true;
    }
    response.status(200).json({ offer: normalizedAttempt.offer ?? null, attempt: publicAttempt(normalizedAttempt) });
    return true;
  }

  if (route === "answer" && request.method === "POST" && parts.length === 5) {
    if (attemptExpired) {
      await saveJoinToken({ ...record, attempts: record.attempts.map((item) => (item.id === attemptId ? normalizedAttempt : item)) });
      response.status(410).json({ error: "Join attempt expired" });
      return true;
    }
    const answer = stringFromBody(request.body?.answer, 200_000);
    if (!answer) {
      response.status(400).json({ error: "Missing answer" });
      return true;
    }
    if (!normalizedAttempt.offer) {
      response.status(409).json({ error: "Offer required before answer" });
      return true;
    }
    const now = Date.now();
    const nextAttempt = { ...normalizedAttempt, answer, answeredAt: now, status: "answer_posted" as const };
    await saveJoinToken({ ...record, attempts: record.attempts.map((item) => (item.id === attemptId ? nextAttempt : item)) });
    response.status(200).json({ success: true, attempt: publicAttempt(nextAttempt) });
    return true;
  }

  if (route === "answer" && request.method === "GET" && parts.length === 5) {
    if (!requireJoinTokenBrowserClaim(record, request, response)) return true;
    response.status(200).json({ answer: normalizedAttempt.answer ?? null, attempt: publicAttempt(normalizedAttempt) });
    return true;
  }

  response.status(404).json({ error: "Not found" });
  return true;
}

async function handlePairingRoute(request: VercelRequest, response: VercelResponse) {
  const parts = pairingRouteParts(request);
  if (parts.length === 0) return false;

  if (request.method === "POST" && parts.length === 1) {
    const pairingId = stringFromBody(request.body?.pairingId, 120) ?? makeSecretId(18);
    const pairingSecret = stringFromBody(request.body?.pairingSecret, 240) ?? makeSecretId(32);
    const browserSessionId = stringFromBody(request.body?.browserSessionId ?? request.body?.sessionId, 120);
    if (!isScannerPairingId(pairingId)) {
      response.status(400).json({ error: "Invalid pairing id" });
      return true;
    }
    if (!isScannerJoinToken(pairingSecret)) {
      response.status(400).json({ error: "Invalid pairing secret" });
      return true;
    }
    if (!isScannerSessionId(browserSessionId)) {
      response.status(400).json({ error: "Invalid browser session id" });
      return true;
    }

    const now = Date.now();
    const existing = await getPairing(pairingId);
    if (existing && existing.secret !== pairingSecret) {
      response.status(409).json({ error: "Pairing already exists" });
      return true;
    }

    const record: PairingRecord = {
      id: pairingId,
      secret: pairingSecret,
      browserSessionId,
      displayName: stringFromBody(request.body?.displayName, 120),
      phoneDeviceId: stringFromBody(request.body?.phoneDeviceId, 120),
      phoneLabel: stringFromBody(request.body?.phoneLabel, 120),
      createdAt: existing?.createdAt ?? now,
      lastSeenAt: now,
      expiresAt: now + SCANNER_PAIRING_TTL_MS,
      reconnectRequests: existing?.reconnectRequests ?? [],
    };
    await savePairing(record);
    response.status(200).json({
      pairingId: record.id,
      browserSessionId: record.browserSessionId,
      displayName: record.displayName,
      expiresAt: iso(record.expiresAt),
    });
    return true;
  }

  if (request.method === "GET" && parts[1] === "reconnect-requests" && parts.length === 2) {
    const browserSessionId = stringFromBody(request.query.sessionId, 120);
    if (!isScannerSessionId(browserSessionId)) {
      response.status(400).json({ error: "Invalid browser session id" });
      return true;
    }
    const pending: Array<ReturnType<typeof publicPendingReconnectRequest>> = [];
    const now = Date.now();
    for (const record of await getPairingsForBrowserSession(browserSessionId)) {
      const pairing = normalizePairing(record, now);
      if (pairing.reconnectRequests.length !== record.reconnectRequests.length) {
        await savePairing(pairing);
      }
      for (const reconnectRequest of pairing.reconnectRequests) {
        if (reconnectRequest.status === "waiting_for_browser") {
          pending.push(publicPendingReconnectRequest(pairing, reconnectRequest));
        }
      }
    }
    response.status(200).json({ requests: pending });
    return true;
  }

  const pairingId = parts[1];
  if (!isScannerPairingId(pairingId)) {
    response.status(400).json({ error: "Invalid pairing id" });
    return true;
  }

  const existing = await getPairing(pairingId);
  if (!existing) {
    response.status(404).json({ error: "Pairing not found" });
    return true;
  }
  const record = normalizePairing(existing);

  if (request.method === "POST" && parts[2] === "reconnect" && parts.length === 3) {
    if (!requirePairingSecret(record, request, response)) return true;
    const now = Date.now();
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
    await savePairing(nextRecord);
    response.status(200).json({
      pairingId: record.id,
      browserSessionId: record.browserSessionId,
      request: publicReconnectRequest(reconnectRequest),
    });
    return true;
  }

  if (parts[2] !== "reconnect" || !isScannerJoinAttemptId(parts[3])) {
    response.status(404).json({ error: "Not found" });
    return true;
  }

  const requestId = parts[3];
  const reconnectRequest = record.reconnectRequests.find((item) => item.id === requestId);
  if (!reconnectRequest) {
    response.status(404).json({ error: "Reconnect request not found" });
    return true;
  }
  const normalizedRequest = normalizeReconnectRequest(reconnectRequest);

  if (request.method === "GET" && parts.length === 4) {
    if (!requirePairingSecret(record, request, response)) return true;
    if (normalizedRequest.status === "expired") {
      await savePairing({
        ...record,
        reconnectRequests: record.reconnectRequests.map((item) => (item.id === requestId ? normalizedRequest : item)),
      });
    }
    response.status(200).json({ request: publicReconnectRequest(normalizedRequest) });
    return true;
  }

  if (request.method === "POST" && parts[4] === "join-window" && parts.length === 5) {
    if (!requirePairingSecret(record, request, response)) return true;
    if (normalizedRequest.status === "expired") {
      await savePairing({
        ...record,
        reconnectRequests: record.reconnectRequests.map((item) => (item.id === requestId ? normalizedRequest : item)),
      });
      response.status(410).json({ error: "Reconnect request expired" });
      return true;
    }
    const joinUrl = stringFromBody(request.body?.joinUrl, 1000);
    const joinToken = stringFromBody(request.body?.joinToken, 240);
    const sessionId = stringFromBody(request.body?.sessionId, 120) ?? record.browserSessionId;
    if (!joinUrl || !isScannerJoinToken(joinToken) || !isScannerSessionId(sessionId)) {
      response.status(400).json({ error: "Invalid join window" });
      return true;
    }
    const now = Date.now();
    const nextRequest: ReconnectRequestRecord = {
      ...normalizedRequest,
      status: "join_window_ready",
      joinUrl,
      joinToken,
      sessionId,
      answeredAt: now,
    };
    await savePairing({
      ...record,
      lastSeenAt: now,
      reconnectRequests: record.reconnectRequests.map((item) => (item.id === requestId ? nextRequest : item)),
    });
    response.status(200).json({ success: true, request: publicReconnectRequest(nextRequest) });
    return true;
  }

  response.status(404).json({ error: "Not found" });
  return true;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  setCors(response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  try {
    ensureSignalStorage();

    if (await handleJoinTokenRoute(request, response)) {
      return;
    }

    if (await handlePairingRoute(request, response)) {
      return;
    }

    response.status(404).json({ error: "Not found" });
  } catch (error) {
    console.error("Scanner signal storage error", error);
    response.status(500).json({ error: "Signal storage unavailable" });
  }
}
