# ADR 0004: Account-cloud-first scanner, Clerk device bootstrap, and per-result cursor deliveries

Status: Accepted
Date: 2026-07-23
Supersedes parts of: ADR 0002 (full-app WebRTC transport), amends ADR 0003

## Decision

The installed iPhone app no longer requires WebRTC, a paired Chrome session, or a
Chrome-generated enrollment QR for any capture or delivery path. Every accepted
capture belongs to the signed-in Clerk user's account workspace and synchronizes
through Convex (metadata) and R2 (photo bytes). A selected computer is only a
live cursor-insertion target: it never owns a capture or a batch, and "no live
target" is a valid state.

The App Clip is unchanged in this phase (see "App Clip boundary" below).

## 1. Mobile device bootstrap (replaces Chrome QR for the installed app)

- New endpoint `POST /api/mobile/devices/bootstrap`, authenticated with a Clerk
  bearer JWT (template `convex`), body `{ installationId, label, existingDeviceId? }`.
  - Resolves (lazily creating) the caller's account workspace.
  - If `existingDeviceId` is supplied and that device row belongs to this
    workspace and is not revoked, rotates its secret and returns it.
  - Otherwise issues a new `workspaceDevices` row with `kind: "ios"`, a fresh
    random `deviceId`, and a 32-byte secret (only the SHA-256 hash is stored).
  - Response: `{ deviceId, deviceSecret, workspaceId, clerkUserId }`.
- The phone calls bootstrap automatically after Clerk sign-in (and on app start
  when signed in without a matching credential). The credential — including
  `clerkUserId` and `workspaceId` — is stored in the iOS Keychain
  (`DeviceCredentialStore`, extended with owner fields).
- Background uploads keep using the stored device credential; they never depend
  on refreshing a Clerk token.
- The existing Chrome-QR enrollment endpoints (`/api/workspace/enrollment`,
  `/api/mobile/enrollment/exchange`) remain for compatibility but are no longer
  required or surfaced for installed-app ownership.

## 2. Ownership and account switching on the phone

- `CloudCaptureRecord` gains `ownerClerkUserId` (and `workspaceId`) stamped at
  enqueue time from the active credential/session.
- The outbox drain only uploads records whose owner matches the active
  credential's `clerkUserId`. Records owned by a different (or now signed-out)
  user enter a `held` state.
- On sign-out: uploads pause; nothing is deleted; captures continue to enqueue
  locally with no owner until sign-in (unowned records attach to the next
  signed-in account only after the explicit decision below when prior-owner
  records exist; fresh unowned records adopt the signing-in user).
