# Historical: Deferred App Clip Photo Capture

This proposal is not part of the active mobile scanner architecture. Volt now
ships a checkout-free App Clip that redeems a short-lived guest grant into the
same Clerk/Convex workspace as Chrome. It sends captures through Convex/R2,
can target any online computer in that workspace, and contains neither WebRTC
nor dictation.

Keep this note only as historical context for the earlier deferred design.

## Reactivation Criteria

Revisit the App Clip architecture only when its no-install capture constraints change.

Before implementation, write a new ADR covering:

- Whether App Clip uses direct WebRTC, an object-transfer fallback, or a separate relay model.
- What reliability guarantees exist with App Clip lifecycle limits.
- How the App Clip pairs without confusing the full-app QR/WebRTC flow.
- Which code is shared with the full app and which code stays isolated.
- How size, signing, and Apple review constraints are validated on device.
