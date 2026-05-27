# Volt App Clip Implementation Plan

## Purpose

Build one no-install iPhone App Clip for Volt that is launched from the Chrome extension context menu through a QR code. The App Clip should reuse the current mobile app's product logic and visual language, but ship as a much smaller, mode-specific experience for:

- OCR Scanning
- Barcode Scanner
- Photo Capture

The App Clip is not a replacement for the full mobile app. It is a focused capture surface that pairs to one browser session, captures cursor-targeted results or a small photo batch, sends them back to the extension, and gets out of the way. Dictation remains a full mobile app feature, not an App Clip mode.

## Current State

### Extension Flow

The extension now has context-menu actions for OCR, barcode, and photo capture. Each action:

1. Remembers the current editable browser target and selection range.
2. Starts a scanner session in the offscreen document.
3. Builds a mode-specific URL:

```text
https://scanner-signal.vercel.app/clip/ocr?session=SESSION_ID
https://scanner-signal.vercel.app/clip/barcode?session=SESSION_ID
https://scanner-signal.vercel.app/clip/photo?session=SESSION_ID
```

4. Shows an in-page QR overlay for the user to scan with iPhone.
5. Receives a result through the scanner transport.
6. Inserts the result into the remembered cursor target, with clipboard fallback.

### Scanner Signal Server

`apps/scanner-signal` currently provides:

- `/api/signal` for WebRTC offer/answer exchange.
- `/clip/:mode` for App Clip invocation URLs.
- `/.well-known/apple-app-site-association` for app/App Clip association.

The association endpoint currently advertises:

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["GB5SPLUARQ.com.volt.mobile"],
        "components": [{ "/": "/clip/*" }]
      }
    ]
  },
  "appclips": {
    "apps": ["GB5SPLUARQ.com.volt.mobile.Clip"]
  }
}
```

### Full Mobile App Logic To Reuse

The full app already has the core behaviors in `apps/mobile/lib/scanner-state.tsx`:

- Pair from URL using `session`.
- Fetch WebRTC offer from `SCANNER_SIGNAL_URL`.
- Create a WebRTC answer.
- Open a data channel.
- Send `BarcodeMessage` objects to the browser.
- Send dictation final text only.
- Support cursor insertion flags.

The current UI/screens are:

- OCR: `apps/mobile/app/(tabs)/index.tsx`
- Barcode: `apps/mobile/app/(tabs)/scanner.tsx`
- Dictation: `apps/mobile/app/(tabs)/dictation.tsx`
- Shared scanner state: `apps/mobile/lib/scanner-state.tsx`
- Native OCR bridge currently present for full app: `apps/mobile/ios/Volt/LiveTextImageView.swift`

The App Clip should extract the relevant logic and design patterns from those files, not import the full tabbed app wholesale.

## Product Requirements

### One App Clip, Three Modes

Use one App Clip target, not separate App Clips per feature.

The App Clip reads the invocation URL path:

```ts
type AppClipMode = "ocr" | "barcode" | "photo";
```

Route mapping:

```text
/clip/ocr        -> OCR capture screen
/clip/barcode    -> barcode scanner screen
/clip/photo      -> photo capture screen
```

### Session Contract

Each invocation URL must include:

```text
?session=SESSION_ID
```

The App Clip should:

1. Parse `mode` from the path.
2. Parse `session` from the query string.
3. Pair to the browser session immediately.
4. Show the mode-specific capture UI.
5. Send exactly one confirmed result by default.
6. Show success/failure state.

### Result Messages

Reuse the existing scanner protocol shape so the extension insertion path remains unchanged.

OCR:

```ts
{
  kind: "text",
  format: "live-text",
  barcode: extractedText,
  insertIntoCursor: true
}
```

Barcode:

```ts
{
  kind: "barcode",
  format: scannedType,
  barcode: value,
  insertIntoCursor: true
}
```

Photo:

```ts
{
  kind: "photo",
  id,
  name,
  mimeType,
  downloadUrl,
  size,
  capturedAt
}
```

## Architecture Decision

### Use React Native For Shell, Native iOS For Capture

Use `react-native-app-clip` to generate and maintain an App Clip target from the Expo/React Native project, but keep the App Clip bundle intentionally narrow.

React Native should own:

- Mode routing.
- Pairing status UI.
- Minimal capture screen composition.
- Confirmation and success/error states.
- Calling native modules.
- Sending result messages.

Native Swift modules should own:

- Camera barcode scanning via `AVFoundation`.
- OCR via `Vision`.
- Photo capture via `AVFoundation`.

Do not pull the full Expo camera/OCR/photo stack into the App Clip if native iOS APIs can provide the same behavior with less size risk.

### Transport Strategy

The App Clip uses the lightweight HTTPS result relay path instead of WebRTC. This keeps `react-native-webrtc` out of the App Clip target and avoids a peer-connection startup dependency during the no-install capture flow.

Current flow:

- Extension creates a relay session with the capture mode.
- Extension renders the mode-specific App Clip URL in the QR overlay.
- App Clip posts OCR and barcode scanner results to `/api/signal/:session/result`.
- App Clip uploads photo bytes through Photo Object Transfer and posts photo manifests to scanner-signal.
- Extension polls for cursor-targeted results and photo manifests; text results route through the existing insertion path, while photos are downloaded and shown in the sidepanel gallery.
- Relay sessions expire after 30 minutes, reject mode mismatches, and keep accepted cursor-targeted results; photo transfer state and uploaded objects remain recoverable for 24 hours.

## App Clip Package Strategy

### Add Plugin

Add `react-native-app-clip` to `apps/mobile`.

Configure `app.json` with one App Clip target:

```json
{
  "plugins": [
    [
      "react-native-app-clip",
      {
        "name": "Volt Clip",
        "bundleIdSuffix": "Clip",
        "targetSuffix": "Clip",
        "deploymentTarget": "16.4"
      }
    ]
  ]
}
```

Done locally in `apps/mobile/app.json` using the installed `react-native-app-clip@0.8.0` schema. The plugin derives `com.volt.mobile.Clip` from the full app bundle id plus `bundleIdSuffix`, derives the `VoltClip` target from `targetSuffix`, and copies associated domains from the Expo iOS config into the App Clip entitlements.

### Use App Clip-Specific Source Files

Use `.clip.tsx` and/or app-clip-specific entry modules so the App Clip does not import:

- Full tab navigator.
- Settings.
- Photos.
- Full scanner history.
- Product chrome not needed for no-install capture.
- Full OCR photo review flows if replaced by native Vision.

Candidate file layout:

```text
apps/mobile/app.clip.tsx
apps/mobile/app/clip/[mode].clip.tsx
apps/mobile/clip/ClipRoot.tsx
apps/mobile/clip/ClipRouter.tsx
apps/mobile/clip/screens/OcrClipScreen.tsx
apps/mobile/clip/screens/BarcodeClipScreen.tsx
apps/mobile/clip/screens/DictationClipScreen.tsx
apps/mobile/clip/components/ClipShell.tsx
apps/mobile/clip/components/ClipStatusBar.tsx
apps/mobile/clip/components/ClipPrimaryButton.tsx
apps/mobile/clip/session/clip-session.ts
apps/mobile/clip/session/clip-messages.ts
apps/mobile/clip/native/VoltClipBarcodeScanner.ts
apps/mobile/clip/native/VoltClipTextRecognizer.ts
apps/mobile/clip/native/VoltClipDictation.ts
```

### Keep Full App Routes Separate

The full app can continue to support:

```text
apps/mobile/app/clip/[mode].tsx
apps/mobile/app/pair.tsx
```

Those routes are useful when the full app is installed. The App Clip target should use App Clip-specific entry files so it avoids pulling in full app dependencies.

## Logic Extraction Plan

### Extract Protocol Message Builders

Create a shared module that both full app and App Clip can import without bringing in React state or heavy native packages.

New file:

```text
apps/mobile/lib/scanner-messages.ts
```

Move or duplicate minimal builders:

```ts
type ScannerCaptureMode = "ocr" | "barcode" | "dictation";

