# Volt Context

Volt is a Chrome extension and companion mobile app for electronic-device resale workflows. It exists to make buying quicker, reduce repetitive lookup work, and make the listing process easier by bringing market search, offer calculation, scanning, and photo capture into one browser-centered workflow.

The product is built for resellers who buy electronics and similar inventory, then list those items for resale. The core loop is: evaluate an item quickly, decide what to pay, capture accurate product details, and prepare listing-friendly text and photos with as little manual re-entry as possible.

## Current Mobile Scanner Direction

ADR 0004 is the source of truth for the full mobile app scanner flow and supersedes ADR 0002 and the WebRTC-transport parts of ADR 0003. The full app is account-cloud-first: every accepted capture belongs to the signed-in Clerk user's Cloud Scanner Workspace, is recorded in a durable Local Capture Outbox before attempting delivery, synchronizes metadata through Convex, and transfers private photo bytes directly to Cloudflare R2 with short-lived presigned URLs. The full app bootstraps its Device Credential automatically from a Clerk bearer JWT after sign-in — no pairing, WebRTC connection, or Chrome-generated enrollment QR is required for capture or cloud sync. A selected Chrome computer is only an optional live cursor-insertion target reached through a per-result Convex delivery; it never owns a capture or a batch, and having no live target is a valid state.

The App Clip remains a separate free, temporary QR-triggered WebRTC experience connected to one selected Chrome computer. It does not enroll a durable mobile device or hold an account Device Credential; it may mirror its session results into the owning workspace only through a short-lived guest cloud grant.

## Domain Terms

- Command Menu: the CMDK-powered palette for tabs, quick links, bookmarks, tools, search providers, and history.
- New Tab: the custom browser new-tab experience with search modes, recently closed tabs, quick links, bookmarks, and sidepanel tool launchers.
- Search Provider: a configured destination that turns a query into a navigable URL.
- Search Intent: the resolved action from user input, such as opening a URL, searching a provider, or searching Shopify inventory.
- Shopify Inventory Search: a search that resolves the current Shopify store and opens the admin products page ordered by available inventory.
- Sidepanel Tool: a tool hosted in the extension sidepanel. The live sidepanel switcher currently exposes Offer Calculator and Mobile Scanner.
- Top Offer: a resale offer value calculated from a projected selling price and configurable rate rules.
- Cloud Scanner Workspace: the account-owned collection of enrolled devices, computers, Result Batches, Capture Results, delivery state, entitlement state, and quota usage synchronized by Convex.
- Enrolled Mobile Device: a full-app installation authorized for one Cloud Scanner Workspace by a revocable Device Credential.
- Enrolled Computer: a signed-in Chrome installation registered in a Cloud Scanner Workspace and eligible to receive synchronized Result Batches.
- Enrollment Grant: a single-use, short-lived QR payload created by signed-in Chrome that lets the full app obtain a Device Credential. It contains no Clerk JWT. Retained for compatibility; the installed full app now bootstraps its Device Credential automatically from its Clerk session instead of scanning one.
- Device Credential: a high-entropy opaque credential held in the iOS Keychain and represented in Convex only by a one-way hash; revoking it removes that device's workspace access without affecting the account session in Chrome.
- Local Capture Outbox: the full app's durable, local queue. A capture is accepted only after its result metadata and any photo rendition have been written here.
- Result Batch: an account-owned grouping of Capture Results. It synchronizes to every Enrolled Computer and is not owned by a selected live target.
- Capture Result: one durable OCR, barcode, or photo result with a stable client-generated idempotency key and delivery state. The schema still accepts a legacy "dictation" kind for backward-compatible reads; the full app no longer creates new dictation results.
- Cloud Photo Object: a private Cloudflare R2 object containing a Transfer Photo Rendition. Convex stores its workspace-scoped key and metadata, never its bytes.
- Delivery State: the server-authoritative per-result synchronization lifecycle, including pending upload, available, acknowledged, failed, and deleted.
- Full App Entitlement: an active, server-verified StoreKit subscription (including its introductory trial) or a complimentary manual/organization entitlement. The installed app and durable cloud workspace require it.
- Live Computer Target: the one Enrolled Computer currently selected on the phone (`cursorTargetDeviceId`) for optional per-result cursor insertion, set and cleared through a device-credentialed endpoint with no handshake. It does not own ordinary Result Batches.
- Browser Capture Target: the latest editable browser target reported by the selected Live Computer Target for cursor insertion.
- Cursor-Targeted Capture: an OCR or barcode capture optionally queued as a per-result Cursor Delivery into the Browser Capture Target in addition to durable workspace synchronization.
- Cursor Delivery: a short-lived (120s), idempotent per-result delivery record synchronized through Convex from a source mobile device to a target Enrolled Computer; it carries its own payload so no join with the Capture Result is needed. Once past expiry a delivery can never become delivered: the extension acknowledges expired pending deliveries as failed/expired when it sees them, the phone's status endpoint reports expired pending deliveries as failed, and the server refuses to record a delivered acknowledgement after expiry.
- Mobile Scanner Session: a short-lived WebRTC connection between a phone capture surface and a Chrome target. The full app no longer uses this; it is the App Clip's only delivery path.
- Scanner Work Session: the legacy WebRTC work period used for session-based access accounting. It remains relevant to the App Clip and temporary live sessions, but never unlocks the installed app.
- Usage Session ID: the idempotency-safe identifier for a Scanner Work Session, distinct from a browser session id, Enrollment Grant, Device Credential, and result idempotency key.
- Session Capability: a live transport capability such as OCR insertion, barcode insertion, dictation, or photo acceleration.
- Starting Capture Mode: the mode selected by the full app when capture opens; enrollment or live pairing does not choose it.
- Paired Mode Switch: changing capture modes during an active App Clip Mobile Scanner Session without creating a new session.
- Photo Capture: a capture containing one or more listing-friendly Transfer Photo Renditions. In the full app it is durable through the Local Capture Outbox and Cloud Photo Objects.
- Photo Object Transfer: the obsolete scanner-signal/Vercel Blob design from ADR 0001. ADR 0003 uses direct client-to-R2 transfers governed by Convex metadata and authorization.
- Transfer Photo Rendition: the compressed listing-friendly JPEG stored for Photo Capture, with orientation and useful dimensions preserved and location metadata stripped.
- WebRTC Pairing Session: a Mobile Scanner Session where the phone and extension exchange scanner messages over a WebRTC data channel.
- Background Message: a request sent to the extension background worker to perform privileged browser work such as tab navigation, sidepanel control, enrollment QR generation, or clipboard access.

