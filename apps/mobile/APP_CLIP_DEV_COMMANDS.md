# App Clip Dev Commands

Quick reference for building, running, and validating the Volt mobile app and App Clip on a physical iPhone.

## Ports

- Full mobile app Metro: `8090`
- App Clip Metro: `8091`
- Keep `808x` ports free for the separate `piggies-ts/app/mobile` project.

## First-Time Setup

From the repo root:

```bash
pnpm install
cd apps/mobile/ios
pod install
cd ../../..
```

Confirm the iPhone device id:

```bash
xcrun devicectl list devices
```

Set a shell variable for repeat commands:

```bash
export VOLT_DEVICE_ID="YOUR-DEVICE-ID"
```

For Juan's currently connected iPhone during the last debug session:

```bash
export VOLT_DEVICE_ID="14073C38-B4A8-511A-A7BB-B0A1F5CA4975"
```

Confirm the variable is set before using the `xcodebuild` commands:

```bash
echo "$VOLT_DEVICE_ID"
```

If that prints a blank line, the next `xcodebuild` command will fail with `missing value for key 'id'`.

## Daily Checks

```bash
pnpm --filter @volt/mobile typecheck
pnpm --filter @volt/mobile test:clip
pnpm --filter @volt/scanner-signal test:clip
pnpm --filter @volt/scanner-signal validate:production
```

## Full Mobile App Dev Build

Start Metro for the full app on port `8090`:

```bash
pnpm --filter @volt/mobile dev
```

Build and install the full app on a device:

```bash
pnpm --filter @volt/mobile ios:device
```

If Expo asks for a device, pick the connected iPhone. For a release device build:

```bash
pnpm --filter @volt/mobile ios:device:release
```

## App Clip Dev Build

One command for the normal physical-iPhone loop:

```bash
pnpm --filter @volt/mobile clip:device
```

That command:

- Starts or reuses App Clip Metro on port `8091`.
- Finds the connected iPhone, or uses `VOLT_DEVICE_ID` if set.
- Builds `VoltClip`.
- Installs `/tmp/voltclip-debug-derived/Build/Products/Debug-iphoneos/Volt Clip.app`.
- Creates a fresh production `ocr` session.
- Launches `com.volt.mobile.Clip` with the session URL.
- Keeps Metro running until you press Ctrl-C.

Run a different mode:

```bash
pnpm --filter @volt/mobile clip:device -- --mode barcode
pnpm --filter @volt/mobile clip:device -- --mode dictation
```

Use a specific device or URL:

```bash
pnpm --filter @volt/mobile clip:device -- --device "$VOLT_DEVICE_ID"
pnpm --filter @volt/mobile clip:device -- --url "https://scanner-signal.vercel.app/clip/ocr?session=SESSION_ID"
```

Skip the rebuild and reinstall the existing `/tmp` build:

```bash
pnpm --filter @volt/mobile clip:device -- --skip-build
```

Start App Clip Metro on port `8091`:

```bash
pnpm --filter @volt/mobile dev:clip
```

In another terminal, build the App Clip for the connected iPhone:

```bash
xcodebuild \
  -workspace apps/mobile/ios/Volt.xcworkspace \
  -scheme VoltClip \
  -configuration Debug \
  -destination "id=$VOLT_DEVICE_ID" \
  -derivedDataPath /tmp/voltclip-debug-derived \
  build
```

Copy-paste version for Juan's currently connected iPhone:

```bash
xcodebuild \
  -workspace apps/mobile/ios/Volt.xcworkspace \
  -scheme VoltClip \
  -configuration Debug \
  -destination "id=14073C38-B4A8-511A-A7BB-B0A1F5CA4975" \
  -derivedDataPath /tmp/voltclip-debug-derived \
  build
```

Install the built App Clip:

```bash
xcrun devicectl device install app \
  --device "$VOLT_DEVICE_ID" \
  "/tmp/voltclip-debug-derived/Build/Products/Debug-iphoneos/Volt Clip.app"
```

Copy-paste version for Juan's currently connected iPhone:

```bash
xcrun devicectl device install app \
  --device "14073C38-B4A8-511A-A7BB-B0A1F5CA4975" \
  "/tmp/voltclip-debug-derived/Build/Products/Debug-iphoneos/Volt Clip.app"
```

## Create Fresh App Clip Validation Sessions

From the repo root:

```bash
pnpm --filter @volt/scanner-signal create:device-validation-session
```

This writes:

```text
apps/scanner-signal/.tmp/app-clip-device-validation-sessions.json
apps/scanner-signal/.tmp/app-clip-device-validation.html
apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
```

Open the generated HTML sheet on your Mac and scan the QR codes with the iPhone:

```bash
open apps/scanner-signal/.tmp/app-clip-device-validation.html
```

## Launch App Clip Directly For Debugging

Use a fresh session URL from `create:device-validation-session`.

```bash
xcrun devicectl device process launch \
  --device "$VOLT_DEVICE_ID" \
  --terminate-existing \
  --payload-url "https://scanner-signal.vercel.app/clip/ocr?session=SESSION_ID" \
  com.volt.mobile.Clip
```

Other modes:

```bash
xcrun devicectl device process launch \
  --device "$VOLT_DEVICE_ID" \
  --terminate-existing \
  --payload-url "https://scanner-signal.vercel.app/clip/barcode?session=SESSION_ID" \
  com.volt.mobile.Clip

xcrun devicectl device process launch \
  --device "$VOLT_DEVICE_ID" \
  --terminate-existing \
  --payload-url "https://scanner-signal.vercel.app/clip/dictation?session=SESSION_ID" \
  com.volt.mobile.Clip
```

The direct launch path is useful for testing JS/native behavior. For true App Clip invocation behavior, scan the QR or open the production URL on a device where the full `com.volt.mobile` app is not installed.

## Safari App Clip Test

Open a generated URL in Safari on the device:

```bash
xcrun devicectl device process launch \
  --device "$VOLT_DEVICE_ID" \
  --terminate-existing \
  --payload-url "https://scanner-signal.vercel.app/clip/ocr?session=SESSION_ID" \
  com.apple.mobilesafari
```

If the full app is installed, Safari may show an `Open in the Volt app` banner instead of the App Clip card. To test the no-install App Clip card, uninstall the full app first:

```bash
xcrun devicectl device uninstall app \
  --device "$VOLT_DEVICE_ID" \
  com.volt.mobile
```

That removes the full app and may delete its local app data.

## Confirm Installed Apps

```bash
xcrun devicectl device info apps \
  --device "$VOLT_DEVICE_ID" \
  --include-app-clips \
  --bundle-id com.volt.mobile \
  --columns "*"

xcrun devicectl device info apps \
  --device "$VOLT_DEVICE_ID" \
  --include-app-clips \
  --bundle-id com.volt.mobile.Clip \
  --columns "*"
```

## Production Scanner Signal

Validate production:

```bash
pnpm --filter @volt/scanner-signal validate:production
```

Inspect the live Apple association file:

```bash
curl -fsS https://scanner-signal.vercel.app/.well-known/apple-app-site-association | python3 -m json.tool
```

Deploy scanner-signal to production:

```bash
cd apps/scanner-signal
pnpm exec vercel deploy --prod --yes
cd ../..
```

Validate again after deploy:

```bash
pnpm --filter @volt/scanner-signal validate:production
```

## App Clip Release Build

Unsigned local release build for size and compile checks:

```bash
xcodebuild \
  -workspace apps/mobile/ios/Volt.xcworkspace \
  -scheme VoltClip \
  -configuration Release \
  -sdk iphoneos \
  -destination "generic/platform=iOS" \
  CODE_SIGNING_ALLOWED=NO \
  build
```

## Preflight

Local App Clip preflight:

```bash
pnpm --filter @volt/mobile preflight:clip
```

Preflight with production and device-session generation:

```bash
pnpm --filter @volt/mobile preflight:clip -- --production --device-sheet
```

Preflight with an evidence manifest:

```bash
pnpm --filter @volt/mobile preflight:clip -- \
  --production \
  --device-sheet \
  --evidence-manifest apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
```

## Evidence Manifest Commands

After filling the generated manifest and capturing evidence:

```bash
pnpm --filter @volt/scanner-signal validate:device-evidence-manifest -- \
  apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json

pnpm --filter @volt/scanner-signal generate:device-evidence-completion-record -- \
  apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json

pnpm --filter @volt/mobile apply:clip-completion-record -- --check \
  apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json

pnpm --filter @volt/mobile apply:clip-completion-record -- \
  apps/scanner-signal/.tmp/app-clip-device-evidence-manifest.json
```

## Common Recovery

Reinstall pods after native dependency or Expo changes:

```bash
cd apps/mobile/ios
pod install
cd ../../..
```

Stop stale Metro processes if ports are stuck:

```bash
lsof -nP -iTCP:8090 -sTCP:LISTEN
lsof -nP -iTCP:8091 -sTCP:LISTEN
```

Kill only the stale process you recognize:

```bash
kill PID
```

If the App Clip launches but shows `Missing browser session`, use a fresh URL from `create:device-validation-session` and launch with the full `https://scanner-signal.vercel.app/clip/...?...` payload URL.