function makeCaptureMessage(args): BarcodeMessage;
function makeBarcodeMessage(value: string, format: string): BarcodeMessage;
function makeOcrMessage(text: string): BarcodeMessage;
function makeDictationMessage(text: string, sessionId: string): BarcodeMessage;
```

This extracts the current `makeScanItem` behavior from `scanner-state.tsx`, but avoids importing:

- `expo-camera`
- `expo-clipboard`
- `expo-speech-recognition`
- `expo-image-manipulator`
- `react-native-webrtc`

### Extract URL Parsing

Create:

```text
apps/mobile/lib/capture-url.ts
```

Responsibilities:

- Parse invocation URL.
- Validate `mode`.
- Validate `session`.
- Normalize route paths from both universal links and custom schemes.

Output:

```ts
type CaptureInvocation = {
  mode: "ocr" | "barcode" | "dictation";
  sessionId: string;
};
```

### Extract Result Relay Client

The full app keeps its existing WebRTC provider in `apps/mobile/lib/scanner-state.tsx`. The App Clip uses the smaller HTTPS result relay helpers in `apps/mobile/lib/clip-result-relay.ts`, plus the shared protocol builders in `apps/mobile/lib/scanner-messages.ts`.

Responsibilities:

- Create a single relay result id.
- Preserve the existing scanner protocol message shape.
- Convert server status codes into App Clip recovery copy.
- Avoid importing the full app scanner provider or WebRTC dependency into the dedicated App Clip bundle.

## UI Extraction Plan

### Shared Visual Language

The App Clip should visually feel like the existing app, but not reuse the full tab screens directly.

Reuse these design traits:

- White/stones base palette.
- Green primary action color `#16a34a`.
- Dark text `#1c1917`.
- Rounded camera/control surfaces.
- Bottom-centered primary capture controls.
- Minimal status copy.

Avoid:

- Native tab layout.
- Settings controls.
- Scan history.
- Photo features.
- Large instructional panels.

### Clip Shell

Create a small App Clip shell:

- top status line: connection state
- mode title
- main capture area
- bottom controls
- error/success state

No app-wide tabs.

States:

- `pairing`: connecting to browser session
- `permission`: requesting required permission
- `ready`: capture UI active
- `sending`: sending result
- `sent`: result sent
- `error`: pairing/capture/send failed

### OCR Screen Design

Base on the full OCR screen from `app/(tabs)/index.tsx`, but simplify.

Full app behavior to preserve:

- Camera first.
- Tap shutter to capture text.
- Preview extracted text.
- Allow confirm/edit before sending.
- Cursor insertion defaults to true for App Clip.

App Clip behavior:

1. Request camera permission.
2. Show camera preview.
3. User taps capture.
4. Swift module captures still image and runs Vision OCR.
5. RN screen shows extracted text in an editable preview.
6. User taps Send.
7. Send `live-text` message.
8. Show success.

Native module:

```swift
VoltClipTextRecognizer
```

Native responsibilities:

- Camera session.
- Still image capture.
- `VNRecognizeTextRequest`.
- Return ordered recognized text blocks.

