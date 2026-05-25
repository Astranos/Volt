import type { VercelRequest, VercelResponse } from "@vercel/node";

const SCANNER_SESSION_TTL_MS = 30 * 60 * 1000;
const SCANNER_SESSION_TTL_SECONDS = Math.ceil(SCANNER_SESSION_TTL_MS / 1000);
const SESSION_KEY_PREFIX = "volt:scanner:session:";
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{4,80}$/;

type ScannerSession = {
  offer?: string;
  answer?: string;
  result?: ScannerResult;
  results?: ScannerResult[];
  mode?: ScannerResult["mode"];
  target?: SessionTarget;
  createdAt: number;
};

type SessionTarget = {
  browser?: string;
  tabTitle?: string;
  url?: string;
  cursor?: string;
};

type ScannerResult = {
  id: string;
  mode: "ocr" | "barcode" | "dictation" | "photo";
  message: (
    {
    barcode: string;
    dictationPhase?: "partial" | "final";
    dictationSessionId?: string;
    format?: string;
    insertIntoCursor?: boolean;
    kind?: "barcode" | "text";
    scannedAt?: string;
    } | {
      kind: "photo";
      id: string;
      name: string;
      mimeType: string;
      dataUrl: string;
      size: number;
      width?: number;
      height?: number;
      capturedAt?: string;
    }
  );
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

function isCaptureMode(value: unknown): value is ScannerResult["mode"] {
  return value === "ocr" || value === "barcode" || value === "dictation" || value === "photo";
}

function clampTargetString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function parseSessionTarget(value: unknown): SessionTarget | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const target = {
    browser: clampTargetString(source.browser, 80),
    tabTitle: clampTargetString(source.tabTitle, 160),
    url: clampTargetString(source.url, 600),
    cursor: clampTargetString(source.cursor, 120),
  };
  return Object.values(target).some(Boolean) ? target : undefined;
}

function isValidResultForMode(mode: ScannerResult["mode"], message: ScannerResult["message"]) {
  if (mode === "photo") {
    return message.kind === "photo";
  }
  if (message.kind === "photo") return false;

  if (mode === "ocr") {
    return message.kind === "text" && message.format === "live-text";
  }

  if (mode === "barcode") {
    return message.kind === "barcode";
  }

  return (
    message.kind === "text" &&
    message.format === "dictation" &&
    message.dictationPhase === "final" &&
    typeof message.dictationSessionId === "string" &&
    message.dictationSessionId.length > 0
  );
}

function parseScannerResult(body: unknown): ScannerResult | null {
  if (!body || typeof body !== "object") return null;
  const value = body as {
    id?: unknown;
    mode?: unknown;
    message?: unknown;
  };
  const message = value.message as ScannerResult["message"] | undefined;
  if (
    typeof value.id !== "string" ||
    !value.id ||
    !isCaptureMode(value.mode) ||
    !message ||
    typeof message !== "object"
  ) {
    return null;
  }

  if (message.kind === "photo") {
    if (
      typeof message.id !== "string" ||
      typeof message.name !== "string" ||
      typeof message.mimeType !== "string" ||
      typeof message.dataUrl !== "string" ||
      !message.dataUrl.startsWith("data:image/") ||
      typeof message.size !== "number"
    ) {
      return null;
    }

    const result: ScannerResult = {
      id: value.id,
      mode: value.mode,
      message: {
        kind: "photo",
        id: message.id,
        name: message.name,
        mimeType: message.mimeType,
        dataUrl: message.dataUrl,
        size: message.size,
        width: typeof message.width === "number" ? message.width : undefined,
        height: typeof message.height === "number" ? message.height : undefined,
        capturedAt: typeof message.capturedAt === "string" ? message.capturedAt : undefined,
      },
      createdAt: new Date().toISOString(),
    };

    return isValidResultForMode(result.mode, result.message) ? result : null;
  }

  if (typeof message.barcode !== "string" || !message.barcode) return null;

  const result: ScannerResult = {
    id: value.id,
    mode: value.mode,
    message: {
      barcode: message.barcode,
      dictationPhase:
        message.dictationPhase === "partial" || message.dictationPhase === "final"
          ? message.dictationPhase
          : undefined,
      dictationSessionId:
        typeof message.dictationSessionId === "string"
          ? message.dictationSessionId
          : undefined,
      format: typeof message.format === "string" ? message.format : undefined,
      insertIntoCursor:
        typeof message.insertIntoCursor === "boolean"
          ? message.insertIntoCursor
          : undefined,
      kind: message.kind === "text" ? "text" : "barcode",
      scannedAt: typeof message.scannedAt === "string" ? message.scannedAt : undefined,
    },
    createdAt: new Date().toISOString(),
  };

  return isValidResultForMode(result.mode, result.message) ? result : null;
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

    if (!SESSION_ID_PATTERN.test(sessionId)) {
      response.status(400).json({ error: "Invalid session" });
      return;
    }

    if (request.method === "POST" && !isAnswerRoute && !isResultRoute) {
      const offer = request.body?.offer;
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

    if (request.method === "POST" && isResultRoute) {
      const result = parseScannerResult(request.body);
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

      const nextResults = [...previousResults, result].slice(-100);
      await saveSession(sessionId, { ...session, result, results: nextResults });
      response.status(200).json({ success: true });
      return;
    }

    if (request.method === "GET" && isResultRoute) {
      response.status(200).json({ result: session.result ?? null, results: session.results ?? (session.result ? [session.result] : []) });
      return;
    }

    if (request.method === "GET" && !isAnswerRoute) {
      response.status(200).json({ offer: session.offer, mode: session.mode, target: session.target ?? null });
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
