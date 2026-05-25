# App Clip Device Validation

Use this runbook for the remaining App Clip completion gates that cannot be proven from local builds alone.

## Preconditions

- Production scanner-signal is current:

```bash
pnpm --filter @volt/scanner-signal validate:production
```

- Fresh App Clip validation URLs are generated:

```bash
pnpm --filter @volt/scanner-signal create:device-validation-session
```

The command writes:

```text
apps/scanner-signal/.tmp/app-clip-device-validation-sessions.json
apps/scanner-signal/.tmp/app-clip-device-validation.html
apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
```

Open the HTML file on the test computer to scan mode-specific QR codes. Generate a fresh sheet if the relay sessions expire. The JSON and HTML outputs include `createdAt`, `expiresAt`, the 30-minute relay session TTL, the launch matrix, capture/insertion matrix, required evidence filenames, completion-gate checklist, evidence-manifest template, and completion-record template so the generated artifacts can be archived with the recordings from the same validation run.

- Release App Clip builds locally:

```bash
xcodebuild -workspace apps/mobile/ios/Volt.xcworkspace -scheme VoltClip -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

- Apple Developer has App IDs for:

```text
Parent app: com.volt.mobile
App Clip:   com.volt.mobile.Clip
Team id:    GB5SPLUARQ
```

## App Store Connect Evidence

Configure Advanced App Clip Experiences for:

```text
https://scanner-signal.vercel.app/clip/ocr
https://scanner-signal.vercel.app/clip/barcode
https://scanner-signal.vercel.app/clip/dictation
```

Capture evidence:

- `app-store-connect-advanced-experiences.png`
- `app-store-connect-ocr-url.png`
- `app-store-connect-barcode-url.png`
- `app-store-connect-dictation-url.png`

Pass criteria:

- Each URL maps to bundle id `com.volt.mobile.Clip`.
- Each URL uses domain `scanner-signal.vercel.app`.
- Titles are mode-specific: `Volt OCR`, `Volt Barcode`, `Volt Dictation`.

## Size Evidence

Create a signed archive/export or App Store Connect/TestFlight build that includes the App Clip.

Capture evidence:

- `app-clip-archive-summary.png`
- `app-clip-app-thinning-size-report.txt`
- `app-store-connect-app-clip-size.png`

Pass criteria:

- The size report is for a thinned iPhone App Clip variant, not the local `.app` directory size.
- The uncompressed thinned App Clip size is within Apple's limit for the supported deployment target and QR invocation flow.
- If the reported size is over the limit, stop device validation and reduce native linked surface before retesting.

## Launch Matrix

Run all rows with the Chrome extension QR overlay open and using a fresh session. Use `pnpm --filter @volt/scanner-signal create:device-validation-session` for standalone launch checks and the extension QR overlay for insertion checks.

| Device state | Network | Launcher | URL |
| --- | --- | --- | --- |
| Full app not installed | Cellular | Camera app QR | `/clip/ocr?session=...` |
| Full app not installed | Wi-Fi | Camera app QR | `/clip/barcode?session=...` |
| Full app not installed | Wi-Fi | Safari URL | `/clip/dictation?session=...` |
| Full app installed | Wi-Fi | Camera app QR | `/clip/ocr?session=...` |

Capture evidence:

- `iphone-no-full-app-ocr-launch.mov`
- `iphone-no-full-app-barcode-launch.mov`
- `iphone-no-full-app-dictation-launch.mov`
- `iphone-full-app-installed-routing.mov`

Pass criteria:

- iOS presents the App Clip card or opens the App Clip for each no-install row.
- The opened screen matches the URL mode.
- The session state does not show "Missing browser session" for fresh QR sessions.

## Capture And Insertion Matrix

Use these browser targets:

```html
<input>
<textarea>
<div contenteditable="true">
<input type="password">
chrome://version
```

Run these captures:

- OCR: capture printed text, edit the text, send it.
- Barcode: scan a UPC or QR code and send it.
- Dictation: record speech, stop, send the final transcript.
- Timeout: open an App Clip URL after the extension relay session expires.
- Close QR: close the QR overlay without scanning.

Capture evidence:

- `ocr-input-insertion.mov`
- `barcode-textarea-insertion.mov`
- `dictation-contenteditable-insertion.mov`
- `password-field-clipboard-fallback.mov`
- `restricted-page-clipboard-fallback.mov`
- `expired-session-retry-state.png`
- `close-qr-disconnect-state.png`

Pass criteria:

- OCR, barcode, and dictation insert into the original browser cursor target for editable targets.
- Password and restricted pages show the clipboard fallback behavior instead of losing the result.
- Expired sessions show retry/fresh-QR recovery copy.
- Closing the QR overlay disconnects polling and leaves no stuck scanner state.

## Completion Record

When the matrix passes, add a dated evidence block to `apps/mobile/APP_CLIP_IMPLEMENTATION_PLAN.md` with:

- Device model and iOS version.
- Browser and extension build/version.
- App build/TestFlight version.
- App Store Connect experience screenshots.
- App thinning size report value.
- Links or filenames for the recorded launch and insertion evidence.

Use the `completionRecordTemplate` from `apps/scanner-signal/.tmp/app-clip-device-validation-sessions.json` as the source shape for the dated evidence block.

Use `apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json` as the artifact checklist for the validation run. Fill each `artifactPath`, mark every captured file with boolean `captured: true`, replace every `completionRecord` placeholder with the device/app/browser/build metadata and a numeric MB uncompressed thinned App Clip size value, set `validationDate` to a real `YYYY-MM-DD` calendar date, set `validationRunId` to `YYYY-MM-DD-app-clip-validation` with the same date, and keep the completed manifest with the screenshots, recordings, and size report.

Replace the template `artifactDirectory` with the final archived evidence folder or URL for this validation run, and include the same `YYYY-MM-DD` validation date in that archive path. Every captured `artifactPath` must live under that directory and end with the evidence filename. The `completionRecord` evidence entries must use exactly the same captured artifact paths, with no duplicates, extras, or separate local filenames.

Validate the completed manifest before copying the evidence block into the implementation plan:

```bash
pnpm --filter @volt/scanner-signal validate:device-evidence-manifest -- apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
pnpm --filter @volt/mobile preflight:clip -- --production --device-sheet --evidence-manifest apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
```

When `--evidence-manifest` is supplied, mobile preflight validates the existing manifest and verifies that the completion evidence Markdown can be generated from it, without regenerating the device-validation sheet first. Generate a fresh sheet only before a new physical validation run, not after the manifest has been completed.
The same preflight also dry-runs the implementation-plan update with `apply:clip-completion-record -- --check`, so a passing final preflight proves the validated evidence block can be inserted without modifying the plan during validation.
The `--evidence-manifest` flag requires an explicit manifest path; do not run the final preflight with the flag alone or with another flag in place of the path.

Generate the completion evidence block from the same validated manifest:

```bash
pnpm --filter @volt/scanner-signal generate:device-evidence-completion-record -- apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
pnpm --filter @volt/mobile apply:clip-completion-record -- --check apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
pnpm --filter @volt/mobile apply:clip-completion-record -- apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
```

The `--check` apply command validates the plan update without writing. The apply command without `--check` inserts or replaces the generated `Completion Evidence - YYYY-MM-DD` block in `apps/mobile/APP_CLIP_IMPLEMENTATION_PLAN.md` under Production Validation. The generated block includes the four passed completion gates, their validated pass criteria, and artifact counts, plus the App Store Connect, full app-thinning, physical launch, and Chrome insertion evidence paths from the validated manifest.

Do not mark the App Clip implementation complete until the generated `completionGateChecklist` has evidence for every gate, the completed manifest preserves the generated pass criteria, and the completed manifest contains no duplicate gates, duplicate evidence rows, extra gates, or ad hoc evidence filenames:

- `appStoreConnectAdvancedExperiences`
- `appleThinnedAppClipSize`
- `physicalIphoneLaunch`
- `chromeCaptureInsertion`
