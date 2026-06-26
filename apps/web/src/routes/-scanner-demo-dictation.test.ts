import { describe, expect, test } from "vitest";

import {
  createRemoteSpeechAudioBridge,
  nextReviewInputAfterLiveDictation,
  WebRemoteSpeechRecognizer,
  type LiveDictationInsertion,
} from "./-scanner-demo-dictation";

describe("nextReviewInputAfterLiveDictation", () => {
  test("replaces cumulative dictation partials instead of appending each one", () => {
    let value = "";
    let insertion: LiveDictationInsertion | null = null;

    for (const text of ["Hello", "Hello this", "Hello this is", "Hello this is working"]) {
      const result = nextReviewInputAfterLiveDictation({
        current: value,
        existing: insertion ?? undefined,
        phase: "partial",
        text,
      });
      value = result.value;
      insertion = result.insertion;
    }

    expect(value).toBe("Hello this is working");
  });

  test("final dictation keeps the replacement anchor until dictation stops", () => {
    const partial = nextReviewInputAfterLiveDictation({
      current: "",
      phase: "partial",
      text: "Hello this",
    });
    const final = nextReviewInputAfterLiveDictation({
      current: partial.value,
      existing: partial.insertion ?? undefined,
      phase: "final",
      text: "Hello this is working",
    });

    expect(final.value).toBe("Hello this is working");
    expect(final.insertion).toEqual({
      start: 0,
      end: "Hello this is working".length,
      text: "Hello this is working",
    });
    const stopped = nextReviewInputAfterLiveDictation({
      current: final.value,
      existing: final.insertion ?? undefined,
      phase: "stopped",
    });
    expect(stopped.value).toBe("Hello this is working");
    expect(stopped.insertion).toBeNull();
  });

  test("web remote speech recognizer emits cumulative text from indexed speech results", () => {
    const starts: unknown[] = [];
    const transcripts: unknown[] = [];
    let recognition: {
      continuous: boolean;
      interimResults: boolean;
      lang: string;
      onend: (() => void) | null;
      onerror: ((event: unknown) => void) | null;
      onresult:
        | ((event: {
            resultIndex?: number;
            results: ArrayLike<
              ArrayLike<{ transcript?: string }> & { isFinal?: boolean }
            >;
          }) => void)
        | null;
      start: (track?: unknown) => void;
      stop: () => void;
    } | null = null;

    class FakeSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onend = null;
      onerror = null;
      onresult = null;

      constructor() {
        recognition = this;
      }

      start(track?: unknown) {
        starts.push(track);
      }

      stop() {}
    }

    const track = { kind: "audio", readyState: "live" } as MediaStreamTrack;
    const recognizer = new WebRemoteSpeechRecognizer(
      {
        onTranscript: (transcript) => transcripts.push(transcript),
      },
      { webkitSpeechRecognition: FakeSpeechRecognition } as typeof globalThis,
    );

    expect(recognizer.start(track)).toBe(true);
    expect(starts[0]).toBe(track);
    expect(recognition?.continuous).toBe(true);
    expect(recognition?.interimResults).toBe(true);

    recognition?.onresult?.({
      resultIndex: 0,
      results: [
        { 0: { transcript: "test" }, length: 1, isFinal: false },
      ],
    });
    recognition?.onresult?.({
      resultIndex: 0,
      results: [
        { 0: { transcript: "testing" }, length: 1, isFinal: false },
      ],
    });
    recognition?.onresult?.({
      resultIndex: 0,
      results: [
        { 0: { transcript: "testing" }, length: 1, isFinal: true },
      ],
    });
    recognition?.onresult?.({
      resultIndex: 1,
      results: [
        { 0: { transcript: "testing" }, length: 1, isFinal: true },
        { 0: { transcript: "it's" }, length: 1, isFinal: false },
      ],
    });
    recognition?.onresult?.({
      resultIndex: 1,
      results: [
        { 0: { transcript: "testing" }, length: 1, isFinal: true },
        { 0: { transcript: "it's just" }, length: 1, isFinal: false },
      ],
    });
    recognition?.onresult?.({
      resultIndex: 1,
      results: [
        { 0: { transcript: "testing" }, length: 1, isFinal: true },
        { 0: { transcript: "it's just working" }, length: 1, isFinal: true },
      ],
    });

    expect(transcripts).toEqual([
      { phase: "partial", text: "test" },
      { phase: "partial", text: "testing" },
      { phase: "final", text: "testing" },
      { phase: "partial", text: "testing it's" },
      { phase: "partial", text: "testing it's just" },
      { phase: "final", text: "testing it's just working" },
    ]);
  });

  test("browser session dictation insertion avoids repeated interim and final speech results", () => {
    let value = "";
    let insertion: LiveDictationInsertion | null = null;

    for (const [phase, text] of [
      ["partial", "test"],
      ["partial", "testing"],
      ["final", "testing"],
      ["partial", "testing it's"],
      ["partial", "testing it's just"],
      ["final", "testing it's just working"],
    ] as const) {
      const result = nextReviewInputAfterLiveDictation({
        current: value,
        existing: insertion ?? undefined,
        phase,
        text,
      });
      value = result.value;
      insertion = result.insertion;
    }

    expect(value).toBe("testing it's just working");
  });

  test("web remote speech recognizer does not fall back to the ambient microphone", () => {
    const starts: unknown[] = [];
    const errors: unknown[] = [];

    class FakeSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = "";
      onend = null;
      onerror = null;
      onresult = null;

      start() {
        starts.push("ambient");
      }

      stop() {}
    }

    const recognizer = new WebRemoteSpeechRecognizer(
      {
        onTranscript: () => {},
        onError: (error) => errors.push(error),
      },
      {
        navigator: { userAgent: "Mozilla/5.0 Chrome/134.0.0.0 Safari/537.36" },
        webkitSpeechRecognition: FakeSpeechRecognition,
      } as typeof globalThis,
    );

    expect(
      recognizer.start({ kind: "audio", readyState: "live" } as MediaStreamTrack),
    ).toBe(false);
    expect(starts).toEqual([]);
    expect((errors[0] as Error).message).toBe(
      "speech_recognition_audio_track_start_unavailable",
    );
  });

  test("web remote speech bridge creates a fresh live recognition track", () => {
    const originalTrack = {
      kind: "audio",
      readyState: "live",
      stop: () => {},
    } as MediaStreamTrack;
    const bridgedTrack = {
      kind: "audio",
      readyState: "live",
      stop: () => {},
    } as MediaStreamTrack;
    const connections: string[] = [];

    class FakeMediaStream {
      tracks: MediaStreamTrack[];

      constructor(tracks: MediaStreamTrack[]) {
        this.tracks = tracks;
      }

      getTracks() {
        return this.tracks;
      }
    }

    class FakeAudioContext {
      destination = "speaker";
      state = "running";

      createMediaStreamSource(stream: MediaStream) {
        return {
          stream,
          connect: (target: unknown) => {
            connections.push(target === "speaker" ? "speaker" : "node");
          },
          disconnect: () => {},
        };
      }

      createMediaStreamDestination() {
        return {
          stream: {
            getAudioTracks: () => [bridgedTrack],
            getTracks: () => [bridgedTrack],
          },
          disconnect: () => {},
        };
      }

      createGain() {
        return {
          gain: { value: 1 },
          connect: (target: unknown) => {
            connections.push(target === "speaker" ? "speaker" : "node");
          },
          disconnect: () => {},
        };
      }

      resume() {
        return Promise.resolve();
      }

      close() {
        return Promise.resolve();
      }
    }

    const bridge = createRemoteSpeechAudioBridge(originalTrack, {
      AudioContext: FakeAudioContext,
      MediaStream: FakeMediaStream,
    } as unknown as typeof globalThis);

    expect(bridge?.track).toBe(bridgedTrack);
    expect(bridge?.track).not.toBe(originalTrack);
    expect(connections).toEqual(["node", "node", "speaker"]);
  });
});