- On account switch (bootstrap returns a different `clerkUserId` than held
  records): the app surfaces an explicit decision UI per pending set —
  **retain** (keep local, never upload), **export** (share sheet), **delete**,
  or **attach** (upload into the new account's workspace). Nothing uploads
  silently across accounts.

## 3. Capture is never gated on connectivity

All WebRTC-connection guards on capture entry and controls are removed: Start
Capture, add-photos, mode picker, shutter, torch/zoom/grid, photo-picker
upload queue, resend. Capture works offline, with Chrome closed, and with no
destination selected. Local persistence through `DurableCaptureOutbox` always
precedes any network delivery. Text/barcode metadata syncs via
`/api/mobile/outbox/sync`; photo bytes via scoped presigned R2 PUT URLs;
batches finalize as today. Client-generated result IDs remain the stable
idempotency keys.

## 4. Registered destinations

- Chrome installations keep their stable installation ID, friendly label, and
  renewable presence lease (`registerComputer` / `workspacePresence`).
- Canonical capability vocabulary: `workspace-results`, `cursor-insertion`,
  `photo-download`. (`dictation` is no longer advertised; unknown legacy values
  are tolerated on read.)
- New device-credential endpoint `POST /api/mobile/computers/list` returns the
  workspace's registered computers with `online` computed from the presence
  lease, plus capabilities and labels. The phone shows only online,
  cursor-capable destinations in its target picker. No Clerk JWT on the phone
  is required for this.
- Web sessions may view/copy/download/delete results but are never insertion
  targets. The model leaves room for future desktop/API/webhook destinations
  (`kind` + capabilities).

## 5. Per-phone cursor target

- The selected insertion target is a property of the enrolled iPhone, not the
  account: `workspaceDevices.cursorTargetDeviceId?` on the phone's row.
- `POST /api/mobile/cursor-target` (device credential) sets or clears it after
  verifying the target is a `chrome` device in the same workspace with the
  `cursor-insertion` capability. Clearing (null) is valid. No handshake.

## 6. Per-result cursor deliveries

New table `cursorDeliveries` (the batch-oriented `resultDeliveries` table is
retained untouched for compatibility, unused by new flows):

```
cursorDeliveries: {
  workspaceId, deliveryId,        // client-generated, idempotency key
  resultId,                       // stable client result id
  sourceDeviceId, targetDeviceId, // both workspaceDevices.deviceId values
  kind: "barcode" | "text",
  text, format?,                  // payload embedded so no join is needed
  state: "pending" | "delivered" | "failed",
  attempts, errorCode?,
  clientCreatedAt, expiresAt,     // expiresAt = clientCreatedAt + 120s
  createdAt, updatedAt, deliveredAt?
}
indexes: by_workspaceId_and_deliveryId, by_targetDeviceId_and_state,
         by_workspaceId_and_resultId
```

- OCR/barcode captures always enter account-wide Scanner Results. If insertion
  is requested and a target is selected, the phone *additionally* calls
  `POST /api/mobile/deliveries/queue` (device credential) with one delivery per
  result. Queueing is idempotent by `(workspaceId, deliveryId)`.
- The extension subscribes to the reactive Convex query
  `pendingCursorDeliveries` (Clerk auth + its installation ID, verified to be a
  registered device of the caller's workspace).
- On receipt the extension inserts into the last-focused editable field and
  acks via `acknowledgeCursorDelivery` (Clerk auth + installation ID).
  Transitions are guarded: only `pending → delivered` and `pending → failed`
  are allowed; terminal states are immutable; acks are idempotent.
- A delivery received past `expiresAt` is acked `failed` with
  `errorCode: "expired"` — never inserted late into an unrelated field. Failed
  and pending insertions remain visible in Scanner Results; re-insertion is an
  explicit user action (which creates a new delivery).
- The extension records processed `deliveryId`s in an idempotency ledger so
  reconnects/re-subscriptions can never double-insert.

## 7. Extension: reactive sync and background insertion

- The extension adds the `convex` client package. A `ConvexClient` lives in the
  offscreen document (DOM + WebSocket + Clerk token access), which already has
  keep-alive/recreate management. It maintains two subscriptions whenever
  signed in: `workspaceSnapshot` (results) and `pendingCursorDeliveries`
  (insertions), forwarding updates to the background service worker.
- Periodic `/api/workspace/snapshot` polling in the side panel is removed. The
  HTTP route remains for older clients. The `chrome.storage.local` replica is
  kept as an offline/reopen cache, but Convex is authoritative: a reopened side
  panel renders the cache, then immediately reconciles from the live query.
- Editable-field tracking moves out of side-panel mount into a manifest content
  script, so the last-focused-editable target and insertion work while the side
  panel is closed. Insertion and acking run entirely in background/offscreen.

## 8. Dictation

- Removed from the installed-app product UI and live transport: the Dictate
  tab, `DictationView`, `ScannerStoreDictation` streaming, Speech/microphone
  session, capability advertisement, and the extension's live dictation
  cursor-streaming for the full app.
- Backend read compatibility is preserved: `scanResults.kind = "dictation"`
  stays in the schema/union, snapshot normalization keeps decoding it, and no
  historical dictation data is migrated or deleted. Older clients that still
  upload dictation results continue to be accepted by the outbox routes.

## 9. Full-app WebRTC removal

After the cloud path is verified (tests green), the full app drops WebRTC:
`ScannerWebRTCConnection.swift`, paired-session UI/state
(`ScannerStorePairedSessions`, `PairingSessionsView`), reconnect/retry queues,
push-wake handling for pairings, and the Jitsi pod from the `Volt` Podfile
target. The extension's full-app pairing surfaces go with it.

**App Clip boundary (do not break):** `ScannerProtocol.swift`,
`ScannerSignalingClient.swift`, `PairingURLParser.swift`,
`PairingSecretStore.swift`, and the shared camera/UI files compile into the
`VoltClip` target (membership boundary only — there is no `APPCLIP` compilation
condition). The Clip's WebKit WebRTC transport, guest cloud grant client, and
signaling routes remain fully functional. Protocol symbols the Clip uses stay
even if the full app no longer references them; only full-app-only dead code is
deleted.

## 10. App Clip follow-up (documented boundary, not implemented here)

Future design: the Clip drops Clerk and WebRTC entirely — launched from a
web/extension QR, it receives a short-lived guest grant bound server-side to a
workspace (and optionally a destination), uploads captures through Convex/R2,
gains no durable account membership, and its results appear in the owning
account workspace. The existing `workspaceGuestGrants` + `/api/app-clip/*`
routes are the seed of that path. This phase changes nothing in the Clip.
