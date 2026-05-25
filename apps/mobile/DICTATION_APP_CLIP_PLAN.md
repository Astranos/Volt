# Dictation App Clip Plan

## Goal

Make the Volt App Clip support the `dictation` mode by reusing the barcode App Clip architecture, but replacing camera capture with native iOS speech recognition. The user scans the App Clip QR code from Chrome, speaks into the iPhone, and the App Clip streams transcript updates back to the browser cursor as dictation is recognized.

This is a focused App Clip flow:

1. Chrome extension creates a `dictation` relay session.
2. Extension shows `https://scanner-signal.vercel.app/clip/dictation?session=SESSION_ID`.
3. iOS opens the App Clip in dictation mode.
4. App Clip requests microphone and speech recognition permission.
5. User records speech.
6. App Clip sends partial transcript updates to the relay while the user speaks.
7. Extension replaces the active dictation text range in the remembered browser target.
8. App Clip sends a final transcript when dictation stops.
9. Extension replaces the active range one last time and commits the final text.

## What To Reuse From Barcode App Clip

Use the barcode App Clip as the implementation template:

- Route mode from `apps/mobile/app/clip/[mode].clip.tsx`.
- Keep the `hasVoltClip...` capability check pattern from `apps/mobile/lib/volt-clip-barcode-scanner.ts`.
- Use native events for capture updates.
- Keep capture state in the App Clip React screen.
- Use `makeClipRelayResult(mode, message)` from `apps/mobile/lib/clip-result-relay.ts`.
- POST transcript updates to `${SCANNER_SIGNAL_URL}/${session}/result`.
- Stop native capture after a successful send.
- Show `sent`, `error`, and unavailable states in the same shell.

The dictation flow should not use:

- Camera preview.
- Barcode candidate guard.
- Scanner stability threshold.
- OCR image capture.
- WebRTC.
- Full tab navigator or full mobile app scanner provider.

## Current Relevant Files

- `apps/mobile/app/clip/[mode].clip.tsx`: App Clip mode screen and relay send path.
- `apps/mobile/lib/volt-clip-barcode-scanner.ts`: barcode native wrapper pattern to mirror.
- `apps/mobile/lib/volt-clip-dictation.ts`: dictation native wrapper target.
- `apps/mobile/ios/VoltClip/VoltClipBarcodeScanner.swift`: native event-emitter pattern to mirror.
- `apps/mobile/ios/VoltClip/VoltClipDictation.swift`: native speech module target.
- `apps/mobile/lib/scanner-messages.ts`: `makeDictationMessage`.
- `packages/extension/src/offscreen/mobile-scanner-offscreen.ts`: relay session creation and polling.
- `apps/scanner-signal/api/signal.ts`: validates relay results by mode.

## Streaming Message Contract

Dictation must send multiple text results with a stable `dictationSessionId`.

Partial update:

```ts
{
  kind: "text",
  format: "dictation",
  barcode: transcript,
  dictationPhase: "partial",
  dictationSessionId: `clip-${session}`,
  insertIntoCursor: true
}
```

Final update:

```ts
{
  kind: "text",
  format: "dictation",
  barcode: transcript,
  dictationPhase: "final",
  dictationSessionId: `clip-${session}`,
  insertIntoCursor: true
}
```

Partial updates replace the previous text for the same `dictationSessionId`. They must not append as independent inserts.

Final updates commit the last replacement and close the active dictation session.

## Implementation Steps

### 1. Match Barcode's Native Wrapper Shape

Keep `apps/mobile/lib/volt-clip-dictation.ts` parallel to `volt-clip-barcode-scanner.ts`:

- `hasVoltClipDictation`
- `requestVoltClipDictationPermissions()`
- `startVoltClipDictation()`
- `stopVoltClipDictation()`
- `addVoltClipDictationPartialListener(listener)`
- `addVoltClipDictationFinalListener(listener)`
- `addVoltClipDictationErrorListener(listener)`

The wrapper should be defensive like barcode:

- If the native module is missing, report unavailable.
- If `stop` is called without a module, resolve safely.
- Normalize event payloads before calling React listeners.

