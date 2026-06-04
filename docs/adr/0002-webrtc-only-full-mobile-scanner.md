# WebRTC-Only Full Mobile Scanner

## Status

Planned.

## Context

Scout needs a full iPhone mobile app flow that pairs with the Chrome extension and sends scanner results directly to the browser. The previous App Clip/photo-object-transfer direction relied on scanner-signal and object storage for App Clip-friendly delivery and recovery. That does not match the desired full-app product:

- direct transfer between iPhone and Chrome extension
- no capture payloads or photo bytes through Vercel/object storage
- one unified mobile scanner surface for text, barcode, dictation, and photos
- sidepanel results that can be previewed, selected, and dragged into pages
- local retry for photos when WebRTC disconnects

App Clip is out of scope for this flow. The App Clip lifecycle is a poor fit for persistent retry queues, direct WebRTC transfer, pause/resume after app backgrounding, and multi-photo progress. The v1 target is iPhone only, using the full Expo SDK 56 mobile app and a dev client for native modules such as `react-native-webrtc`.

## Decision

The full mobile app will use WebRTC as the only capture transport after signaling. `scanner-signal` remains a short-lived signaling rendezvous service, but it must not carry OCR, barcode, dictation, or photo payloads.

The v1 connectivity model is direct WebRTC with STUN only. TURN is not used. This means phone and computer must be on the same network, and some networks with client isolation, VPNs, or strict firewall rules may fail to connect.

## Transport Model

- Chrome extension owns the global paired session.
- Opening the extension popup automatically shows a QR code and opens a join window.
- Closing the popup revokes the join token and stops new phones from joining.
- Existing WebRTC peers stay connected after the popup closes.
- The same visible QR token may admit multiple phones.
- Reopening the popup creates a fresh join token for the same active global session.
- QR tokens are high-entropy, valid only while visible, and rotate after a short TTL with a brief grace period.
- Chrome creates one WebRTC offer per mobile join attempt.
- Mobile scans the QR, creates a join attempt, polls for the offer, creates an answer, and posts it back.
- Chrome learns join attempts by polling scanner-signal only while the QR is visible.
- Join attempts expire quickly, around 30 seconds.

`scanner-signal` stores only short-lived signaling state:

- active join token
- join attempts
- offers and answers
- revocation/expiry state
- minimal capability metadata

It does not store capture payloads, photo bytes, OCR text, barcode values, or dictation text.

## WebRTC Channels

Each peer connection has two logical data channels:

- `scanner-control`: small messages, mode state, text/barcode results, dictation events, receipts, chunk acknowledgements, errors, session close, and capability handshake.
- `photo-transfer`: binary photo chunks and minimal photo transfer framing.

Receipts and acknowledgements stay on `scanner-control` so they remain responsive while photo bytes are moving.

## Protocol Ownership

`@volt/scanner-protocol` owns the shared contract:

- STUN/ICE config
- QR/join URL shape
- token/session id validation
- `scanner-control` message types
- `photo-transfer` message types
- protocol version constants
- encoders/decoders
- runtime validators
- dedupe keys

Runtime validation is required on both mobile and extension sides. Unsupported major versions should send `protocol_error` and disconnect the peer. Unknown optional fields may be ignored. Unknown noncritical message types may be ignored with a warning.

After `scanner-control` opens, peers exchange a lightweight capability handshake:

- protocol version
- app/extension version
- platform
- capabilities
- contributor id/device label
- active Chrome global session id

Capture UI can open before `session_ready`, but sending waits until the handshake succeeds.

## Mobile UX

The QR opens one unified scanner workspace in the full mobile app. The QR does not choose a mode.

The unified view behaves like a camera app:

- default mode for a new session: Text Extraction
- remember the last selected mode within the same active session
- modes: Text Extraction, Barcode, Photo, Dictation
- compact mode picker
- top hint for connection, cursor status, transfer progress, and warnings
- bottom capture controls

The top hint has priority order:

