# App Clip Permissions And React Native Layering

Obsolete for the active full-app scanner architecture. ADR 0002 makes the v1 scanner mobile-app-only WebRTC; this note remains historical App Clip debugging context only.

This note is for agents debugging App Clip permissions, especially dictation, camera, native prompts, and native components layered under React Native UI.

## Key Finding

Do not assume App Clip dictation failures are only microphone permission bugs.

Apple’s App Clip functionality guidance says the `Speech` framework provides no runtime functionality in App Clips. In this repo, `apps/mobile/ios/VoltClip/VoltClipDictation.swift` imports `Speech`, requests `SFSpeechRecognizer` authorization, and starts an `SFSpeechAudioBufferRecognitionRequest`. That path is therefore suspect for the App Clip even when microphone permission is granted.

Sources:

- Apple App Clip functionality guidance: https://developer.apple.com/documentation/appclip/choosing-the-right-functionality-for-your-app-clip
- Apple `SFSpeechRecognizer`: https://developer.apple.com/documentation/Speech/SFSpeechRecognizer
- Apple `AVAudioApplication.requestRecordPermission`: https://developer.apple.com/documentation/avfaudio/avaudioapplication/requestrecordpermission%28completionhandler%3A%29
- Apple App Clip privacy/support behavior: https://support.apple.com/en-lb/102093
- Apple hardware permission controls: https://support.apple.com/guide/iphone/control-access-to-hardware-features-iph168c4bbd5/ios
- Apple HIG privacy guidance: https://developer.apple.com/design/human-interface-guidelines/privacy/

## Historical Repo State

The paths in this section describe the retired App Clip implementation and may no longer exist in the live repo. The active mobile scanner is the full iOS app with WebRTC transport.

Relevant files:

- App Clip screen: `apps/mobile/app/clip/[mode].clip.tsx`
- Dictation JS wrapper: `apps/mobile/lib/volt-clip-dictation.ts`
- Dictation native module: `apps/mobile/ios/VoltClip/VoltClipDictation.swift`
- Dictation Objective-C bridge: `apps/mobile/ios/VoltClip/VoltClipDictation.m`
- Permission strings:
  - `apps/mobile/app.json`
  - `apps/mobile/ios/VoltClip/Info.plist`

Current native dictation behavior:

- Requests speech recognition through `SFSpeechRecognizer.requestAuthorization`.
- Requests microphone recording through `AVAudioApplication.requestRecordPermission` on iOS 17+.
- Reads microphone state through `AVAudioApplication.shared.recordPermission` on iOS 17+.
- Falls back to `AVAudioSession` permission APIs below iOS 17.
- Rejects `start` unless both speech and microphone states look authorized.

The iOS 17+ microphone API update is correct, but it does not solve the App Clip `Speech` framework limitation.

## Permission Model Notes

### Microphone

Microphone access is a protected hardware feature. The app must include `NSMicrophoneUsageDescription`, call the system API, and handle grant/deny. On current iOS, use `AVAudioApplication.requestRecordPermission` and `AVAudioApplication.shared.recordPermission` where available.

Do not call the deprecated `AVAudioSession.requestRecordPermission` as the primary path on modern iOS.

### Speech Recognition

Speech recognition is a separate protected capability from microphone recording in full apps. It has its own `NSSpeechRecognitionUsageDescription` and `SFSpeechRecognizer.requestAuthorization` flow.

For App Clips, Apple’s framework availability guidance is the important layer: `Speech` provides no runtime functionality. A UI that says “enable speech recognition in Settings” can be misleading if the App Clip cannot use the framework after permission state changes.

### App Clip Lifetime

App Clips are ephemeral. Apple support docs state that App Clip data is removed after non-use, and some access granted to App Clips is scoped more narrowly than a full app. For location, Apple explicitly documents one-day, while-in-use access. Treat App Clip permission state as less durable than full-app permission state.

Do not rely on a long-lived “user already granted this forever” mental model in App Clip code.

### Settings Recovery

Normal iOS hardware permissions can be reviewed under Settings > Privacy & Security > the hardware feature. Apple’s App Clip support docs also list App Clip-specific Settings locations for location confirmation and notifications.

For App Clip dictation, avoid copy that promises Settings can fix every failure. If `Speech` is unsupported in the clip, Settings will not make `SFSpeechRecognizer` work.

Recommended recovery copy shape:

- Good: “Microphone access is needed to record audio.”
- Good: “Speech transcription is unavailable in the App Clip. Open the full app to dictate.”
- Risky: “Go to Settings and enable Speech Recognition” when running in the App Clip.

## Prompting Rules

Ask only from a direct user action, such as tapping or holding the dictation control.

Use a short explanatory pre-prompt only when the need is not obvious. The pre-prompt should not imply the app can grant permission itself. The system sheet grants permission.

Preferred button labels:

- “Continue”
- “Allow in iOS”
- “Use microphone”

Avoid:

- “Enable permission”
- “Enable microphone”
- “Fix Settings”

Apple HIG privacy guidance says the system alert shows the app’s purpose string, and custom permission views should preserve trust and context. Keep `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription` concrete and task-specific.

## Recommended Dictation Architecture

Because `Speech` is not a reliable App Clip runtime dependency, prefer one of these:

### Option A: Remove App Clip Dictation

Keep dictation in the full app only. In the App Clip, show a mode-disabled state and offer OCR/barcode/photo capture.

