# Deferred App Clip Photo Capture

This is not part of the active mobile scanner architecture.

ADR 0002 is the source of truth for the current full-app scanner flow: the iPhone app pairs through short-lived `scanner-signal` join tokens and sends OCR, barcode, dictation, and photo payloads over direct WebRTC data channels. App Clip relay, HTTPS result relay, and Photo Object Transfer are obsolete for that full-app transport.

Keep this note only as a future product option: a photo-only App Clip might still be useful for no-install capture, but it must be designed as a separate feature with its own constraints rather than mixed into the full mobile app scanner.

## Reactivation Criteria

Reopen App Clip work only after the full mobile app WebRTC scanner is stable and the product requirement is specifically no-install photo capture.

Before implementation, write a new ADR covering:

- Whether App Clip uses direct WebRTC, an object-transfer fallback, or a separate relay model.
- What reliability guarantees exist with App Clip lifecycle limits.
- How the App Clip pairs without confusing the full-app QR/WebRTC flow.
- Which code is shared with the full app and which code stays isolated.
- How size, signing, and Apple review constraints are validated on device.
