export type LiveDictationPhase = "started" | "partial" | "final" | "stopped";
export type RemoteSpeechPhase = "partial" | "final";

type SpeechRecognitionResultLike = ArrayLike<{ transcript?: string }> & {
  isFinal?: boolean;
};

type SpeechRecognitionResultEventLike = {
  resultIndex?: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  start: (audioTrack?: MediaStreamTrack) => void;
  stop: () => void;
  abort?: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionGlobal = typeof globalThis & {
  AudioContext?: typeof AudioContext;
  MediaStream?: typeof MediaStream;
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
  webkitAudioContext?: typeof AudioContext;
};

export type LiveDictationInsertion = {
  end: number;
  start: number;
  text: string;
};

export type LiveDictationReplacementInput = {
  current: string;
  existing?: LiveDictationInsertion;
  phase: LiveDictationPhase;
  selectionEnd?: number;
  selectionStart?: number;
  text?: string;
};

export type LiveDictationReplacementResult = {
  inserted: boolean;
  insertion: LiveDictationInsertion | null;
  value: string;
};

export type RemoteSpeechTranscript = {
  phase: RemoteSpeechPhase;
  text: string;
};

export type RemoteSpeechAudioBridge = {
  context?: AudioContext;
  destination?: MediaStreamAudioDestinationNode;
  monitorGain?: GainNode;
  source?: MediaStreamAudioSourceNode;
  stream: MediaStream;
  track: MediaStreamTrack;
};

export function remoteSpeechErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string") return value;
  }
  return "";
}

export function remoteSpeechErrorName(error: unknown) {
  if (error instanceof Error) return error.name;
  if (error && typeof error === "object" && "name" in error) {
    const value = (error as { name?: unknown }).name;
    if (typeof value === "string") return value;
  }
  return "";
}

export function isTransientRemoteSpeechTrackStartError(error: unknown) {
  return (
    remoteSpeechErrorName(error) === "InvalidStateError" &&
    remoteSpeechErrorMessage(error).includes("MediaStreamTrack")
  );
}

export function isRestartableRemoteSpeechError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "error" in error ? (error as { error?: unknown }).error : undefined;
  if (code === "no-speech" || code === "audio-capture") return true;
  const message = remoteSpeechErrorMessage(error).toLowerCase();
  return message === "no-speech" || message.includes("no speech");
}

export function remoteSpeechErrorDetail(error: unknown) {
  const message = remoteSpeechErrorMessage(error);
  const name = remoteSpeechErrorName(error);

  if (error instanceof Error) {
    if (error.message === "speech_recognition_unavailable") {
      return "Chrome speech recognition is not available in this browser context.";
    }
    if (error.message === "speech_recognition_audio_track_start_unavailable") {
      return "Chrome cannot start speech recognition from the App Clip audio stream on this browser version.";
    }
    if (error.message === "speech_recognition_requires_audio_track") {
      return "Chrome did not receive an audio track from the App Clip.";
    }
    if (error.message === "speech_recognition_requires_live_audio_track") {
      return "Chrome received the App Clip microphone track before it was live. Tap Dictate again.";
    }
    if (name === "InvalidStateError" && message.includes("MediaStreamTrack")) {
      return "Chrome received the App Clip microphone track before it was live. Tap Dictate again.";
    }
    return error.message;
  }

  if (name === "InvalidStateError" && message.includes("MediaStreamTrack")) {
    return "Chrome received the App Clip microphone track before it was live. Tap Dictate again.";
  }
  if (message) return message;

  if (error && typeof error === "object" && "error" in error) {
    const value = (error as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) {
      return `Chrome speech recognition failed: ${value}`;
    }
  }

  return "Chrome speech recognition failed to start.";
}

