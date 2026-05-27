import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  SCANNER_SESSION_TTL_MS,
  isCaptureMode,
  isScannerSessionId,
  parseScannerRelayResult,
  parseSessionTarget,
  trimScannerRelayResults,
  type ScannerRelayResult,
  type SessionTarget,
} from "../../../packages/scanner-protocol/src/index.ts";

const SCANNER_SESSION_TTL_SECONDS = Math.ceil(SCANNER_SESSION_TTL_MS / 1000);
const SESSION_KEY_PREFIX = "volt:scanner:session:";

type ScannerSession = {
  offer?: string;
  answer?: string;
  result?: ScannerRelayResult;
  results?: ScannerRelayResult[];
  mode?: ScannerRelayResult["mode"];
  target?: SessionTarget;
  connectedAt?: string;
  createdAt: number;
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
      SCANNER_SESSION_TTL_SECONDS,
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

  try {
    ensureSignalStorage();

    if (request.method === "POST" && !sessionId) {
      const offer = request.body?.offer;
      const isRelaySession = request.body?.relay === true;
      const relayMode = isCaptureMode(request.body?.mode) ? request.body.mode : undefined;
      const target = parseSessionTarget(request.body?.target);
      if (!isRelaySession && (typeof offer !== "string" || !offer)) {
        response.status(400).json({ error: "Missing offer" });
        return;
      }
      const nextSessionId = Math.random().toString(36).slice(2, 10);
      await saveSession(nextSessionId, {
        offer: typeof offer === "string" ? offer : undefined,
        mode: relayMode,
        target,
        createdAt: Date.now(),
      });
      response.status(200).json({ sessionId: nextSessionId });
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

    if (request.method === "POST" && !isAnswerRoute && !isResultRoute && !isTargetRoute && !isConnectRoute) {
      const offer = request.body?.offer;
      const isRelaySession = request.body?.relay === true;
      const relayMode = isCaptureMode(request.body?.mode) ? request.body.mode : undefined;
      const target = parseSessionTarget(request.body?.target);

      if (isRelaySession) {
        await saveSession(sessionId, {
          mode: relayMode,
          target,
          createdAt: Date.now(),
        });
        response.status(200).json({ sessionId });
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
