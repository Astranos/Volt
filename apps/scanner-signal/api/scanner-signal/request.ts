import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";

import type { JoinTokenRecord, PairingRecord } from "./storage.ts";

export function setCors(response: VercelResponse) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Volt-Browser-Claim, X-Volt-Pairing-Secret");
  response.setHeader("Cache-Control", "no-store");
}

export function pathParts(request: VercelRequest) {
  const path = request.query.path;
  return typeof path === "string" ? path.split("/").filter(Boolean) : [];
}

export function tokenRouteParts(request: VercelRequest) {
  const parts = pathParts(request);
  return parts[0] === "join-token" ? parts : [];
}

export function pairingRouteParts(request: VercelRequest) {
  const parts = pathParts(request);
  return parts[0] === "pairings" ? parts : [];
}

export function pushRouteParts(request: VercelRequest) {
  const parts = pathParts(request);
  return parts[0] === "push" ? parts : [];
}

export function requestOrigin(request: VercelRequest) {
  const proto = Array.isArray(request.headers["x-forwarded-proto"])
    ? request.headers["x-forwarded-proto"][0]
    : request.headers["x-forwarded-proto"] || "https";
  const host = Array.isArray(request.headers.host) ? request.headers.host[0] : request.headers.host || "scanner-signal.vercel.app";
  return `${proto}://${host}`;
}

export function makeSecretId(byteLength = 24) {
  return randomBytes(byteLength).toString("base64url");
}

export function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

export function stringFromBody(value: unknown, maxLength = 4000) {
  return typeof value === "string" && value ? value.slice(0, maxLength) : undefined;
}

export function stringArrayFromBody(value: unknown, maxItems = 20, maxLength = 80) {
  if (!Array.isArray(value)) return undefined;
  const strings = value
    .filter((item): item is string => typeof item === "string" && item.length > 0)
    .map((item) => item.slice(0, maxLength))
    .slice(0, maxItems);
  return strings.length ? strings : undefined;
}

export function pairingSecretFromRequest(request: VercelRequest) {
  const header = request.headers["x-volt-pairing-secret"];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value ? value : stringFromBody(request.body?.pairingSecret, 240);
}

export function requirePairingSecret(record: PairingRecord, request: VercelRequest, response: VercelResponse) {
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

export function requireJoinTokenBrowserClaim(record: JoinTokenRecord, request: VercelRequest, response: VercelResponse) {
  if (!browserClaimMatches(record, request)) {
    response.status(403).json({ error: "Browser claim required" });
    return false;
  }
  return true;
}
