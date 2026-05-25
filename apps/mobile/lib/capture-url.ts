export type CaptureMode = "ocr" | "barcode" | "dictation" | "photo";

export type CaptureInvocation = {
  mode: CaptureMode;
  sessionId: string;
};

const captureModes = new Set<CaptureMode>(["ocr", "barcode", "dictation", "photo"]);
const sessionIdPattern = /^[a-zA-Z0-9_-]{4,80}$/;

function isCaptureMode(value: string | undefined): value is CaptureMode {
  return value === "ocr" || value === "barcode" || value === "dictation" || value === "photo";
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
    const mode = getModeFromPath(parsed.pathname);
    const sessionId = getStringParam(parsed.searchParams, "session");

    if (!mode || !sessionId || !sessionIdPattern.test(sessionId)) return null;
    return { mode, sessionId };
  } catch {
    return null;
  }
}

export function normalizeCaptureMode(value: unknown): CaptureMode | null {
  return typeof value === "string" && captureModes.has(value as CaptureMode) ? (value as CaptureMode) : null;
}