RN responsibilities:

- UI state.
- Text editing.
- Send result.

### Barcode Screen Design

Base on `app/(tabs)/scanner.tsx`.

Full app behavior to preserve:

- Camera viewfinder.
- Target frame.
- Confirm a centered barcode before send.
- Avoid repeated duplicate sends.
- Support common barcode formats.

App Clip behavior:

1. Request camera permission.
2. Show scanner viewfinder immediately.
3. Native scanner detects barcode candidates.
4. RN displays active candidate value and format.
5. Send first confirmed scan automatically or via explicit Send button.

Default recommendation:

- Auto-send after a short stability threshold, not immediately on first frame.
- Stability threshold: same value detected for 2 frames or 500 ms.

Native module:

```swift
VoltClipBarcodeScanner
```

Native responsibilities:

- `AVCaptureSession`.
- Metadata output for:
  - QR
  - EAN-13
  - EAN-8
  - UPC-E
  - Code 128
  - Code 39
  - Code 93
  - Data Matrix
  - PDF417
  - Aztec
  - ITF if available
- Candidate events with value, type, bounds.

RN responsibilities:

- Frame overlay.
- Stability/confirmation logic if not done natively.
- Send result.

### Dictation Screen Design

Base on `app/(tabs)/dictation.tsx`.

Full app behavior to preserve:

- Large mic button.
- Local transcript preview.
- Final transcript only.
- Send to cursor target.

App Clip behavior:

1. Request microphone and speech recognition permission.
2. Show large mic button.
3. User taps or holds to speak.
4. Show local transcript.
5. Send only final transcript.
6. Show success.

Native module:

```swift
VoltClipDictation
```

Native responsibilities:

- `SFSpeechRecognizer`.
- `AVAudioEngine`.
- final transcript event.
- permission state.

RN responsibilities:

- Mic button state.
- Transcript preview.
- Send final transcript.

## Native Module Plan

### Swift Module Boundary

Use small purpose-built Swift modules instead of importing large Expo modules into the App Clip.

Expose NativeModules or TurboModules depending on current RN setup constraints.

Initial bridge can be classic NativeModules for speed of implementation.

Module APIs:

```ts
type BarcodeCandidate = {
  value: string;
  format: string;
  bounds?: { x: number; y: number; width: number; height: number };
};

VoltClipBarcodeScanner.start(): Promise<void>;
VoltClipBarcodeScanner.stop(): Promise<void>;
VoltClipBarcodeScanner.addListener("candidate", ...);

VoltClipTextRecognizer.captureAndRecognize(): Promise<{ text: string }>;

VoltClipDictation.requestPermissions(): Promise<{ granted: boolean }>;
VoltClipDictation.start(): Promise<void>;
VoltClipDictation.stop(): Promise<void>;
VoltClipDictation.addListener("result", ...);
```

If rendering native camera previews inside RN is painful, use native view managers:

```text
VoltClipCameraPreviewView
VoltClipBarcodeScannerView
```

This is likely cleaner for barcode and OCR because camera preview is already native.

## Transport Plan

### Lightweight HTTPS Result Relay

Use a result relay for App Clip sessions:

Server additions:

```text
POST /api/signal/:session/result
GET  /api/signal/:session/result
```

Done locally in `apps/scanner-signal/api/signal.ts`: relay sessions require a capture mode, posted results must match the session mode, and the first distinct result wins so later retries cannot overwrite the browser-bound capture.

Result payload:

```ts
{
  id: string;
  mode: "ocr" | "barcode" | "dictation";
  message: BarcodeMessage;
  createdAt: string;
}
```

Extension changes:

- When App Clip session starts, poll `/result` every 500 ms until result or timeout. Done locally in `packages/extension/src/offscreen/mobile-scanner-offscreen.ts`; relay polling times out after 30 minutes.
- On result, route through existing `handleScannerScan`.
- Stop polling after success, disconnect, timeout, or QR overlay close. Done locally; success and timeout clear the poller in the offscreen session, disconnect clears poll state, and closing the QR overlay sends `scannerDisconnect`.

App Clip changes:

- No WebRTC dependency.
- POST result over HTTPS. Done locally in `apps/mobile/app/clip/[mode].clip.tsx`; OCR, barcode, and dictation all build mode-matched scanner messages and send them through the relay result endpoint.
- Show success after 200 response. Done locally; successful sends show the sent state and instruct the user to return to Chrome.
- Surface recoverable relay failures. Done locally; stale, expired, already-used, and mode-mismatched sessions show mode-specific recovery copy.

## App Clip Target Setup

### Apple Developer

Create/register:

- Parent app id: `com.volt.mobile`
- App Clip id: `com.volt.mobile.Clip`
- Associated domain: `scanner-signal.vercel.app`

Capabilities:

- Associated Domains
- App Clip
- Camera usage
- Microphone usage
- Speech Recognition usage

### App Store Connect

Configure Advanced App Clip Experiences:

```text
https://scanner-signal.vercel.app/clip/ocr
https://scanner-signal.vercel.app/clip/barcode
https://scanner-signal.vercel.app/clip/dictation
```

Experience metadata:

- Title: `Volt OCR`, `Volt Barcode`, `Volt Dictation`
- Subtitle: `Send captures to Chrome`
- Header image/icon as required

Completion evidence to capture:

- App Store Connect screenshot showing Advanced App Clip Experiences for all three URLs.
- App Clip card opens from each URL on a physical iPhone with the full app not installed.
- App Clip card opens or routes correctly with the full app installed.
- Each experience maps to bundle id `com.volt.mobile.Clip` and domain `scanner-signal.vercel.app`.

