import { SCANNER_APP_PAIR_URL } from "./constants.ts";
import { isScannerJoinAttemptId, isScannerJoinToken, isScannerSessionId } from "./ids.ts";

export type ScannerSessionDescription = {
  type: "offer" | "answer" | "pranswer" | "rollback";
  sdp: string;
};

export type ScannerJoinUrlParts = {
  baseUrl?: string;
  signalUrl?: string;
  token: string;
  sessionId?: string;
  joinAttemptId?: string;
};

export function encodePairingPayload(description: ScannerSessionDescription): string {
  return btoa(JSON.stringify(description))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function decodePairingPayload(payload: string): ScannerSessionDescription {
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  return JSON.parse(atob(padded));
}

export function buildScannerJoinUrl(parts: ScannerJoinUrlParts): string {
  if (!isScannerJoinToken(parts.token)) {
    throw new Error("Invalid scanner join token");
  }
  if (parts.sessionId !== undefined && !isScannerSessionId(parts.sessionId)) {
    throw new Error("Invalid scanner session id");
  }
  if (parts.joinAttemptId !== undefined && !isScannerJoinAttemptId(parts.joinAttemptId)) {
    throw new Error("Invalid scanner join attempt id");
  }

  const url = new URL(parts.baseUrl ?? SCANNER_APP_PAIR_URL);
  url.searchParams.set("token", parts.token);
  if (parts.sessionId) url.searchParams.set("sessionId", parts.sessionId);
  if (parts.joinAttemptId) url.searchParams.set("joinAttemptId", parts.joinAttemptId);
  if (parts.signalUrl) url.searchParams.set("signalUrl", parts.signalUrl);
  return url.toString();
}

export function parseScannerJoinUrl(value: string): ScannerJoinUrlParts | null {
  try {
    const url = new URL(value);
    const token = url.searchParams.get("token");
    const signalUrl = url.searchParams.get("signalUrl") ?? undefined;
    const sessionId = url.searchParams.get("sessionId") ?? undefined;
    const joinAttemptId = url.searchParams.get("joinAttemptId") ?? undefined;
    if (!isScannerJoinToken(token)) return null;
    if (sessionId !== undefined && !isScannerSessionId(sessionId)) return null;
    if (joinAttemptId !== undefined && !isScannerJoinAttemptId(joinAttemptId)) return null;
    return {
      baseUrl: `${url.protocol}//${url.host}${url.pathname}`,
      signalUrl,
      token,
      sessionId,
      joinAttemptId,
    };
  } catch (_error) {
    return null;
  }
}