### 2. Implement Native Speech Capture

Use `apps/mobile/ios/VoltClip/VoltClipDictation.swift`.

Required native behavior:

- Request both `SFSpeechRecognizer` and microphone permission.
- Use `AVAudioEngine` with `SFSpeechAudioBufferRecognitionRequest`.
- Emit `partial` events for local UI preview and browser streaming.
- Emit `final` once recognition resolves a final transcript.
- Emit `error` for permission, recognizer, audio session, or recognition failures.
- Stop and release audio resources when recording stops, errors, or final result arrives.

Important cleanup requirements:

- Remove the input tap on stop.
- Cancel or nil out the recognition task.
- End audio on the recognition request.
- Deactivate `AVAudioSession` after recording.

### 3. Build Dictation Mode In The App Clip Screen

In `apps/mobile/app/clip/[mode].clip.tsx`, use the same lifecycle shape as barcode:

1. When `mode !== "dictation"`, do nothing.
2. If `hasVoltClipDictation` is false, set state to `unavailable`.
3. Register partial, final, and error listeners.
4. On partial:
   - update local transcript
   - set `dictationFinal` to false
   - send a throttled partial relay update
5. On final:
   - update transcript
   - set `dictationFinal` to true
   - return UI to ready state
   - send a final relay update immediately
6. On error:
   - set state to `error`
   - show recoverable copy
7. Remove listeners and stop dictation on unmount.

Use a single explicit record control:

- Idle/ready: `Record`
- Requesting permission: `Starting`
- Recording: `Stop`
- Final transcript sent: show `Sent`
- Sent: disable record unless starting a new browser session

Streaming means the user should not need a separate Send button for normal dictation. The App Clip should send partials automatically while recording and send the final transcript when recording stops or iOS returns a final result.

### 4. Stream Transcript Updates

The App Clip should stream transcript updates with the same `dictationSessionId`.

Partial sends:

- Only send if mode is `dictation`.
- Only send if session exists.
- Only send if trimmed transcript is non-empty.
- Throttle sends to avoid excessive relay writes.
- Recommended throttle: 250 ms leading/trailing.
- Do not send the same transcript twice.
- Mark failures as recoverable while recording continues.

Final send:

- Send immediately when recording stops or native final event arrives.
- Use the latest non-empty transcript.
- Mark `sendState` as `sent` only after the final relay response succeeds.
- Stop native dictation after final send.

Partial message:

```ts
const message = makeDictationMessage(dictationTranscript.trim(), `clip-${session}`, "partial");
const result = makeClipRelayResult("dictation", message);
```

Final message:

```ts
const message = makeDictationMessage(dictationTranscript.trim(), `clip-${session}`, "final");
const result = makeClipRelayResult("dictation", message);
```

Update `makeDictationMessage` so it can accept the phase:

```ts
export function makeDictationMessage(
  text: string,
  dictationSessionId: string,
  dictationPhase: "partial" | "final" = "final"
): ScanItem
```

### 5. Update Browser Relay For Streaming

The existing relay is designed around one accepted App Clip result. Streaming dictation needs a dictation-specific update model.

Server changes:

- Continue first-result-wins for `ocr` and `barcode`.
- For `dictation`, allow multiple results for the same session while `dictationPhase === "partial"`.
- Store the latest update plus a monotonically increasing sequence number.
- Accept one final update with `dictationPhase === "final"`.
- After final, reject later updates with `409`.
- Reject dictation messages missing `dictationSessionId`.
- Reject empty transcript values.

Suggested relay result shape:

```ts
{
  id: string;
  mode: "dictation";
  sequence: number;
  message: BarcodeMessage;
  createdAt: string;
  finalized: boolean;
}
```

Extension polling changes:

- Poll `/api/signal/:session/result` as today.
- Track last seen `sequence` or `id`.
- Ignore duplicate poll responses.
- Continue polling after partial updates.
- Stop polling after final update.
- Route partial and final updates through a dictation-aware text replacement path.

### 6. App Clip UX

The dictation App Clip should be simpler than barcode:

- No viewfinder area.
- No camera startup state.
- Large mic button centered in the screen.
- Transcript preview above or near the button.
- Clear state label:
  - `Ready to dictate`
  - `Requesting microphone`
  - `Listening`
  - `Streaming to Chrome`
  - `Final text sent`
- Footer copy should say that transcript updates are live while recording.

Avoid in-app instructions about browser internals. The UI should feel like a capture surface, not a setup guide.

### 7. Browser Text Replacement

This is the critical part of streamed dictation.

The extension must not insert every partial transcript as a new string. It must replace the text range inserted by the previous update for the same `dictationSessionId`.

Behavior:

1. Before launching the App Clip, remember the active editable target and cursor/selection range.
2. On the first partial for a `dictationSessionId`, insert the transcript at the remembered range.
3. Store the inserted range:
   - target identity
   - start offset
   - end offset
   - dictationSessionId
   - last transcript
4. On each later partial, replace that stored range with the new transcript.
5. Update the stored end offset after each replacement.
6. On final, replace the same stored range and clear the active dictation replacement state.

Fallback behavior:

- If the target disappears, page navigation occurs, or direct replacement fails, switch to clipboard fallback.
- Clipboard fallback should copy the latest full transcript, not every partial.
- Once fallback is active, avoid repeatedly overwriting clipboard more often than the same partial throttle interval.

### 8. Permissions And Metadata

Verify App Clip target includes:

- `NSMicrophoneUsageDescription`
- `NSSpeechRecognitionUsageDescription`

Verify Apple Developer/App Store Connect App Clip configuration allows:

- App Clip associated domain for `scanner-signal.vercel.app`
- Advanced App Clip Experience for `/clip/dictation`
- Speech and microphone capability behavior on device

### 9. Tests

Add or update focused tests:

- `apps/mobile/lib/scanner-messages.test.mjs`
  - `makeDictationMessage` defaults to `dictationPhase: "final"`.
  - `makeDictationMessage(..., "partial")` sets `dictationPhase: "partial"`.
  - Dictation messages set `kind: "text"`, `format: "dictation"`, and `insertIntoCursor: true`.
- `apps/mobile/lib/app-clip-native.test.mjs`
  - dictation native wrapper reports unavailable safely when no native module exists.
  - dictation listener wrappers ignore malformed events.
- `apps/scanner-signal/api/clip.test.mjs`
  - relay accepts partial dictation results.
  - relay updates latest dictation result for each partial.
  - relay accepts final dictation result.
  - relay rejects partial dictation result after final.
  - relay rejects barcode payload in dictation mode.
- Extension relay tests, if not already covered:
  - creating a dictation relay session builds `/clip/dictation`.
  - polling a partial dictation result keeps polling.
  - polling a final dictation result stops polling.
  - repeated partials replace the same browser text range instead of appending.

### 10. Device Validation

Validate on a real iPhone, because speech recognition and App Clips are device-sensitive:

1. Start extension dictation capture from a browser editable field.
2. Scan the QR code.
3. Confirm App Clip opens directly to dictation.
4. Grant microphone and speech permissions.
5. Record a short phrase.
6. Confirm partial preview appears locally.
7. Confirm Chrome updates the same inserted text as partial transcript changes.
8. Stop recording and confirm final transcript appears.
9. Confirm Chrome commits the final text without duplication.
10. Repeat with permissions denied and confirm recoverable error copy.
11. Repeat after closing the QR overlay and confirm stale-session recovery.
12. Repeat in `input`, `textarea`, and `contenteditable` targets.

## Acceptance Criteria

- `/clip/dictation?session=...` opens the App Clip dictation screen.
- Dictation App Clip contains no camera feed.
- Native iOS speech recognition drives transcript capture.
- Partial transcripts stream to Chrome while recording.
- Each partial replaces the previous text for the same `dictationSessionId`; it does not append duplicates.
- Final transcript sends as a final `dictation` text message over the relay.
- Browser commits the final text through the existing cursor insertion flow.
- App Clip handles unavailable module, denied permissions, relay failure, already-used session, and expired session states.
- Tests cover message shape, relay validation, browser replacement behavior, and unavailable native wrapper behavior.