Current status: not configured or verified in this local workspace.

### Entitlements

Parent app:

```text
applinks:scanner-signal.vercel.app
appclips:scanner-signal.vercel.app
```

App Clip:

```text
appclips:scanner-signal.vercel.app
```

The existing `apps/mobile/ios/Volt/Volt.entitlements` now includes associated domains for the full app. The generated App Clip target must have its own entitlements file.

## Server Plan

### Keep Current Endpoints

Keep:

```text
/api/signal
/api/signal/:session
/api/signal/:session/answer
/clip/:mode
/.well-known/apple-app-site-association
```

### Harden `/clip/:mode`

The current page is enough for initial association testing, but should be improved:

- Validate mode.
- Validate session format. Done locally; `/clip/:mode` now requires the same 4-80 character alphanumeric/underscore/dash session id shape as `/api/signal`.
- Use no-cache for session URLs. Done locally; `/clip/:mode` and `/api/signal` responses now set `Cache-Control: no-store`.
- Show fallback copy if App Clip is unavailable. Done locally; `/clip/:mode` renders mode-specific fallback copy for OCR, barcode, and dictation.
- Include a universal link/open button for installed app fallback if needed. Done locally; the fallback page includes an `Open App Clip` link back to the same mode-specific `/clip/:mode?session=...` invocation URL.

### Association File

Keep `apple-app-site-association` dynamic and environment-backed. Done locally in `apps/scanner-signal/api/apple-app-site-association.ts`; the endpoint uses defaults for local/prod continuity, but honors:

- `APPLE_TEAM_ID`
- `IOS_BUNDLE_ID`
- `IOS_APP_CLIP_BUNDLE_ID`

`apps/scanner-signal/scripts/validate-production.mjs` uses the same environment-backed defaults when validating AASA and `/clip/:mode` metadata.

Validate after every deploy:

```bash
curl -i https://scanner-signal.vercel.app/.well-known/apple-app-site-association
curl -i "https://scanner-signal.vercel.app/clip/ocr?session=test123"
```

## Size Management Plan

### Measure Before Feature Work

After the App Clip target is generated:

1. Build archive.
2. Export app size report.
3. Record compressed and uncompressed sizes.
4. Add a size notes section to this document.

Completion evidence to capture:

- Signed archive/export output for the parent app and App Clip.
- App thinning size report for the App Clip variant used by iPhone.
- App Store Connect or Xcode organizer size output showing the uncompressed thinned App Clip size is within the Apple limit for the supported invocation type and deployment target.
- The local `du`/ditto numbers in this document are only a build-health baseline and do not satisfy the production size gate.

### Exclude Heavy Features

Do not include in initial App Clip:

- Photos tab.
- Settings tab.
- Scan history.
- Full mobile tab navigator.
- `expo-image-manipulator`.
- ML Kit text recognition.
- Full app OCR image editor.
- Full Expo camera if native camera modules are used instead.

### Dependency Risk List

High-risk dependencies:

- `react-native-webrtc`
- `expo-camera`
- `expo-image-manipulator`
- `@react-native-ml-kit/text-recognition`
- `expo-speech-recognition`
- large icon libraries
- full Expo Router route tree

Lower-risk or useful dependencies:

- `react`
- `react-native`
- small shared protocol helpers
- minimal safe area handling if already included

### Size Gates

Set gates:

- Gate 1: empty RN App Clip target size.
- Gate 2: App Clip with mode router and shell.
- Gate 3: App Clip with session transport.
- Gate 4: App Clip with barcode.
- Gate 5: App Clip with dictation.
- Gate 6: App Clip with OCR.

Do not implement the next feature until size is measured at the current gate.

### Size Notes

Current local simulator measurements:

```text
Debug iPhone Simulator Volt Clip.app, before App Clip-only Expo exclusions: 264M uncompressed
Debug iPhone Simulator Volt Clip.app, after App Clip-only Expo exclusions: 238M uncompressed
```

Current local Release `iphoneos` measurements from a generic device build with signing disabled:

```text
Release iphoneos Volt Clip.app, before dedicated App Clip entry: 46M uncompressed
Release iphoneos Volt Clip.app, before dedicated App Clip entry: 13M ditto zip estimate
Release iphoneos Volt Clip.app, after dedicated App Clip entry: 37M uncompressed
Release iphoneos Volt Clip.app, after dedicated App Clip entry: 10M ditto zip estimate
Release iphoneos Volt Clip.app, after OCR edit UI and barcode duplicate guard: 37M uncompressed
Release iphoneos Volt Clip.app, after OCR edit UI and barcode duplicate guard: 10M ditto zip estimate
Release iphoneos Volt Clip.app, after relay recovery/session validation coverage: 37M uncompressed
Release iphoneos Volt Clip.app, after relay recovery/session validation coverage: 10M ditto zip estimate
Release iphoneos Volt Clip.app, after preflight size-report automation: 38,271,713 bytes uncompressed local bundle
Release iphoneos Volt Clip.app main.jsbundle, after preflight size-report automation: 1,452,442 bytes
Release iphoneos Volt Clip.app, after unused native package exclusions: 31,805,613 bytes uncompressed local bundle
Release iphoneos Volt Clip.app main.jsbundle, after unused native package exclusions: 1,452,442 bytes
Release iphoneos Volt Clip.app, after size-budget report metadata: 31,806,622 bytes uncompressed local bundle
Release iphoneos Volt Clip.app main.jsbundle, after size-budget report metadata: 1,453,451 bytes
```

