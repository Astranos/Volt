import type { VercelRequest, VercelResponse } from "@vercel/node";

const SCANNER_SESSION_TTL_MS = 5 * 60 * 1000;

type ScannerSession = {
  offer?: string;
  answer?: string;
  createdAt: number;
};

const sessions = new Map<string, ScannerSession>();

function setCors(response: VercelResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function cleanup() {
  const expiresBefore = Date.now() - SCANNER_SESSION_TTL_MS;
  for (const [id, session] of sessions.entries()) {
    if (session.createdAt < expiresBefore) {
      sessions.delete(id);
    }
  }
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

export default function handler(request: VercelRequest, response: VercelResponse) {
  setCors(response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  cleanup();

  const sessionId = sessionIdFromRequest(request);
  const isAnswerRoute = isAnswerRequest(request);

  if (request.method === "POST" && !sessionId) {
    const offer = request.body?.offer;
    if (typeof offer !== "string" || !offer) {
      response.status(400).json({ error: "Missing offer" });
      return;
    }

    const nextSessionId = Math.random().toString(36).slice(2, 10);
    sessions.set(nextSessionId, { offer, createdAt: Date.now() });
    response.status(200).json({ sessionId: nextSessionId });
    return;
  }

  if (!sessionId) {
    response.status(404).json({ error: "Not found" });
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    response.status(404).json({ error: "Session not found" });
    return;
  }

  if (request.method === "GET" && !isAnswerRoute) {
    response.status(200).json({ offer: session.offer });
    return;
  }

  if (request.method === "POST" && isAnswerRoute) {
    const answer = request.body?.answer;
    if (typeof answer !== "string" || !answer) {
      response.status(400).json({ error: "Missing answer" });
      return;
    }

    session.answer = answer;
    sessions.set(sessionId, session);
    response.status(200).json({ success: true });
    return;
  }

  if (request.method === "GET" && isAnswerRoute) {
    response.status(200).json({ answer: session.answer ?? null });
    return;
  }

  response.status(404).json({ error: "Not found" });
}