## Relationships

- One Volt account owns one Cloud Scanner Workspace; every workspace record and R2 object key is tenant-scoped.
- A signed-in Chrome installation becomes an Enrolled Computer and subscribes to the workspace's Result Batches, Capture Results, presence, and delivery state.
- The full app's Device Credential is issued by a Clerk-authenticated bootstrap call after sign-in; a legacy Chrome-created Enrollment Grant (QR) still expires quickly, redeems once, and yields the same kind of credential, but is compatibility-only and not required. Neither path stores a Clerk JWT on the phone.
- The full app opens directly into capture. Network reachability, device-bootstrap state, and cloud delivery never disable the shutter or recognition controls.
- The full app writes a Capture Result and any Transfer Photo Rendition to its Local Capture Outbox before showing capture success.
- Convex owns workspace identity, enrollment, presence, Result Batch and Capture Result metadata, entitlement and quota decisions, delivery state, and realtime subscriptions.
- Cloudflare R2 privately stores photo bytes. Authorized clients upload and download directly using short-lived presigned URLs; Convex never proxies photo bytes.
- Stable client-generated batch, result, and object idempotency keys make retries safe. Convex uniqueness checks and deterministic workspace-scoped object keys deduplicate repeated requests.
- Ordinary Result Batches belong to the Cloud Scanner Workspace and appear on all Enrolled Computers. Choosing a Live Computer Target changes only optional per-result cursor insertion and never gates capture or durable delivery.
- A revoked Device Credential can no longer request metadata or presigned URLs. Existing URLs expire quickly, and server-side state records the revocation for audit and retry behavior.
- Offline captures remain in the Local Capture Outbox and retry asynchronously with bounded exponential backoff and jitter. Delivery resumes after relaunch or connectivity recovery.
- Full-app access is enforced by a verified StoreKit or complimentary entitlement. StoreKit entitlement is tied to the account's stable `appAccountToken`; client claims alone never unlock access.
- The App Clip stays free and temporary: its QR selects one Chrome computer and its WebRTC session carries its results. It mirrors its session results into the owning workspace through a short-lived guest cloud grant, but never holds an account Device Credential or Clerk session.