The dedicated App Clip entry changed the Metro graph from `expo-router/entry.js` with 6901 modules to `clip-entry.tsx` with 494 modules. After adding the OCR edit UI, barcode duplicate guard, relay recovery copy, client-side session validation, and preflight size-report automation, the latest Release device build bundles `clip-entry.tsx` with 495 modules. The App Clip target now excludes native packages that the dedicated clip entry does not import, including Expo Router, Expo Asset, Expo Font, Expo Linking, AsyncStorage, MaskedView, Gesture Handler, Reanimated, Screens, SVG, Worklets, WebRTC, ML Kit, Expo Camera, Expo Speech Recognition, Expo Image Manipulator, Expo Clipboard, Expo FileSystem, Expo Haptics, Expo UI, Expo Symbols, Expo Glass Effect, Expo Keep Awake, Expo DOM WebView, and Expo LogBox. After `pod install`, `VoltClip` autolinking reports only `expo` and `react-native-safe-area-context`; Expo/ExpoModulesCore still pull Worklets-related pods transitively. The Xcode Release target dependency graph dropped from 102 targets to 89 targets, and the local unsigned App Clip bundle is now 31,806,622 bytes.

The `pnpm --filter @volt/mobile preflight:clip -- --xcode` report records `appSizeSummary` automatically from the latest local DerivedData `Volt Clip.app`. The report labels the local unsigned bundle measurement as non-thinned build-health evidence, records the conservative 15MB QR-invocation budget, and flags whether the local bundle exceeds that conservative budget. The latest local report sets `isAppleThinnedSizeReport: false` and `exceedsConservativeQrInvocationBudget: true`; App Store Connect app thinning output is still required for the production size gate. In the latest Release device build, `main.jsbundle` is 1.4M; the largest remaining files are native React/Hermes artifacts:

```text
React.framework/React: 11M
hermesvm.framework/hermesvm: 6.6M
Volt Clip executable: 4.9M
main.jsbundle: 1.4M
ReactNativeDependencies.framework/ReactNativeDependencies: 1.2M
ExpoModulesJSI.framework/ExpoModulesJSI: 1.1M
```

Previous local build before unused native package exclusions:

```text
Volt Clip executable: 12M
React.framework/React: 11M
hermesvm.framework/hermesvm: 5.7M
ReactNativeDependencies.framework/ReactNativeDependencies: 1.2M
ExpoModulesJSI.framework/ExpoModulesJSI: 1.1M
```

These are not App Store Connect compressed/thinned App Clip size reports. Apple's current App Clip gate is based on the uncompressed thinned App Clip variant after app thinning. For the current QR-driven flow and iOS 16.4 deployment target, the conservative budget is 15MB; the 100MB App Clip limit applies only to iOS 17+ variants that meet Apple's additional conditions, including no physical invocations such as QR codes, NFC tags, or App Clip Codes.

This is the current local baseline after adding:

- App Clip target and route shell.
- HTTPS result relay transport.
- Native barcode scanner module.
- Native dictation module.
- Native Vision OCR module.
- App Clip-only exclusions for WebRTC, ML Kit, Expo Camera, Expo Speech Recognition, Expo Image Manipulator, Expo Clipboard, Expo FileSystem, Expo Haptics, Expo UI, Expo Symbols, Expo Glass Effect, Expo Keep Awake, Expo DOM WebView, and Expo LogBox.
- App Clip-only exclusions for Expo Router, Expo Asset, Expo Font, Expo Linking, AsyncStorage, MaskedView, Gesture Handler, Reanimated, Screens, SVG, and Worklets native packages that are not imported by `clip-entry.tsx`.
- Dedicated App Clip bundle entry that bypasses the full Expo Router route tree.

The App Clip target still links a broad React Native runtime surface. A production size gate still requires an archive/export size report from a signed device/App Store build configuration.

## Implementation Phases

### Phase 0: Confirm App Clip Plugin Viability

Tasks:

- Add `react-native-app-clip`.
- Configure App Clip target.
- Generate native project changes.
- Build an empty App Clip.
- Measure size.

Exit criteria:

- App Clip target exists in Xcode project.
- App Clip builds locally or via EAS.
- iOS recognizes `scanner-signal.vercel.app` association.
- Size report recorded.

### Phase 1: Minimal Invocation And Routing

Tasks:

- Build App Clip entry point.
- Parse `/clip/:mode?session=...`.
- Show mode-specific shell without capture.
- Show session id/debug state.
- Open from QR into the correct screen.

Exit criteria:

- Scanning browser QR opens App Clip.
- App Clip shows OCR/barcode/dictation mode correctly.
- No capture yet.

### Phase 2: Pairing And Result Send

Tasks:

- Extract scanner session client.
- Pair to browser session.
- Send a hardcoded test message.
- Verify Chrome extension inserts test message into cursor target.

Exit criteria:

- QR scan opens App Clip.
- App Clip pairs.
- App Clip can send `hello from clip`.
- Extension inserts result into original field.

### Phase 3: Barcode

Tasks:

- Add native barcode scanner view/module.
- Recreate current viewfinder design from full app in simplified form.
- Detect supported barcode formats.
- Send confirmed scan.
- Add duplicate guard. Done locally in `apps/mobile/lib/barcode-candidate-guard.ts`; the App Clip barcode listener ignores repeated native candidates within a short duplicate window.

Exit criteria:

- App Clip barcode mode scans a real UPC/QR.
- Result inserts into browser field.
- Size remains acceptable.

### Phase 4: Dictation

Tasks:

