# App Clip Capture Plan

## Goal

Add three no-install iPhone capture options to the existing Volt React context menu in the Chrome extension:

- OCR Scanning
- Barcode Scanner
- Dictation

Each option should launch a mode-specific App Clip experience, capture text or barcode data on iPhone, and send the result back to the Chrome extension so it can be inserted into the browser's current cursor target.

## Product Flow

1. User right-clicks in a browser input, textarea, or editable area.
2. Volt's custom React context menu opens.
3. User chooses one capture option:
   - OCR Scanning
   - Barcode Scanner
   - Dictation
4. The extension remembers the active editable target and cursor position.
5. The context menu closes.
6. The extension opens a stable pairing surface, preferably the existing Mobile Scanner sidepanel, with a mode-specific QR code.
7. User scans the QR code with iPhone.
8. iOS launches the App Clip directly into the selected mode.
9. App Clip pairs to the extension session.
10. User captures text, scans a barcode, or dictates text.
11. App Clip sends the result over the existing transport.
12. Extension inserts the result into the remembered browser cursor target, with clipboard fallback if direct insertion fails.

## App Clip Model

Use one App Clip target, not three separate App Clips.

The App Clip should support three invocation URLs:

```text
https://volt-scanner.vercel.app/clip/ocr?session=SESSION_ID
https://volt-scanner.vercel.app/clip/barcode?session=SESSION_ID
https://volt-scanner.vercel.app/clip/dictation?session=SESSION_ID
```

The same App Clip binary reads the path and routes to the matching screen:

```ts
type MobileCaptureMode = "ocr" | "barcode" | "dictation";
```

## Extension Changes

### 1. Add React Context Menu Actions

Update `packages/extension/entrypoints/context-menu.tsx`.

Add three menu actions:

```ts
{
  id: "appclip-ocr",
  label: "OCR Scanning",
  description: "Scan text with iPhone and insert it here",
  icon: ScanText,
  onInvoke: () => openMobileCapture("ocr"),
}

{
  id: "appclip-barcode",
  label: "Barcode Scanner",
  description: "Scan a barcode with iPhone and insert it here",
  icon: Barcode,
  onInvoke: () => openMobileCapture("barcode"),
}

{
  id: "appclip-dictation",
  label: "Dictation",
  description: "Dictate with iPhone and insert it here",
  icon: Mic,
  onInvoke: () => openMobileCapture("dictation"),
}
```

These actions should not require selected text. They are intended to work when the user right-clicks where a result should be inserted.

### 2. Prime The Cursor Target

Before opening the App Clip pairing UI:

- Capture the focused element before the context menu opened.
- Capture input selection start/end where available.
- Support `input`, `textarea`, and `contenteditable`.
- Reuse the existing editable tracking approach from `MobileScanner`.
- Fall back to clipboard when the active page is restricted or direct insertion fails.

### 3. Add Mode-Aware Scanner Start Message

Add a new runtime message:

```ts
{
  action: "scannerStartForMode",
  mode: "ocr" | "barcode" | "dictation"
}
```

The background/offscreen scanner handler should:

- start or reuse the WebRTC pairing session
- store the selected mode in scanner state
- build a mode-specific App Clip URL
- return the updated scanner state
- broadcast `scannerStateChanged`

### 4. Extend Scanner State

Current scanner state includes:

```ts
{
  status,
  qrCodeUrl,
  error
}
```

Extend it to include:

```ts
{
  mode: "ocr" | "barcode" | "dictation" | null
}
```

The QR URL should be mode-specific:

```text
https://volt-scanner.vercel.app/clip/dictation?session=SESSION_ID
```

not only:

```text
volt://pair?session=SESSION_ID
```

### 5. Make Mobile Scanner Sidepanel Mode-Aware

Update `packages/extension/src/components/sidepanel/MobileScanner.tsx`.

When launched from the context menu, it should show mode-specific copy:

- `Scan with iPhone for OCR Scanning`
- `Scan with iPhone for Barcode Scanner`
- `Scan with iPhone for Dictation`

The QR should remain in the sidepanel instead of the floating context menu because pairing can take several seconds.

## App Clip Changes

### 1. Invocation Routing

The App Clip reads the invocation URL:

```text
/clip/ocr
/clip/barcode
/clip/dictation
```

and opens the correct screen immediately.

### 2. Dictation Screen

App Clip requests microphone and speech recognition permissions.

It should:

- show a mic button
- show local transcript preview
- send final transcript only by default
- avoid inserting partial dictation into Chrome

Message:

```ts
{
  kind: "text",
  format: "dictation",
  barcode: transcript,
  dictationPhase: "final",
  dictationSessionId,
  insertIntoCursor: true
}
```

### 3. Barcode Screen

App Clip requests camera permission.

It should:

- open the camera viewfinder directly
- scan common barcode and QR formats
- send the first confirmed scan

Message:

```ts
{
  kind: "barcode",
  format: scannedType,
  barcode: value,
  insertIntoCursor: true
}
```

### 4. OCR Screen

App Clip requests camera permission.

It should:

- open a camera capture view
- capture an image
- run native Vision OCR
- allow the user to confirm or edit the extracted text before sending

Message:

```ts
{
  kind: "text",
  format: "live-text",
  barcode: extractedText,
  insertIntoCursor: true
}
```

OCR should use native Vision in the App Clip rather than importing the full existing Expo OCR/photo stack. This keeps the App Clip smaller and avoids pulling in unrelated mobile app dependencies.

## Transport

Reuse the existing scanner transport:

- signaling via `SCANNER_SIGNAL_URL`
- WebRTC data channel
- existing scanner protocol message shape

Do not introduce a new backend queue unless App Clip WebRTC lifecycle testing proves unreliable.

## Insert Rules

The extension should insert:

- Barcode: immediately after a confirmed scan.
- OCR: after user confirms extracted text.
- Dictation: final transcript only.

Partial dictation can be shown as preview state but should not mutate the browser field.

## Implementation Phases

### Phase 1: Mode-Aware Extension Flow

- Add context menu actions.
- Add `MobileCaptureMode`.
- Add mode-aware scanner start message.
- Generate mode-specific App Clip URLs.
- Show mode-specific QR in the sidepanel.
- Preserve insertion target before opening the sidepanel.

### Phase 2: Dictation App Clip

- Add App Clip target.
- Configure associated domains and App Clip invocation URLs.
- Route `/clip/dictation` to the dictation screen.
- Pair with extension session.
- Send final transcript to Chrome.
- Verify insertion into inputs, textareas, and contenteditable fields.

### Phase 3: Barcode App Clip

- Route `/clip/barcode` to barcode scanner.
- Add camera permission flow.
- Send confirmed barcode to Chrome.
- Verify repeated scan cooldown and duplicate handling.

### Phase 4: OCR App Clip

- Route `/clip/ocr` to OCR capture.
- Add native Vision OCR path.
- Add confirmation/edit screen.
- Send confirmed text to Chrome.
- Validate App Clip binary size and launch time.

## Risks

- App Clip binary size may become too large if shared Expo dependencies pull in camera, OCR, photos, settings, and tab UI.
- App Clip invocation setup requires App Store Connect, associated domains, and stable production URLs.
- Desktop Chrome cannot directly launch an App Clip on iPhone; QR/link handoff is required.
- Direct text insertion can fail on restricted pages or complex web apps, so clipboard fallback remains necessary.
- OCR is the heaviest feature and should be implemented after dictation and barcode scanning prove the App Clip bridge.

## MVP Definition

The first useful version is:

- React context menu has `Dictation`.
- Choosing it opens the sidepanel with a mode-specific App Clip QR.
- App Clip launches without full app install.
- User dictates text.
- Final dictated text appears in the browser cursor target.

After that works, add Barcode Scanner, then OCR Scanning.