1. blocking error or disconnected state
2. active photo transfer progress
3. no cursor target or insertion fallback
4. normal ready state for current mode
5. last success confirmation

Examples:

- `Typing to Chrome`
- `Typing to Shopify`
- `No cursor target - saving to results`
- `Sending 4 of 12`
- `Keep app open until delivered`
- `Inserted + saved`
- `Saved to results`

iOS backgrounding or screen lock is treated as pause-and-resume, not as reliable background transfer. Users should keep the app open until photos are delivered.

## Capture Behavior

Text Extraction:

- live preview if feasible
- explicit capture/confirm before send
- always saved to Chrome sidepanel results
- type-to-cursor is default on and attempted as an extra action
- mobile success waits for a Chrome receipt

Barcode:

- always saved to Chrome sidepanel results
- type-to-cursor is default on and attempted as an extra action
- mobile success waits for a Chrome receipt
- single stable barcode may auto-send according to existing settings
- multi-barcode scenes require confirmation

Dictation:

- lives in the same unified UI with the camera feed off
- streams over `scanner-control`
- not saved to sidepanel results by default
- insertion failure warns the user
- switching away auto-stops dictation
- committed segments should be inserted, not every partial
- spacing is normalized between committed segments while preserving recognizer text

Photos:

- compressed listing-friendly JPEG renditions, not originals
- strip location metadata
- preserve orientation and useful dimensions
- target roughly `1800-2400px` max long edge and `0.72-0.82` quality
- send immediately after capture, without blocking the shutter
- current photo batch is a rolling 5-minute window
- each new shutter press extends the active photo batch
- transfer begins immediately while the batch can remain open for more photos

## Photo Delivery Contract

Photo transfer is WebRTC-only for the full app.

- Mobile owns durability until Chrome receipts each photo.
- A photo is delivered only after Chrome stores the final blob/metadata and sends `photo_received`.
- Delivered retry copies are deleted from the mobile pending queue immediately.
- The mobile app may keep lightweight in-memory thumbnails during the active app session.
- Unreceipted photos remain in a local pending queue and expire after 24 hours.
- Offline photo capture is allowed; pending photos can be sent after pairing.
- When pairing to a session with pending photos, prompt after `session_ready`: `Send 6 pending photos to this Chrome session?`
- Sending pending photos to a new Chrome session requires user confirmation.
- Storage rejection from Chrome requires explicit user retry after space is freed.
- Network reconnect retries can be automatic.

Progress is based on chunk acknowledgements and final photo receipts:

- `photo_chunk_ack` means progress/resume checkpoint for the current live transfer.
- `photo_received` means safe to delete the mobile pending copy.
- v1 may resend an unreceipted photo from chunk 0 after disconnect.
- Message shapes should keep `chunkIndex`/`totalChunks` so per-chunk resume can be added later.

Capture must not block on transfer speed:

- capture/encode queue is separate from WebRTC send queue
- sender uses `RTCDataChannel.bufferedAmount` and a small max in-flight chunk window for backpressure
- transfer worker drains safely
- user can keep taking photos unless mobile storage is low

Storage limits are based on actual device/browser storage pressure, not fixed photo counts.

## Chrome Extension UX

The extension has a global paired session, not a tab-scoped session.

Popup:

- automatically shows QR on open
- compact status only
- connected phone count
- transfer summary
- open sidepanel action
- no results list

Sidepanel:

- owns the full results timeline
- no QR rendering
- may expose an `Add phone` action that opens the popup when Chrome APIs allow it, or instructs the user to click the extension icon
- supports preview, selection, drag, delete, and undo

Cursor target tracking is continuous:

- content scripts report focus/selection changes for editable targets
- background stores latest valid target metadata per active tab/frame
- active tab's latest target wins
- if no valid target exists, text/barcode saves to sidepanel only
- restricted pages fall back to sidepanel only

## Sidepanel Results Model

The sidepanel shows one global paired-session timeline.