- Add native dictation module.
- Request mic and speech permissions.
- Recreate large mic button UI from full app.
- Show transcript preview.
- Send final transcript only.

Exit criteria:

- Dictation mode records speech.
- Only final transcript is sent.
- Result inserts into browser field.
- Size remains acceptable.

### Phase 5: OCR

Tasks:

- Add native Vision OCR module.
- Add camera capture UI.
- Recreate simplified OCR shutter/preview design.
- Let user edit/confirm extracted text. Done locally in `apps/mobile/app/clip/[mode].clip.tsx`; detected OCR text is shown in a multiline editable field before `Send Text`.
- Send confirmed text.

Exit criteria:

- OCR mode captures text from camera.
- User can edit before send.
- Result inserts into browser field.
- Size remains acceptable.

### Phase 6: Fallbacks And Polish

Tasks:

- Add App Clip unavailable fallback page. Done locally in `apps/scanner-signal/api/clip.ts`; the page preserves the `apple-itunes-app` App Clip metadata, shows mode-specific fallback copy, displays the session id, and offers a retry link.
- Add timeout/retry states. Done locally for result sending in `apps/mobile/app/clip/[mode].clip.tsx`; failed sends relabel the primary action as `Try Again`, stalled result POSTs abort after 12 seconds with recovery copy, and expired/stale/already-used relay sessions show specific recovery messages from `apps/mobile/lib/clip-result-relay.ts`.
- Surface native capture failures. Done locally in `apps/mobile/app/clip/[mode].clip.tsx`; barcode and dictation native `"error"` events now update the App Clip's recoverable error state instead of being ignored.
- Add clipboard fallback messaging. Done locally in `apps/mobile/app/clip/[mode].clip.tsx`; the sent state tells the user to return to Chrome and notes that Volt will use its clipboard fallback if the page blocks insertion.
- Add close/done state. Done locally after successful result send; the App Clip tells the user the result was sent and that they can return to Chrome.
- Add analytics/debug logs only if allowed. No App Clip analytics were added locally.
- Clean up temporary logs. App Clip-specific files currently have no `console`, debug, analytics, or temporary log calls.

Exit criteria:

- User can recover from pairing failure.
- User understands if result was sent.
- No debug-only UI remains.

## Testing Plan

### Local Unit Tests

Test pure modules:

- URL parsing.
- message builders.
- session result payload encoding.
- mode routing.

Current coverage:

- `pnpm --filter @volt/mobile preflight:clip` runs the local App Clip preflight across mobile tests/typecheck, scanner-signal tests/typecheck, and extension scanner tests/compile; it writes `apps/mobile/.tmp/app-clip-preflight.json`. With `--device-sheet`, the report records a `deviceValidationSummary` for the generated production sessions, session expiry, launch matrix, capture/insertion matrix, evidence checklist, completion-gate checklist, standalone evidence-manifest path/existence, evidence-manifest template, and completion-record template. With `--xcode`, the report also records the latest local DerivedData `Volt Clip.app` path, uncompressed app bundle bytes, `main.jsbundle` bytes, conservative QR-invocation budget metadata, and an explicit `isAppleThinnedSizeReport: false` marker.
- The same preflight report records `completionReadinessSummary`. Local preflight can pass while `completionStatus` remains `pending-completion-checks`; it only changes to `ready` when every local check passes, `productionValidationPassed` confirms the live production endpoint validation command passed, `deviceValidationSheetAvailable` confirms the generated physical-device validation sheet was readable from disk, `--evidence-manifest <path>` validates a completed manifest containing App Store Connect, Apple app-thinning, physical iPhone launch, and Chrome insertion/fallback evidence, `completionRecordGenerated` confirms the dated Markdown evidence block can be generated from that manifest, and `completionRecordPlanUpdateChecked` confirms the implementation-plan update can be dry-run without writing. `deviceValidationSheetGenerated` means this preflight run actually created a fresh sheet.
- `pnpm --filter @volt/mobile test:clip` covers App Clip URL parsing, client-side session-format validation matching `scanner-signal`, scanner protocol message builders, HTTPS result relay payload encoding and failure messages, App Clip/full-app native capture permission strings, native module permission-request calls for camera, microphone, and speech recognition, native capture error-event subscription wiring, invocation-critical App Clip bundle id/entitlements, dedicated App Clip bundle entry wiring with `.clip` module resolution, App Clip unused-native-package exclusion config, a static import-boundary check that dedicated App Clip JavaScript does not import excluded native packages, barcode duplicate-candidate guarding, and App Clip preflight option parsing/report generation/size-budget detection.
- `pnpm --filter @volt/scanner-signal test:clip` covers the `/clip/:mode` fallback HTML, mode-specific fallback copy/open-link rendering, session-format validation, no-store caching for session-specific routes, default and custom environment-backed AASA payloads, production-validator assertions for configured Apple IDs/App Clip metadata, invalid fallback invocations, HTTPS result relay create/post/read flow, required relay mode binding, mode-specific relay result validation, result/session mode mismatch rejection, first-result-wins overwrite protection, and QR-ready device validation session sheet generation with session expiry metadata, launch matrix, capture/insertion matrix, required evidence filenames, completion-gate checklist, evidence-manifest template, completion-record template, and escaped literal browser-target/session markup.
- `pnpm --filter @volt/extension test:scanner` covers the Chrome-side insertion decision for App Clip `insertIntoCursor` flags, dictation fallback insertion, ordinary scan non-insertion without an explicit flag, App Clip relay session mode binding, result relay timeout wiring, and QR overlay close disconnect wiring.
- `xcodebuild -workspace apps/mobile/ios/Volt.xcworkspace -scheme VoltClip -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build` succeeds locally after unused native package exclusions and bundles the dedicated `clip-entry.tsx` entry with 495 Metro modules.
- `pnpm --filter @volt/scanner-signal exec tsc --noEmit --moduleResolution node --module esnext --target es2022 api/clip.ts api/signal.ts api/apple-app-site-association.ts` validates the App Clip fallback page, association endpoint, and result relay route.

