import {
  isCaptureMode as isSharedCaptureMode,
  isScannerSessionId,
  type CaptureMode,
} from "@volt/scanner-protocol";

export type { CaptureMode };

export type CaptureInvocation = {
  mode?: CaptureMode;
  sessionId: string;
};

function isCaptureMode(value: string | undefined): value is CaptureMode {
  return isSharedCaptureMode(value);
}

function getStringParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key);
  return value?.trim() || null;
}

function isSupportedCaptureUrl(parsed: URL) {
  return parsed.protocol === "volt:" || parsed.hostname === "scanner-signal.vercel.app";
}

function getModeFromUrl(parsed: URL): CaptureMode | null | undefined {
  const parts = [
    ...(parsed.protocol === "volt:" && parsed.hostname ? [parsed.hostname] : []),
    ...parsed.pathname.split("/").filter(Boolean),
  ];
  if (parts[0] === "clip") return null;
  const candidate = parts[0];
  return isCaptureMode(candidate) ? candidate : undefined;
}

export function parseCaptureInvocation(url: string): CaptureInvocation | null {
  try {
    const parsed = new URL(url);
    if (!isSupportedCaptureUrl(parsed)) return null;
    const pathMode = getModeFromUrl(parsed);
    if (pathMode === null) return null;
    const queryMode = getStringParam(parsed.searchParams, "mode") ?? undefined;
    const mode = isCaptureMode(queryMode) ? queryMode : pathMode;
    const sessionId = getStringParam(parsed.searchParams, "session");

    if (!isScannerSessionId(sessionId)) return null;
    return mode ? { mode, sessionId } : { sessionId };
  } catch {
    return null;
  }
}

export function normalizeCaptureMode(value: unknown): CaptureMode | null {
  return isSharedCaptureMode(value) ? value : null;
}