Use this if dictation is not essential to the App Clip’s focused task.

### Option B: App Clip Records Audio, Server Or Extension Transcribes

Use `AVAudioEngine` or `AVAudioRecorder` only to capture audio after microphone permission. Send audio to a backend or paired Chrome extension for transcription.

Requirements:

- Clear privacy copy before recording.
- Transport only after the user acts.
- Timeout and cancellation.
- No long-running background recording.
- Server-side data retention policy.

This avoids `Speech` in the App Clip but adds backend/privacy work.

Current implementation direction:

- The App Clip native dictation module should not import `Speech`.
- It should request microphone permission only.
- It should emit mono `pcm_s16le` audio chunks from `AVAudioEngine`.
- JS should fetch a short-lived transcription token from `scanner-signal`.
- JS should forward audio chunks to OpenAI Realtime transcription over client WebSocket.
- OpenAI emits transcription delta/completed events.
- JS should relay both partial and final transcript messages through `/api/signal/:session/result`.
- The Chrome extension already understands live dictation partials and replaces the currently inserted text until the final arrives.

Token endpoint:

```json
POST /api/dictation-token
{ "sessionId": "...", "dictationSessionId": "..." }
```

OpenAI audio append event:

```json
{ "type": "input_audio_buffer.append", "audio": "<base64 24 kHz mono pcm_s16le>" }
```

End capture:

```json
{ "type": "input_audio_buffer.commit" }
```

Transcriber responses:

```json
{ "type": "conversation.item.input_audio_transcription.delta", "delta": "hello" }
{ "type": "conversation.item.input_audio_transcription.completed", "transcript": "hello world" }
```

Do not host a long-lived transcription WebSocket on a plain Vercel Serverless Function unless the deployment target supports connection upgrades. Keep Vercel responsible for minting short-lived tokens and send realtime audio directly to the transcription provider.

### Option C: Promote To Full App For Dictation

When the user selects dictation, explain that dictation requires the full app and route to the full app install/open flow.

Use this if native on-device speech is desired without adding server transcription.

## React Native Layering Notes

The App Clip uses React Native for layout and native UIKit/AVFoundation views for camera, glass, tab bar, and dictation.

Layering rules:

- Native components should be guarded with `UIManager.getViewManagerConfig(...)` before `requireNativeComponent`.
- Decorative native overlays should use `pointerEvents="none"` in JS.
- Capture previews should be hidden/stopped before starting another hardware mode.
- Do not run camera and microphone setup at the same time.
- Permission prompts should be triggered after drawer gestures/animations settle when possible.
- Keep system prompts above the RN hierarchy by calling permission APIs from foreground, user-initiated control paths.

Current code already does some important sequencing:

- Before starting dictation, it stops the barcode scanner.
- Before starting dictation, it hides the text preview.
- Native view registration is guarded through `UIManager`.

Keep that behavior.

## Common Failure Modes

### User granted microphone, but dictation still says permission is needed

Likely causes:

- Speech recognition is not authorized.
- `Speech` framework is unavailable in the App Clip.
- `SFSpeechRecognizer.authorizationStatus()` returns a non-authorized state that the UI collapses into a generic permission error.

Fix:

- Log and display speech status separately from microphone state.
- Do not tell the user microphone settings are wrong if `microphoneGranted === true`.
- In App Clip, prefer “speech transcription unavailable” over “enable permission” when speech status is denied/restricted/unavailable.

### Permission prompt never appears

Likely causes:

- Status is already denied/restricted; iOS will not show the prompt again.
- Missing or mismatched purpose string.
- Request was not triggered from an active foreground user flow.
- Native call is racing another hardware session or modal transition.

Fix:

- Read current status first.
- Show feature-specific recovery UI.
- Ensure the native target plist contains the required usage key.
- Stop camera/scanner sessions before requesting microphone.

### App Clip works once, then fails later

Likely causes:

- App Clip state expired or was purged.
- Permission state changed.
- The App Clip session was relaunched from a stale QR/relay session.
- The user installed the full app, changing invocation routing.

Fix:

- Treat every launch as fresh.
- Re-read permissions and relay session state on launch.
- Avoid caching permission assumptions in JS state only.

### Native views block RN controls

Likely causes:

- Native preview or glass view has interaction enabled.
- JS overlay lacks `pointerEvents="none"`.
- z-index/order changed while adding a native component.

Fix:

- Camera preview layers should sit behind controls.
- Glass/tint overlays should not receive touches.
- The native tab bar should receive touches only when it is the intended active control.
- Re-test drawer collapsed, half-open, and fully open states.

## Diagnostics Checklist

When debugging App Clip dictation, collect these as separate fields:

- `hasVoltClipDictation`
- `speechStatus`
- `microphoneGranted`
- iOS version
- whether the process is App Clip or full app
- active mode before dictation request
- whether camera/scanner preview was running
- native error code and localized message

Do not collapse all failures into “permission issue”.

## Validation

Run after permission or native layering changes:

```bash
pnpm --filter @volt/mobile typecheck
pnpm --filter @volt/mobile test:clip
cd apps/mobile/ios && xcodebuild -workspace Volt.xcworkspace -scheme VoltClip -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

For device-only permission bugs, simulator success is not enough. Test on a physical iPhone with:

- fresh App Clip launch
- denied microphone
- allowed microphone
- expired/relaunched App Clip
- full app installed
- full app not installed
