import type { ScannerConnectionStatus } from "@volt/scanner-protocol";
import type { BrowserPhotoDeliveryReceipt } from "./mobile-photo-delivery-ledger";
import type { ExtensionIdentity } from "./mobile-scanner-identity";

export type BarcodeMessage = {
  id?: string;
  barcode: string;
  dictationPhase?: "partial" | "final";
  dictationSessionId?: string;
  format?: string;
  insertIntoCursor?: boolean;
  kind?: "barcode" | "text";
  scannedAt?: string;
};

export type PhotoMessage = {
  kind: "photo";
  id: string;
  name: string;
  mimeType: string;
  dataUrl?: string;
  contributorId?: string;
  size: number;
  width?: number;
  height?: number;
  capturedAt?: string;
  photoBatchId?: string;
};

export type SessionTarget = {
  browser?: string;
  tabTitle?: string;
  url?: string;
  cursor?: string;
};

export type MobileScannerSessionState = {
  status: ScannerConnectionStatus;
  qrCodeUrl: string | null;
  error: string | null;
  connectedAt: string | null;
  connectedPeerCount: number;
  joinWindowExpiresAt: string | null;
  sessionId: string;
  target: SessionTarget | null;
  extensionIdentity: ExtensionIdentity | null;
};

export type MobileScannerSessionEvents = {
  onState: (state: MobileScannerSessionState) => void;
  onScan: (message: BarcodeMessage) => Promise<boolean | { saved: boolean; insertedIntoCursor?: boolean }> | boolean | { saved: boolean; insertedIntoCursor?: boolean };
  onPhoto: (message: PhotoMessage) => Promise<boolean | BrowserPhotoDeliveryReceipt> | boolean | BrowserPhotoDeliveryReceipt;
  onInsert?: (text: string, message: BarcodeMessage) => Promise<boolean> | boolean;
  log?: (...args: unknown[]) => void;
};

export type SpeechRecognitionPhase = "partial" | "final";

export type SpeechRecognitionTranscript = {
  phase: SpeechRecognitionPhase;
  text: string;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  abort?: () => void;
  start: (audioTrack?: MediaStreamTrack) => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionResultEventLike = {
  resultIndex?: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionResultLike = ArrayLike<{ transcript?: string }> & {
  isFinal?: boolean;
};

type SpeechRecognitionGlobal = typeof globalThis & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export type MobileScannerRemoteSpeechRecognitionEvents = {
  onTranscript: (transcript: SpeechRecognitionTranscript) => void;
  onError?: (error: unknown) => void;
  onEnd?: () => void;
};

export function isRestartableRemoteSpeechError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "error" in error ? (error as { error?: unknown }).error : undefined;
  if (code === "no-speech" || code === "audio-capture") return true;
  const message = remoteSpeechRecognitionErrorMessage(error).toLowerCase();
  return message === "no-speech" || message.includes("no speech");
}

function remoteSpeechRecognitionErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string") return value;
  }
  return "";
}

export class MobileScannerRemoteSpeechRecognizer {
  private activeRecognition: SpeechRecognitionLike | null = null;
  private readonly events: MobileScannerRemoteSpeechRecognitionEvents;
  private readonly globalScope: SpeechRecognitionGlobal;

  constructor(
    events: MobileScannerRemoteSpeechRecognitionEvents,
    globalScope: SpeechRecognitionGlobal = globalThis as SpeechRecognitionGlobal,
  ) {
    this.events = events;
    this.globalScope = globalScope;
  }

  isSupported() {
    return Boolean(this.getConstructor());
  }

  start(remoteAudioTrack: MediaStreamTrack) {
    this.stop();
    const Recognition = this.getConstructor();
    if (!Recognition) {
      this.events.onError?.(new Error("speech_recognition_unavailable"));
      return false;
    }
    if (remoteAudioTrack.kind !== "audio") {
      this.events.onError?.(new Error("speech_recognition_requires_audio_track"));
      return false;
    }
    if (remoteAudioTrack.readyState !== "live") {
      this.events.onError?.(new Error("speech_recognition_requires_live_audio_track"));
      return false;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => this.handleResult(event);
    recognition.onerror = (event) => this.events.onError?.(event);
    recognition.onend = () => {
      if (this.activeRecognition === recognition) {
        this.activeRecognition = null;
      }
      this.events.onEnd?.();
    };

    if (!this.supportsAudioTrackStart(recognition)) {
      this.events.onError?.(new Error("speech_recognition_audio_track_start_unavailable"));
      return false;
    }

    try {
      recognition.start(remoteAudioTrack);
      this.activeRecognition = recognition;
      return true;
    } catch (error) {
      this.events.onError?.(error);
      return false;
    }
  }

  stop() {
    const recognition = this.activeRecognition;
    this.activeRecognition = null;
    if (!recognition) return;
    recognition.onend = null;
    recognition.onerror = null;
    recognition.onresult = null;
    try {
      recognition.stop();
    } catch {
      recognition.abort?.();
    }
  }

  private getConstructor() {
    return this.globalScope.SpeechRecognition ?? this.globalScope.webkitSpeechRecognition ?? null;
  }

  private supportsAudioTrackStart(recognition: SpeechRecognitionLike) {
    if (recognition.start.length > 0) return true;

    const userAgent = this.globalScope.navigator?.userAgent ?? "";
    const chromiumMatch = userAgent.match(/\b(?:Chrome|Chromium|Edg)\/(\d+)/);
    if (!chromiumMatch) return false;
    return Number(chromiumMatch[1]) >= 135;
  }

  private handleResult(event: SpeechRecognitionResultEventLike) {
    const startIndex = typeof event.resultIndex === "number" ? event.resultIndex : 0;
    for (let index = startIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = this.resultTranscript(result);
      if (!text) continue;
      this.events.onTranscript({
        phase: result.isFinal ? "final" : "partial",
        text,
      });
    }
  }

  private resultTranscript(result: SpeechRecognitionResultLike) {
    let transcript = "";
    for (let index = 0; index < result.length; index += 1) {
      transcript += result[index]?.transcript ?? "";
    }
    return transcript.trim();
  }
}

export function createDictationMessageFromSpeechTranscript({
  capturedAt = new Date().toISOString(),
  dictationSessionId,
  messageId,
  phase,
  text,
}: {
  capturedAt?: string;
  dictationSessionId: string;
  messageId: string;
  phase: SpeechRecognitionPhase;
  text: string;
}): BarcodeMessage {
  return {
    id: messageId,
    barcode: text,
    dictationPhase: phase,
    dictationSessionId,
    format: "dictation",
    insertIntoCursor: true,
    kind: "text",
    scannedAt: capturedAt,
  };
}
