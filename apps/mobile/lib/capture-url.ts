import {
  isAppClipCaptureMode,
  isScannerSessionId,
  type CaptureMode,
} from "@volt/scanner-protocol";

export type { CaptureMode };

export type CaptureInvocation = {
  mode?: CaptureMode;
  sessionId: string;
};

function isCaptureMode(value: string | undefined): value is CaptureMode {
  return isAppClipCaptureMode(value);
}

function getStringParam(searchParams: URLSearchParams, key: string) {
  const value = searchParams.get(key);
  return value?.trim() || null;
}

function getModeFromPath(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  const clipIndex = parts.indexOf("clip");
  const candidate = clipIndex >= 0 ? parts[clipIndex + 1] : parts[0];
  return isCaptureMode(candidate) ? candidate : null;
}

export function parseCaptureInvocation(url: string): CaptureInvocation | null {
  try {
    const parsed = new URL(url);
    const queryMode = getStringParam(parsed.searchParams, "mode") ?? undefined;
    const mode = isCaptureMode(queryMode) ? queryMode : getModeFromPath(parsed.pathname);
    const sessionId = getStringParam(parsed.searchParams, "session");

    if (!isScannerSessionId(sessionId)) return null;
    return mode ? { mode, sessionId } : { sessionId };
  } catch {
    return null;
  }
}

export function normalizeCaptureMode(value: unknown): CaptureMode | null {
  return isAppClipCaptureMode(value) ? value : null;
}