- Text Extraction results are individual timeline items.
- Barcode results are individual timeline items.
- Photo batches are expandable groups by `photoBatchId`.
- Dictation is not persisted in results by default.
- All results are sorted by capture time.
- Mode switching does not itself create groups.
- Text/barcode are saved even when type-to-cursor succeeds.

Photo batches:

- show only fully received, draggable photos in the gallery
- in-progress transfer appears as compact status, not partial tiles
- cancelled photos are hidden completely
- completed photos support preview and drag

Drag/select:

- multi-select is supported
- checkbox/tap selection and shift-click range selection are supported
- dragging a selected photo drags the selected set
- dragging an unselected photo drags that photo alone
- drag payload order follows visible gallery order
- v1 does not support manual reordering

Deletion:

- no `Clear session` action for v1
- deleting selected sidepanel items removes them from the current session timeline
- active paired session remains alive
- QR behavior is unaffected
- connected phones keep transferring
- deletion is immediate with undo
- deleted state survives sidepanel reloads within the current browser session
- after the undo window expires, blobs/metadata are permanently removed

Chrome session persistence:

- sidepanel gallery/results do not need to survive Chrome restart
- IndexedDB is still used for blobs/metadata during the active browser session and sidepanel/offscreen reloads
- stale active session state can be cleared on extension startup

## Multi-Phone Behavior

One Chrome global session can accept multiple WebRTC peers while the QR is visible.

- each phone gets a `contributorId`
- each join attempt gets its own `RTCPeerConnection`
- photo ids are scoped by `contributorId + batchId + photoId`
- acks/receipts are sent only to the contributing phone
- sidepanel uses one combined timeline
- contributor labels/filters can appear only when multiple phones are connected

## Failure UX

Keep user-facing failure text simple.

Pairing failure:

- `Could not connect. Try again.`
- for direct WebRTC failure, add: `Make sure iPhone and computer are on the same Wi-Fi.`

Photo transfer:

- `Waiting to reconnect`
- `Chrome storage full - 2 photos pending`
- `Keep app open until delivered`

Text/barcode:

- `Inserted + saved`
- `Saved to Chrome`
- `No cursor target - saved`
- `Failed to save`

Dictation:

- warn if insertion fails
- do not persist transcript as a sidepanel result

## Diagnostics

Diagnostics are local/dev-only for v1.

Collect metadata only:

- app/extension/protocol versions
- join attempt timing
- token age
- ICE state transitions
- data channel open/close/errors
- chunk counts and byte counts
- storage rejection reasons

Do not log capture payload contents or photo bytes. Do not send diagnostics automatically to scanner-signal.

## Implementation Plan

1. Update documentation and domain terms to reflect WebRTC-only full-app scanner and App Clip removal for this feature.
2. Add shared protocol schemas/runtime validators to `@volt/scanner-protocol`.
3. Rework scanner-signal into short-lived join-token and join-attempt signaling for full-app WebRTC.
4. Update extension offscreen code to manage a global session, join tokens, multi-peer WebRTC connections, and two data channels per peer.
5. Update extension popup to auto-open QR on mount, revoke token on close, and show compact status.
6. Update mobile deep-link pairing to join by token, poll for offer, answer Chrome's offer, and run capability handshake.
7. Build unified mobile scanner view with Text default, Photo/Barcode/Dictation modes, top hint, and pending-photo prompt.
8. Implement WebRTC text/barcode receipts and sidepanel timeline writes.
9. Implement photo transfer queue, compression, chunking, backpressure, cancellation, per-photo receipts, and local pending expiry.
10. Implement extension IndexedDB blob/metadata storage, sidepanel timeline, expandable photo batches, selection, multi-file drag, delete, and undo.
11. Add local diagnostics and focused tests for protocol validation, signaling lifecycle, receipts, dedupe, deletion, and retry behavior.

## Relationship To ADR 0001

ADR 0001 describes Photo Object Transfer for a mobile scanner model that supported App Clip and server-backed photo recovery. This ADR supersedes that approach for the full mobile app scanner. App Clip/object transfer may remain historical context or a separate future feature, but it is not part of the v1 WebRTC-only full-app scanner.
