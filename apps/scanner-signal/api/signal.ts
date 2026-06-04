import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";
import {
  PHOTO_RECOVERY_WINDOW_MS,
  SCANNER_SESSION_TTL_MS,
  isCaptureMode,
  isScannerSessionId,
  parseScannerRelayResult,
  parseSessionTarget,
  trimScannerRelayResults,
} from "./scanner-protocol.js";
import type { ScannerRelayResult, SessionTarget } from "./scanner-protocol.ts";
import { createPhotoObjectStore, readMemoryPhotoObject } from "./photo-object-store.js";

const SCANNER_SESSION_TTL_SECONDS = Math.ceil(SCANNER_SESSION_TTL_MS / 1000);
const PHOTO_RECOVERY_WINDOW_SECONDS = Math.ceil(PHOTO_RECOVERY_WINDOW_MS / 1000);
const JOIN_TOKEN_TTL_MS = 2 * 60 * 1000;
const JOIN_TOKEN_GRACE_MS = 10 * 1000;
const JOIN_ATTEMPT_TTL_MS = 30 * 1000;
const SESSION_KEY_PREFIX = "volt:scanner:session:";
const JOIN_TOKEN_KEY_PREFIX = "volt:scanner:join-token:";
const MAX_PHOTO_UPLOAD_BYTES = 100 * 1024 * 1024;

type ScannerSession = {
  offer?: string;
  answer?: string;
  result?: ScannerRelayResult;
  results?: ScannerRelayResult[];
  mode?: ScannerRelayResult["mode"];
  capabilities?: ScannerRelayResult["mode"][];
  target?: SessionTarget;
  connectedAt?: string;
  createdAt: number;
  browserClaim?: string;
  photoGrants?: PhotoUploadGrantRecord[];
  photos?: PhotoTransferRecord[];
};

type PhotoUploadGrantRecord = {
  id: string;
  contributorId: string;
  filename: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  objectKey: string;
  expiresAt: string;
  usedAt?: string;
  objectUrl?: string;
};

