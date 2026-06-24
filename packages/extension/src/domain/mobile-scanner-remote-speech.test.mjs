import assert from "node:assert/strict";
import test from "node:test";

import {
  MobileScannerRemoteSpeechRecognizer,
  createDictationMessageFromSpeechTranscript,
  isRestartableRemoteSpeechError,
} from "./mobile-scanner-session-types.ts";

test("remote speech transcripts map to existing dictation scanner message shape", () => {
  const message = createDictationMessageFromSpeechTranscript({
    capturedAt: "2026-06-22T12:00:00.000Z",
    dictationSessionId: "dictation-session-test",
    messageId: "dictation-message-test",
    phase: "partial",
    text: "hello listing",
  });

  assert.equal(message.id, "dictation-message-test");
  assert.equal(message.barcode, "hello listing");
  assert.equal(message.dictationPhase, "partial");
  assert.equal(message.dictationSessionId, "dictation-session-test");
  assert.equal(message.format, "dictation");
  assert.equal(message.insertIntoCursor, true);
  assert.equal(message.kind, "text");
  assert.equal(message.scannedAt, "2026-06-22T12:00:00.000Z");
});

test("remote speech recognizer starts with the remote audio track and emits partial and final transcripts", () => {
  const transcripts = [];
  const starts = [];
  let recognition = null;

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

    start(audioTrack) {
      starts.push(audioTrack);
    }

    stop() {}
  }

  const recognizer = new MobileScannerRemoteSpeechRecognizer(
    {
      onTranscript: (transcript) => transcripts.push(transcript),
    },
    {
      navigator: { userAgent: "Mozilla/5.0 Chrome/135.0.0.0 Safari/537.36" },
      webkitSpeechRecognition: FakeSpeechRecognition,
    },
  );
  const track = { kind: "audio", readyState: "live" };

  assert.equal(recognizer.start(track), true);
  assert.equal(starts[0], track);
  assert.equal(recognition.continuous, true);
  assert.equal(recognition.interimResults, true);

  recognition.onresult({
    resultIndex: 0,
    results: [
      { 0: { transcript: "hello " }, length: 1, isFinal: false },
      { 0: { transcript: "world" }, length: 1, isFinal: true },
    ],
  });

  assert.deepEqual(transcripts, [
    { phase: "partial", text: "hello" },
    { phase: "final", text: "world" },
  ]);
});

test("remote speech recognizer still starts live tracks that are initially muted", () => {
  const starts = [];

  class FakeSpeechRecognition {
    continuous = false;
    interimResults = false;
    lang = "";
    onend = null;
    onerror = null;
    onresult = null;

    start(audioTrack) {
      starts.push(audioTrack);
    }

    stop() {}
  }

  const recognizer = new MobileScannerRemoteSpeechRecognizer(
    {
      onTranscript: () => {},
    },
    {
      navigator: { userAgent: "Mozilla/5.0 Chrome/149.0.0.0 Safari/537.36" },
      webkitSpeechRecognition: FakeSpeechRecognition,
    },
  );
  const track = { kind: "audio", readyState: "live", muted: true };

  assert.equal(recognizer.start(track), true);
  assert.equal(starts[0], track);
});

test("remote speech recognizer does not fall back to ambient mic when audio-track start is unavailable", () => {
  const errors = [];
  const starts = [];

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

  const recognizer = new MobileScannerRemoteSpeechRecognizer(
    {
      onTranscript: () => {},
      onError: (error) => errors.push(error),
    },
    {
      navigator: { userAgent: "Mozilla/5.0 Chrome/134.0.0.0 Safari/537.36" },
      SpeechRecognition: FakeSpeechRecognition,
    },
  );

  assert.equal(recognizer.start({ kind: "audio", readyState: "live" }), false);
  assert.equal(starts.length, 0);
  assert.equal(errors[0].message, "speech_recognition_audio_track_start_unavailable");
});

test("remote speech recognizer refuses ended audio tracks before calling Chrome speech", () => {
  const errors = [];
  const starts = [];

  class FakeSpeechRecognition {
    continuous = false;
    interimResults = false;
    lang = "";
    onend = null;
    onerror = null;
    onresult = null;

    start(audioTrack) {
      starts.push(audioTrack);
    }

    stop() {}
  }

  const recognizer = new MobileScannerRemoteSpeechRecognizer(
    {
      onTranscript: () => {},
      onError: (error) => errors.push(error),
    },
    {
      navigator: { userAgent: "Mozilla/5.0 Chrome/149.0.0.0 Safari/537.36" },
      webkitSpeechRecognition: FakeSpeechRecognition,
    },
  );

  assert.equal(recognizer.start({ kind: "audio", readyState: "ended" }), false);
  assert.equal(starts.length, 0);
  assert.equal(errors[0].message, "speech_recognition_requires_live_audio_track");
});

test("remote speech recognizer reports Chrome invalid track start errors", () => {
  const errors = [];

  class FakeSpeechRecognition {
    continuous = false;
    interimResults = false;
    lang = "";
    onend = null;
    onerror = null;
    onresult = null;

    start() {
      const error = new Error(
        "Failed to execute 'start' on 'SpeechRecognition': The MediaStreamTrack is not of kind 'audio' or is not of state 'live'.",
      );
      error.name = "InvalidStateError";
      throw error;
    }

    stop() {}
  }

  const recognizer = new MobileScannerRemoteSpeechRecognizer(
    {
      onTranscript: () => {},
      onError: (error) => errors.push(error),
    },
    {
      navigator: { userAgent: "Mozilla/5.0 Chrome/149.0.0.0 Safari/537.36" },
      webkitSpeechRecognition: FakeSpeechRecognition,
    },
  );

  assert.equal(recognizer.start({ kind: "audio", readyState: "live" }), false);
  assert.equal(errors[0].name, "InvalidStateError");
});

test("Chrome no-speech is restartable while App Clip dictation is active", () => {
  assert.equal(isRestartableRemoteSpeechError({ error: "no-speech" }), true);
  assert.equal(isRestartableRemoteSpeechError({ message: "no-speech" }), true);
  assert.equal(isRestartableRemoteSpeechError({ error: "not-allowed" }), false);
});
