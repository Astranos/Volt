import type { VercelRequest, VercelResponse } from "@vercel/node";
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
const SESSION_KEY_PREFIX = "volt:scanner:session:";
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

const globalState = globalThis as typeof globalThis & {
  __voltScannerSessions?: Map<string, ScannerSession>;
};

const memorySessions = (globalState.__voltScannerSessions ??= new Map<string, ScannerSession>());
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
