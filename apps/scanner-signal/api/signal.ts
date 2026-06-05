import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";
import {
  SCANNER_JOIN_ATTEMPT_TTL_MS,
  SCANNER_JOIN_TOKEN_GRACE_MS,
  SCANNER_JOIN_TOKEN_TTL_MS,
  SCANNER_SESSION_TTL_MS,
  isScannerJoinAttemptId,
  isScannerJoinToken,
  isScannerSessionId,
} from "../../../packages/scanner-protocol/src/index.ts";

const JOIN_TOKEN_KEY_PREFIX = "volt:scanner:join-token:";

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

const globalState = globalThis as typeof globalThis & {
  __voltScannerJoinTokens?: Map<string, JoinTokenRecord>;
};

const memoryJoinTokens = (globalState.__voltScannerJoinTokens ??= new Map<string, JoinTokenRecord>());
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

  if (!result.ok) {
    throw new Error(`Redis command failed with ${result.status}`);
  }

  const payload = (await result.json()) as { result?: T; error?: string };
  if (payload.error) {
    throw new Error(payload.error);
  }

  return payload.result;
}

function joinTokenKey(token: string) {
  return `${JOIN_TOKEN_KEY_PREFIX}${token}`;
}

function setCors(response: VercelResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Volt-Browser-Claim");
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
    await saveJoinToken(record);
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
    const nextRecord = { ...record, attempts: record.attempts.map((item) => (item.id === attemptId ? normalizedAttempt : item)) };
    await saveJoinToken(nextRecord);
    response.status(200).json({ answer: normalizedAttempt.answer ?? null, attempt: publicAttempt(normalizedAttempt) });
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

    response.status(404).json({ error: "Not found" });
  } catch (error) {
    console.error("Scanner signal storage error", error);
    response.status(500).json({ error: "Signal storage unavailable" });
  }
}