type PhotoTransferRecord = {
  id: string;
  kind: "photo";
  grantId: string;
  contributorId: string;
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  capturedAt: string;
  objectKey: string;
  downloadUrl: string;
  status: "uploaded" | "available_to_browser" | "browser_received" | "download_failed";
  browserReceivedAt?: string;
  downloadFailedAt?: string;
  downloadError?: string;
  createdAt: string;
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

const globalState = globalThis as typeof globalThis & {
  __voltScannerSessions?: Map<string, ScannerSession>;
  __voltScannerJoinTokens?: Map<string, JoinTokenRecord>;
};

const memorySessions = (globalState.__voltScannerSessions ??= new Map<string, ScannerSession>());
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

function sessionKey(sessionId: string) {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

function joinTokenKey(token: string) {
  return `${JOIN_TOKEN_KEY_PREFIX}${token}`;
}

function setCors(response: VercelResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Cache-Control", "no-store");
}

function cleanupMemorySessions() {
  const expiresBefore = Date.now() - SCANNER_SESSION_TTL_MS;
  for (const [id, session] of memorySessions.entries()) {
    if (session.createdAt < expiresBefore) {
      memorySessions.delete(id);
    }
  }
}

function cleanupMemoryJoinTokens() {
  const now = Date.now();
  for (const [token, record] of memoryJoinTokens.entries()) {
    if (record.graceExpiresAt < now && record.attempts.every((attempt) => attempt.expiresAt < now)) {
      memoryJoinTokens.delete(token);
    }
  }
}

async function getSession(sessionId: string) {
  if (hasRedisStorage()) {
    const rawSession = await redisCommand<string | null>(["GET", sessionKey(sessionId)]);
    return rawSession ? (JSON.parse(rawSession) as ScannerSession) : undefined;
  }

  cleanupMemorySessions();
  return memorySessions.get(sessionId);
}

async function saveSession(sessionId: string, session: ScannerSession) {
  if (hasRedisStorage()) {
    await redisCommand<string>([
      "SET",
      sessionKey(sessionId),
      JSON.stringify(session),
      "EX",
      session.photos?.length || session.photoGrants?.length ? PHOTO_RECOVERY_WINDOW_SECONDS : SCANNER_SESSION_TTL_SECONDS,
    ]);
    return;
  }

  cleanupMemorySessions();
  memorySessions.set(sessionId, session);
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

function sessionIdFromRequest(request: VercelRequest) {
  const path = request.query.path;
  if (typeof path === "string" && path) {
    return path.split("/")[0];
  }

  const value = request.query.sessionId;
  return Array.isArray(value) ? value[0] : value;
}

function isAnswerRequest(request: VercelRequest) {
  const path = request.query.path;
  if (typeof path === "string") {
    return path.split("/")[1] === "answer";
  }

  return request.url?.endsWith("/answer") ?? false;
}

function isResultRequest(request: VercelRequest) {
  const path = request.query.path;
  if (typeof path === "string") {
    return path.split("/")[1] === "result";
  }

  return request.url?.endsWith("/result") ?? false;
}

function isResultAckRequest(request: VercelRequest) {
  const path = request.query.path;
  if (typeof path === "string") {
    const parts = path.split("/");
    return parts[1] === "result" && parts[2] === "ack";
  }

  return request.url?.endsWith("/result/ack") ?? false;
}

function isTargetRequest(request: VercelRequest) {
  const path = request.query.path;
  if (typeof path === "string") {
    return path.split("/")[1] === "target";
  }

  return request.url?.endsWith("/target") ?? false;
}

function isConnectRequest(request: VercelRequest) {
  const path = request.query.path;
  if (typeof path === "string") {
    return path.split("/")[1] === "connect";
  }

  return request.url?.endsWith("/connect") ?? false;
}

function pathParts(request: VercelRequest) {
  const path = request.query.path;
  return typeof path === "string" ? path.split("/").filter(Boolean) : [];
}

function isPhotoGrantRequest(request: VercelRequest) {
  const parts = pathParts(request);
  return parts[1] === "photo" && parts[2] === "grant";
}

function isPhotoUploadRequest(request: VercelRequest) {
  const parts = pathParts(request);
  return parts[1] === "photo" && parts[2] === "upload" && typeof parts[3] === "string";
}

function isPhotoManifestRequest(request: VercelRequest) {
  const parts = pathParts(request);
  return parts[1] === "photo" && parts[2] === "manifest";
}

function isPhotoAckRequest(request: VercelRequest) {
  const parts = pathParts(request);
  return parts[1] === "photo" && parts[2] === "ack";
}

function isPhotoFailureRequest(request: VercelRequest) {
  const parts = pathParts(request);
  return parts[1] === "photo" && parts[2] === "failure";
}

function isPhotoObjectRequest(request: VercelRequest) {
  const parts = pathParts(request);
  return parts[0] === "photo" && parts[1] === "object" && typeof parts[2] === "string";
}

function requestOrigin(request: VercelRequest) {
  const proto = Array.isArray(request.headers["x-forwarded-proto"])
    ? request.headers["x-forwarded-proto"][0]
    : request.headers["x-forwarded-proto"] || "https";
  const host = Array.isArray(request.headers.host) ? request.headers.host[0] : request.headers.host || "scanner-signal.vercel.app";
  return `${proto}://${host}`;
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function makeSecretId(byteLength = 24) {
  return randomBytes(byteLength).toString("base64url");
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function isJoinToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{24,128}$/.test(value);
}

function isJoinAttemptId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{12,128}$/.test(value);
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

function defaultCapabilities(mode?: ScannerRelayResult["mode"]) {
  if (mode === "dictation") return ["dictation"] as ScannerRelayResult["mode"][];
  if (mode) return ["ocr", "barcode", "photo"] as ScannerRelayResult["mode"][];
  return ["ocr", "barcode", "dictation", "photo"] as ScannerRelayResult["mode"][];
}

function sanitizePathSegment(value: unknown, fallback: string) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^\w.\-]+/g, "-")
    .replace(/^\.+$/, "")
    .slice(0, 120);
  return cleaned || fallback;
}

function normalizeGrantInput(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const contributorId = typeof body.contributorId === "string" && body.contributorId ? body.contributorId.slice(0, 120) : "";
  const filename = sanitizePathSegment(body.filename, "volt-photo.jpg");
  const mimeType = typeof body.mimeType === "string" && body.mimeType.startsWith("image/") ? body.mimeType.slice(0, 80) : "";
  const size = typeof body.size === "number" ? body.size : Number(body.size);
  if (!contributorId || !mimeType || !Number.isFinite(size) || size <= 0 || size > MAX_PHOTO_UPLOAD_BYTES) return null;
  return {
    contributorId,
    filename,
    mimeType,
    size,
    width: typeof body.width === "number" && Number.isFinite(body.width) ? Math.max(0, Math.floor(body.width)) : undefined,
    height: typeof body.height === "number" && Number.isFinite(body.height) ? Math.max(0, Math.floor(body.height)) : undefined,
  };
}

function browserClaimFromRequest(request: VercelRequest) {
  const header = request.headers["x-volt-browser-claim"];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value ? value : undefined;
}

function requireBrowserClaim(session: ScannerSession, request: VercelRequest, response: VercelResponse) {
  const claim = browserClaimFromRequest(request);
  if (!session.browserClaim || !claim || claim !== session.browserClaim) {
    response.status(403).json({ error: "Browser claim required" });
    return false;
  }
  return true;
}

function makePhotoMessage(photo: PhotoTransferRecord) {
  return {
    kind: "photo" as const,
    id: photo.id,
    name: photo.name,
    mimeType: photo.mimeType,
    downloadUrl: photo.downloadUrl,
    objectKey: photo.objectKey,
    grantId: photo.grantId,
    contributorId: photo.contributorId,
    size: photo.size,
    width: photo.width,
    height: photo.height,
    capturedAt: photo.capturedAt,
    status: photo.status,
    browserReceivedAt: photo.browserReceivedAt,
    downloadFailedAt: photo.downloadFailedAt,
    downloadError: photo.downloadError,
  };
}

async function handleJoinTokenRoute(request: VercelRequest, response: VercelResponse) {
  const parts = tokenRouteParts(request);
  if (parts.length === 0) return false;

  if (request.method === "POST" && parts.length === 1) {
    const now = Date.now();
    const tokenTtlMs = clampNumber(request.body?.ttlMs, JOIN_TOKEN_TTL_MS, 1, SCANNER_SESSION_TTL_MS);
    const graceMs = clampNumber(request.body?.graceMs, JOIN_TOKEN_GRACE_MS, 0, 60 * 1000);
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
  if (!isJoinToken(token)) {
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
    const tokenTtlMs = clampNumber(request.body?.ttlMs, JOIN_TOKEN_TTL_MS, 1, SCANNER_SESSION_TTL_MS);
    const graceMs = clampNumber(request.body?.graceMs, JOIN_TOKEN_GRACE_MS, 0, 60 * 1000);
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
    const attemptTtlMs = clampNumber(request.body?.attemptTtlMs, JOIN_ATTEMPT_TTL_MS, 1, JOIN_ATTEMPT_TTL_MS);
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

  if (parts[2] !== "attempt" || !isJoinAttemptId(parts[3])) {
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

async function bodyToBlob(request: VercelRequest, mimeType: string) {
  const body = request.body;
  if (body instanceof Blob) return body;
  if (body instanceof ArrayBuffer) return new Blob([body.slice(0)], { type: mimeType });
  if (ArrayBuffer.isView(body)) {
    const bytes = new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return new Blob([copy.buffer], { type: mimeType });
  }
  if (typeof body === "string") {
    const bytes = Uint8Array.from(Buffer.from(body, "base64"));
    return new Blob([bytes.buffer], { type: mimeType });
  }
  if (body && typeof body === "object" && typeof (body as { dataUrl?: unknown }).dataUrl === "string") {
    const dataUrl = (body as { dataUrl: string }).dataUrl;
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
    return new Blob([bytes.buffer], { type: mimeType });
  }
  return null;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  setCors(response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  const sessionId = sessionIdFromRequest(request);
  const isAnswerRoute = isAnswerRequest(request);
  const isResultRoute = isResultRequest(request);
  const isResultAckRoute = isResultAckRequest(request);
  const isTargetRoute = isTargetRequest(request);
  const isConnectRoute = isConnectRequest(request);
  const isPhotoGrantRoute = isPhotoGrantRequest(request);
  const isPhotoUploadRoute = isPhotoUploadRequest(request);
  const isPhotoManifestRoute = isPhotoManifestRequest(request);
  const isPhotoAckRoute = isPhotoAckRequest(request);
  const isPhotoFailureRoute = isPhotoFailureRequest(request);

  try {
    ensureSignalStorage();

    if (await handleJoinTokenRoute(request, response)) {
      return;
    }

    if (request.method === "GET" && isPhotoObjectRequest(request)) {
      const key = decodeURIComponent(pathParts(request).slice(2).join("/"));
      const object = await readMemoryPhotoObject(key);
      if (!object) {
        response.status(404).json({ error: "Object not found" });
        return;
      }
      response.setHeader("Content-Type", object.contentType);
      response.status(200).send(Buffer.from(object.body));
      return;
    }

    if (request.method === "POST" && !sessionId) {
      const offer = request.body?.offer;
      const isRelaySession = request.body?.relay === true;
      const relayMode = isCaptureMode(request.body?.mode) ? request.body.mode : undefined;
      const browserClaim = typeof request.body?.browserClaim === "string" && request.body.browserClaim ? request.body.browserClaim : undefined;
      const target = parseSessionTarget(request.body?.target);
      if (!isRelaySession && (typeof offer !== "string" || !offer)) {
        response.status(400).json({ error: "Missing offer" });
        return;
      }
      const nextSessionId = Math.random().toString(36).slice(2, 10);
      await saveSession(nextSessionId, {
        offer: typeof offer === "string" ? offer : undefined,
        mode: relayMode,
        capabilities: defaultCapabilities(relayMode),
        target,
        browserClaim,
        createdAt: Date.now(),
      });
      response.status(200).json({ sessionId: nextSessionId, browserClaim });
      return;
    }

    if (!sessionId) {
      response.status(404).json({ error: "Not found" });
      return;
    }

    if (!isScannerSessionId(sessionId)) {
      response.status(400).json({ error: "Invalid session" });
      return;
    }

    if (
      request.method === "POST" &&
      !isAnswerRoute &&
      !isResultRoute &&
      !isTargetRoute &&
      !isConnectRoute &&
      !isPhotoGrantRoute &&
      !isPhotoUploadRoute &&
      !isPhotoManifestRoute &&
      !isPhotoAckRoute &&
      !isPhotoFailureRoute
    ) {
      const offer = request.body?.offer;
      const isRelaySession = request.body?.relay === true;
      const relayMode = isCaptureMode(request.body?.mode) ? request.body.mode : undefined;
      const browserClaim = typeof request.body?.browserClaim === "string" && request.body.browserClaim ? request.body.browserClaim : undefined;
      const target = parseSessionTarget(request.body?.target);

      if (isRelaySession) {
        await saveSession(sessionId, {
          mode: relayMode,
          capabilities: defaultCapabilities(relayMode),
          target,
          browserClaim,
          createdAt: Date.now(),
        });
        response.status(200).json({ sessionId, browserClaim });
        return;
      }

      if (typeof offer !== "string" || !offer) {
        response.status(400).json({ error: "Missing offer" });
        return;
      }

      await saveSession(sessionId, { offer, createdAt: Date.now() });
      response.status(200).json({ sessionId });
      return;
    }

    const session = await getSession(sessionId);
    if (!session) {
      response.status(404).json({ error: "Session not found" });
      return;
    }

    if (request.method === "POST" && isPhotoGrantRoute) {
      if (session.mode && session.mode !== "photo") {
        response.status(400).json({ error: "Session does not allow photo capture" });
        return;
      }
      const input = normalizeGrantInput(request.body);
      if (!input) {
        response.status(400).json({ error: "Invalid photo grant request" });
        return;
      }
      const grantId = makeId("grant");
      const expiresAt = new Date(Date.now() + PHOTO_RECOVERY_WINDOW_MS).toISOString();
      const objectKey = [
        "mobile-scanner",
        sessionId,
        grantId,
        sanitizePathSegment(input.filename, "volt-photo.jpg"),
      ].join("/");
      const origin = requestOrigin(request);
      const grant: PhotoUploadGrantRecord = {
        id: grantId,
        contributorId: input.contributorId,
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.size,
        width: input.width,
        height: input.height,
        objectKey,
        expiresAt,
      };
      await saveSession(sessionId, {
        ...session,
        mode: session.mode ?? "photo",
        capabilities: session.capabilities ?? ["photo"],
        photoGrants: [...(session.photoGrants ?? []), grant],
      });
      response.status(200).json({
        grant: {
          id: grant.id,
          uploadUrl: `${origin}/api/signal/${encodeURIComponent(sessionId)}/photo/upload/${encodeURIComponent(grant.id)}`,
          manifestUrl: `${origin}/api/signal/${encodeURIComponent(sessionId)}/photo/manifest`,
          expiresAt: grant.expiresAt,
          objectKey: grant.objectKey,
          headers: { "Content-Type": grant.mimeType },
        },
      });
      return;
    }

    if ((request.method === "POST" || request.method === "PUT") && isPhotoUploadRoute) {
      const grantId = pathParts(request)[3];
      const grants = session.photoGrants ?? [];
      const grant = grants.find((item) => item.id === grantId);
      if (!grant) {
        response.status(404).json({ error: "Photo upload grant not found" });
        return;
      }
      if (grant.usedAt) {
        response.status(409).json({ error: "Photo upload grant already used" });
        return;
      }
      if (Date.parse(grant.expiresAt) <= Date.now()) {
        response.status(410).json({ error: "Photo upload grant expired" });
        return;
      }
      const body = await bodyToBlob(request, grant.mimeType);
      if (!body || body.size <= 0 || body.size > MAX_PHOTO_UPLOAD_BYTES) {
        response.status(400).json({ error: "Invalid photo upload body" });
        return;
      }
      const store = await createPhotoObjectStore();
      const stored = await store.put({ key: grant.objectKey, body, contentType: grant.mimeType });
      const downloadUrl = stored.url.startsWith("/") ? `${requestOrigin(request)}${stored.url}` : stored.url;
      const usedAt = new Date().toISOString();
      const nextGrants = grants.map((item) =>
        item.id === grant.id ? { ...item, usedAt, objectUrl: downloadUrl } : item
      );
      await saveSession(sessionId, { ...session, photoGrants: nextGrants });
      response.status(200).json({ success: true, grantId: grant.id, objectKey: stored.key, downloadUrl });
      return;
    }

    if (request.method === "POST" && isPhotoManifestRoute) {
      const grantId = typeof request.body?.grantId === "string" ? request.body.grantId : "";
      const grants = session.photoGrants ?? [];
      const grant = grants.find((item) => item.id === grantId);
      if (!grant || !grant.usedAt || !grant.objectUrl) {
        response.status(400).json({ error: "Photo upload grant has no uploaded object" });
        return;
      }
      const photoId = typeof request.body?.id === "string" && request.body.id ? request.body.id : makeId("photo");
      const capturedAt = typeof request.body?.capturedAt === "string" ? request.body.capturedAt : new Date().toISOString();
      const photo: PhotoTransferRecord = {
        id: photoId,
        kind: "photo",
        grantId: grant.id,
        contributorId: grant.contributorId,
        name: grant.filename,
        mimeType: grant.mimeType,
        size: grant.size,
        width: grant.width,
        height: grant.height,
        capturedAt,
        objectKey: grant.objectKey,
        downloadUrl: grant.objectUrl,
        status: "available_to_browser",
        createdAt: new Date().toISOString(),
      };
      const previous = session.photos ?? [];
      const photos = [photo, ...previous.filter((item) => item.id !== photo.id)];
      await saveSession(sessionId, { ...session, mode: session.mode ?? "photo", photos });
      response.status(200).json({ success: true, photo: makePhotoMessage(photo) });
      return;
    }

    if (request.method === "GET" && isPhotoManifestRoute) {
      if (!requireBrowserClaim(session, request, response)) return;
      response.status(200).json({ photos: (session.photos ?? []).map(makePhotoMessage) });
      return;
    }

    if (request.method === "POST" && isPhotoAckRoute) {
      if (!requireBrowserClaim(session, request, response)) return;
      const ids = Array.isArray(request.body?.ids)
        ? request.body.ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
        : [];
      const receivedAt = new Date().toISOString();
      const photos = (session.photos ?? []).map((photo) =>
        ids.includes(photo.id)
          ? { ...photo, status: "browser_received" as const, browserReceivedAt: receivedAt, downloadError: undefined }
          : photo
      );
      await saveSession(sessionId, { ...session, photos });
      response.status(200).json({ success: true });
      return;
    }

    if (request.method === "POST" && isPhotoFailureRoute) {
      if (!requireBrowserClaim(session, request, response)) return;
      const id = typeof request.body?.id === "string" ? request.body.id : "";
      const error = typeof request.body?.error === "string" ? request.body.error.slice(0, 240) : "download_failed";
      const failedAt = new Date().toISOString();
      const photos = (session.photos ?? []).map((photo) =>
        photo.id === id
          ? { ...photo, status: "download_failed" as const, downloadFailedAt: failedAt, downloadError: error }
          : photo
      );
      await saveSession(sessionId, { ...session, photos });
      response.status(200).json({ success: true });
      return;
    }

    if (request.method === "POST" && isTargetRoute) {
      const target = parseSessionTarget(request.body?.target);
      await saveSession(sessionId, { ...session, target });
      response.status(200).json({ success: true, target: target ?? null });
      return;
    }

    if (request.method === "POST" && isConnectRoute) {
      const connectedAt = new Date().toISOString();
      await saveSession(sessionId, { ...session, connectedAt });
      response.status(200).json({ success: true, connectedAt });
      return;
    }

    if (request.method === "POST" && isResultAckRoute) {
      const ids = Array.isArray(request.body?.ids)
        ? request.body.ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
        : [];
      if (ids.length === 0) {
        await saveSession(sessionId, { ...session, result: undefined, results: [] });
        response.status(200).json({ success: true });
        return;
      }

      const acknowledgedIds = new Set(ids);
      const previousResults = session.results ?? (session.result ? [session.result] : []);
      const nextResults = previousResults.filter((result) => !acknowledgedIds.has(result.id));
      const nextLatest = nextResults[nextResults.length - 1];
      await saveSession(sessionId, { ...session, result: nextLatest, results: nextResults });
      response.status(200).json({ success: true });
      return;
    }

    if (request.method === "POST" && isResultRoute && !isResultAckRoute) {
      const result = parseScannerRelayResult(request.body);
      if (!result) {
        response.status(400).json({ error: "Invalid result" });
        return;
      }
      if (session.mode && result.mode !== session.mode) {
        const capabilities = session.capabilities ?? defaultCapabilities(session.mode);
        if (!capabilities.includes(result.mode)) {
          response.status(400).json({ error: "Result mode mismatch" });
          return;
        }
      }
      if (!session.mode && session.capabilities && !session.capabilities.includes(result.mode)) {
        response.status(400).json({ error: "Result mode mismatch" });
        return;
      }
      const previousResults = session.results ?? (session.result ? [session.result] : []);
      const previousResult = previousResults.find((item) => item.id === result.id);
      if (previousResult) {
          response.status(200).json({ success: true });
          return;
      }

      const nextResults = result.mode === "photo" ? [result] : trimScannerRelayResults([...previousResults, result]);
      await saveSession(sessionId, { ...session, result, results: nextResults });
      response.status(200).json({ success: true });
      return;
    }

    if (request.method === "GET" && isResultRoute && !isResultAckRoute) {
      response.status(200).json({ result: session.result ?? null, results: session.results ?? (session.result ? [session.result] : []) });
      return;
    }

    if (request.method === "GET" && !isAnswerRoute) {
      response.status(200).json({
        offer: session.offer,
        mode: session.mode,
        capabilities: session.capabilities ?? defaultCapabilities(session.mode),
        target: session.target ?? null,
        connectedAt: session.connectedAt ?? null,
      });
      return;
    }

    if (request.method === "POST" && isAnswerRoute) {
      const answer = request.body?.answer;
      if (typeof answer !== "string" || !answer) {
        response.status(400).json({ error: "Missing answer" });
        return;
      }

      await saveSession(sessionId, { ...session, answer });
      response.status(200).json({ success: true });
      return;
    }

    if (request.method === "GET" && isAnswerRoute) {
      response.status(200).json({ answer: session.answer ?? null });
      return;
    }

    response.status(404).json({ error: "Not found" });
  } catch (error) {
    console.error("Scanner signal storage error", error);
    response.status(500).json({ error: "Signal storage unavailable" });
  }
}
