import {
  isAppClipCaptureMode,
  isCaptureMode,
  type CaptureMode,
} from "@volt/scanner-protocol";

export type { CaptureMode };

export const captureModeRoutes: Record<
  CaptureMode,
  "/(tabs)" | "/(tabs)/scanner" | "/(tabs)/dictation" | "/(tabs)/photos"
> = {
  ocr: "/(tabs)",
  barcode: "/(tabs)/scanner",
  dictation: "/(tabs)/dictation",
  photo: "/(tabs)/photos",
};

export function normalizeFullCaptureMode(value: unknown): CaptureMode | null {
  return isCaptureMode(value) ? value : null;
}

export function normalizeAppClipCaptureMode(value: unknown): CaptureMode | null {
  return isAppClipCaptureMode(value) ? value : null;
}

export function routeForCaptureMode(mode: CaptureMode | null | undefined) {
  return mode ? captureModeRoutes[mode] : "/(tabs)";
}

export function buildPairUrl(session: string, mode?: CaptureMode | null) {
  return `volt://pair?session=${encodeURIComponent(session)}${
    mode ? `&mode=${encodeURIComponent(mode)}` : ""
  }`;
}