Preflight variants:

```bash
pnpm --filter @volt/mobile preflight:clip
pnpm --filter @volt/mobile preflight:clip -- --production --device-sheet
pnpm --filter @volt/mobile preflight:clip -- --xcode
pnpm --filter @volt/mobile preflight:clip -- --production --device-sheet --evidence-manifest apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
```

Use the default preflight before ordinary App Clip changes. Use `--production --device-sheet` before physical iPhone validation. Use `--xcode` when refreshing local Release `iphoneos` build evidence. After the physical validation run, use `--evidence-manifest <path>` to make preflight validate the completed App Store Connect, app-thinning, iPhone launch, and Chrome insertion evidence manifest and verify the completion evidence block can be generated.

### Native Module Tests

Manual initially. Use `apps/mobile/docs/app-clip-device-validation.md` for the physical-device evidence runbook.

- camera permission denied
- camera permission granted
- barcode detected
- OCR no text
- OCR text detected
- dictation permission denied
- dictation final transcript

### End-To-End Tests

Manual device matrix. Use `apps/mobile/docs/app-clip-device-validation.md` to capture required App Store Connect, size, launch, capture, insertion, timeout, and clipboard fallback evidence.

- iPhone with full app not installed.
- iPhone with full app installed.
- iPhone on cellular.
- iPhone on same Wi-Fi as browser.
- QR scanned from Camera app.
- QR scanned from Safari.

Browser targets:

- plain `<input>`
- `<textarea>`
- `contenteditable`
- password field
- restricted Chrome page, expecting clipboard fallback

Mode matrix:

- OCR result inserts
- barcode result inserts
- dictation result inserts
- close QR overlay without scanning
- App Clip opened after session timeout

### Production Validation

After every deploy:

```bash
curl -i https://scanner-signal.vercel.app/.well-known/apple-app-site-association
curl -i "https://scanner-signal.vercel.app/clip/ocr?session=test123"
curl -i "https://scanner-signal.vercel.app/clip/barcode?session=test123"
curl -i "https://scanner-signal.vercel.app/clip/dictation?session=test123"
pnpm --filter @volt/scanner-signal validate:production
pnpm --filter @volt/scanner-signal create:device-validation-session
pnpm --filter @volt/scanner-signal validate:device-evidence-manifest -- apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
pnpm --filter @volt/scanner-signal generate:device-evidence-completion-record -- apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
pnpm --filter @volt/mobile apply:clip-completion-record -- --check apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
pnpm --filter @volt/mobile apply:clip-completion-record -- apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
```

Current production validation:

- Production deploy `dpl_EayBZMDCG3HXtwuD6t36Ws164UGN` is ready and aliased to `https://scanner-signal.vercel.app` as of May 24, 2026.
- `https://scanner-signal.vercel.app/.well-known/apple-app-site-association` returns HTTP 200 JSON advertising `GB5SPLUARQ.com.volt.mobile.Clip` in `appclips.apps`.
- `/clip/ocr?session=test123`, `/clip/barcode?session=test123`, and `/clip/dictation?session=test123` return HTTP 200 HTML with `apple-itunes-app` metadata for `app-clip-bundle-id=com.volt.mobile.Clip`.
- The `/clip/:mode` production responses now return `Cache-Control: no-store`.
- The production `/api/signal` relay path creates a mode-bound barcode session, accepts a valid barcode result, returns it from `GET /api/signal/:session/result`, and rejects a valid OCR-shaped result posted to that barcode session with `Result mode mismatch`.
- `pnpm --filter @volt/scanner-signal validate:production` automates the production AASA, App Clip fallback page, cache header, and live relay contract checks; it passes against `https://scanner-signal.vercel.app`.
- `pnpm --filter @volt/scanner-signal create:device-validation-session` creates fresh production relay sessions for all three modes and writes a QR-ready HTML sheet plus `apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json` for physical iPhone launch checks. The generated JSON and HTML now include `createdAt`, `expiresAt`, the 30-minute relay session TTL, the launch matrix, capture/insertion matrix, required evidence filenames, completion-gate checklist, evidence-manifest template, and completion-record template for the App Store Connect, app-thinning, launch, insertion, timeout, and clipboard-fallback artifacts.
- `pnpm --filter @volt/scanner-signal validate:device-evidence-manifest -- <manifest.json>` validates the completed physical-device evidence manifest after App Store Connect, app-thinning, iPhone launch, and Chrome insertion artifacts are captured; it fails if any completion gate is missing, duplicated, extra, pending, has changed pass criteria, lacks boolean `captured: true`, has non-string evidence notes, has duplicate or unexpected evidence filenames, lacks artifact paths, points an artifact path at a different filename, or if the manifest keeps the template `artifactDirectory`, uses an archive path that does not include the validation date, or if the completion record is missing device/app/browser/build metadata, has an invalid `validationDate`, has a `validationRunId` that does not use `YYYY-MM-DD-app-clip-validation` with the same date, still has template placeholders, includes duplicate or unexpected artifact paths, or lacks a numeric MB uncompressed thinned App Clip size value.
- `pnpm --filter @volt/scanner-signal generate:device-evidence-completion-record -- <manifest.json>` validates the same completed manifest before emitting a dated `Completion Evidence - YYYY-MM-DD` Markdown block for this plan, including the four passed completion gates, their validated pass criteria, artifact counts, and App Store Connect, full app-thinning, physical launch, and Chrome insertion evidence paths so filenames are not copied by hand.
- `pnpm --filter @volt/mobile apply:clip-completion-record -- --check <manifest.json>` validates that the generated completion evidence block can be inserted or replaced in this plan without writing during final preflight.
- `pnpm --filter @volt/mobile apply:clip-completion-record -- <manifest.json>` validates and inserts or replaces the generated completion evidence block in this plan under Production Validation, so the final evidence block does not need to be copied by hand.
- `pnpm --filter @volt/mobile preflight:clip -- --production --device-sheet --evidence-manifest <manifest.json>` validates an existing completed manifest, generates the completion evidence Markdown from it, and dry-runs the implementation-plan update without regenerating the device-validation sheet first, so the final preflight cannot overwrite the captured evidence manifest before checking it. The `--evidence-manifest` flag is intentionally rejected without an explicit manifest path, so final validation cannot accidentally fall back to a device-sheet-only run.
- `pnpm --filter @volt/mobile preflight:clip -- --production --device-sheet` passes and writes `deviceValidationSummary` to `apps/mobile/.tmp/app-clip-preflight.json`; the latest run generated 3 mode-specific sessions with `createdAt`, `expiresAt`, and `sessionTtlMinutes`, 4 launch matrix rows, 7 capture/insertion matrix rows, 18 required evidence filenames, and a completion-record template.
- The same report currently writes `completionReadinessSummary.completionStatus: pending-completion-checks` because the completed evidence manifest has not been validated against the real App Store Connect, Apple app-thinning, physical iPhone launch, and Chrome insertion/fallback artifacts.

