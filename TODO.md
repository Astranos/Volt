# TODO: iOS App Clip for Mobile Photos

Goal: add a small iOS App Clip so someone can scan/open a link on any iPhone, take a photo, and quickly send it to the Chrome extension without installing the full mobile app.

## Plan

1. Spike App Clip viability
   - Add a minimal iOS App Clip target for the mobile app.
   - Verify EAS/Xcode signing for the App Clip bundle identifier.
   - Measure the thinned App Clip size early and keep it within Apple's limits.

2. Keep the App Clip photo-only
   - Include camera permission, pairing/session handoff, flash, zoom, tap-to-focus, and one shutter action.
   - Exclude OCR, dictation, settings, history, and barcode scanning unless size and review constraints allow it later.

3. Pair directly to the extension
   - Use the App Clip invocation URL to carry or fetch the extension pairing/session payload.
   - Fall back to scanning the extension QR if the invocation URL does not include enough pairing data.

4. Send one photo fast
   - Capture a square photo, compress it, and send it over the same scanner protocol used by the full app.
   - Show clear sending/sent/error states and a retry action.

5. Validate on device
   - Test cold launch from Safari/App Clip link, QR/App Clip invocation, camera permission, photo send, and extension receive.
   - Confirm behavior when the full app is installed versus not installed.