export function createRemoteSpeechAudioBridge(
  remoteAudioTrack: MediaStreamTrack,
  globalScope: SpeechRecognitionGlobal = globalThis as SpeechRecognitionGlobal,
): RemoteSpeechAudioBridge | null {
  const MediaStreamCtor = globalScope.MediaStream ?? globalThis.MediaStream;
  const AudioContextCtor =
    globalScope.AudioContext ??
    globalThis.AudioContext ??
    globalScope.webkitAudioContext;
  if (!MediaStreamCtor || !AudioContextCtor) return null;

  const stream = new MediaStreamCtor([remoteAudioTrack]);
  const context = new AudioContextCtor();
  const source = context.createMediaStreamSource(stream);
  const destination = context.createMediaStreamDestination();
  const monitorGain = context.createGain();
  monitorGain.gain.value = 0.001;
  source.connect(destination);
  source.connect(monitorGain);
  monitorGain.connect(context.destination);
  void context.resume?.().catch(() => {});

  const track = destination.stream.getAudioTracks()[0];
  if (!track) {
    void context.close().catch(() => {});
    return null;
  }

  return {
    context,
    destination,
    monitorGain,
    source,
    stream,
    track,
  };
}

export class WebRemoteSpeechRecognizer {
  private activeRecognition: SpeechRecognitionLike | null = null;
  private resultFinality: boolean[] = [];
  private resultTexts: string[] = [];

  constructor(
    private readonly events: {
      onTranscript: (transcript: RemoteSpeechTranscript) => void;
      onError?: (error: unknown) => void;
      onEnd?: () => void;
    },
    private readonly globalScope: SpeechRecognitionGlobal = globalThis as SpeechRecognitionGlobal,
  ) {}

  start(remoteAudioTrack: MediaStreamTrack) {
    this.stop();
    this.resultFinality = [];
    this.resultTexts = [];
    const Recognition =
      this.globalScope.SpeechRecognition ??
      this.globalScope.webkitSpeechRecognition ??
      null;
    if (!Recognition) {
      this.events.onError?.(new Error("speech_recognition_unavailable"));
      return false;
    }
    if (remoteAudioTrack.kind !== "audio" || remoteAudioTrack.readyState !== "live") {
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

  private supportsAudioTrackStart(recognition: SpeechRecognitionLike) {
    if (recognition.start.length > 0) return true;

    const userAgent = this.globalScope.navigator?.userAgent ?? "";
    const chromiumMatch = userAgent.match(/\b(?:Chrome|Chromium|Edg)\/(\d+)/);
    if (!chromiumMatch) return false;
    return Number(chromiumMatch[1]) >= 135;
  }

  private handleResult(event: SpeechRecognitionResultEventLike) {
    const startIndex = typeof event.resultIndex === "number" ? event.resultIndex : 0;
    let hasChangedResult = false;

    for (let index = startIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = this.resultTranscript(result);
      this.resultTexts[index] = text;
      this.resultFinality[index] = result.isFinal === true;
      hasChangedResult = true;
    }

    if (!hasChangedResult) return;

    const text = this.resultTexts
      .map((resultText) => resultText?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!text) return;

    const hasOpenResult = this.resultTexts.some((resultText, index) => {
      return Boolean(resultText?.trim()) && this.resultFinality[index] !== true;
    });
    this.events.onTranscript({
      phase: hasOpenResult ? "partial" : "final",
      text,
    });
  }

  private resultTranscript(result: SpeechRecognitionResultLike) {
    let transcript = "";
    for (let index = 0; index < result.length; index += 1) {
      transcript += result[index]?.transcript ?? "";
    }
    return transcript.trim();
  }
}

export function nextReviewInputAfterLiveDictation({
  current,
  existing,
  phase,
  selectionEnd,
  selectionStart,
  text,
}: LiveDictationReplacementInput): LiveDictationReplacementResult {
  if (phase === "started" || phase === "stopped") {
    return { inserted: false, insertion: null, value: current };
  }

  const nextText = text?.trim();
  if (!nextText) return { inserted: false, insertion: existing ?? null, value: current };

  let start = current.length;
  let end = current.length;

  if (existing && current.slice(existing.start, existing.end) === existing.text) {
    start = existing.start;
    end = existing.end;
  } else if (existing?.text) {
    const fallbackStart = current.lastIndexOf(existing.text);
    if (fallbackStart >= 0) {
      start = fallbackStart;
      end = fallbackStart + existing.text.length;
    }
  } else {
    start = selectionStart ?? current.length;
    end = selectionEnd ?? current.length;
  }

  const value = `${current.slice(0, start)}${nextText}${current.slice(end)}`;
  return {
    inserted: true,
    insertion: { start, end: start + nextText.length, text: nextText },
    value,
  };
}