### Current Completion Gate Status

Local implementation and production endpoint validation are in place, but the implementation is not complete until these external gates have a validated evidence manifest:

- `appStoreConnectAdvancedExperiences`: pending App Store Connect configuration screenshots for OCR, barcode, and dictation.
- `appleThinnedAppClipSize`: pending Apple app-thinning/App Store Connect size report for the App Clip variant.
- `physicalIphoneLaunch`: pending physical iPhone launch videos for no-full-app OCR/barcode/dictation and full-app-installed routing.
- `chromeCaptureInsertion`: pending real capture-to-Chrome insertion videos plus clipboard fallback and retry/close state evidence.

The authoritative local completion check is:

```bash
pnpm --filter @volt/mobile preflight:clip -- --production --device-sheet --evidence-manifest apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
```

## Resolved Decisions

### WebRTC Or HTTPS Result Relay

Resolved: use the HTTPS result relay for App Clip sessions.

Reason:

- Keeps WebRTC out of the App Clip target.
- Lets the extension preserve its existing browser insertion path.
- Gives the App Clip simple, recoverable HTTP status handling for expired, stale, already-used, and mode-mismatched sessions.

### Expo Plugin Or Manual Xcode Target

Resolved: use `react-native-app-clip` with a dedicated `VoltClip` target and dedicated `clip-entry.tsx` bundle entry.

Fallback remains manual Xcode target maintenance only if the plugin-generated target becomes incompatible with future Expo/native project changes.

### OCR Implementation Detail

Resolved: use native Vision OCR in the App Clip.

Avoid:

- ML Kit in App Clip.
- Expo image manipulation in App Clip.
- importing full OCR tab.

### Photos

Resolved: include Photo Capture in the App Clip as a small capped batch flow.

Reason:

- Store workflows need a reliable no-install path for sending product photos to the creating Chrome profile.
- Browser downloads are the durable completion path, while the sidepanel gallery is the working surface.
- Photo bytes move through Photo Object Transfer instead of scanner-signal session storage.
- The App Clip is capped at 10 photos or 100 MB total; the full mobile app can support larger Photo Capture queues.

## Risks

### App Clip Size

React Native itself may consume much of the App Clip budget. Size must be measured early.

Mitigation:

- `.clip` entry files.
- exclude packages.
- native capture modules.
- avoid full Expo route tree.
- fallback to HTTPS transport.

### App Clip Association

App Clips require Apple Developer/App Store Connect configuration. Server files alone are not enough.

Mitigation:

- verify AASA.
- verify bundle ids.
- verify entitlements.
- configure Advanced App Clip Experiences.

### Native Module Complexity

Camera preview and barcode detection may be easier as native view managers than promise-only modules.

Mitigation:

- keep native APIs narrow.
- implement barcode first.
- reuse Swift patterns for OCR camera capture.

### Pairing Timeout

The extension session may expire or restart before the user scans the QR.

Mitigation:

- show QR overlay status.
- keep session TTL at 30 minutes or show expiration.
- App Clip displays clear retry/failure state.

## Definition Of Done

The App Clip implementation is complete when:

- One App Clip target exists and builds.
- `scanner-signal.vercel.app/clip/:mode` opens the App Clip on iPhone.
- OCR, barcode, and photo route to distinct capture screens.
- Captures send valid scanner protocol messages.
- Extension inserts OCR and barcode results into the original browser cursor target.
- Extension downloads Photo Capture files to the browser computer and shows them in the Mobile Scanner or Mobile Photos gallery.
- App Clip size is within Apple requirements.
- Associated domains and App Store Connect experiences are configured.
- Full app behavior remains unchanged.
- Production scanner-signal association endpoints are validated.
