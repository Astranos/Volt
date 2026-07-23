# Volt Context

Volt is a Chrome extension and companion mobile app for electronic-device resale workflows. It exists to make buying quicker, reduce repetitive lookup work, and make the listing process easier by bringing market search, offer calculation, scanning, dictation, and photo capture into one browser-centered workflow.

The product is built for resellers who buy electronics and similar inventory, then list those items for resale. The core loop is: evaluate an item quickly, decide what to pay, capture accurate product details, and prepare listing-friendly text and photos with as little manual re-entry as possible.

## Current Mobile Scanner Direction

ADR 0003 is the source of truth for the full mobile app scanner flow and supersedes ADR 0002. The full app is capture-first and cloud-backed: it records every accepted capture in a durable Local Capture Outbox before attempting delivery, synchronizes metadata through Convex, and transfers private photo bytes directly to Cloudflare R2 with short-lived presigned URLs. WebRTC is optional acceleration for live insertion and dictation and never gates capture or durable delivery.

The App Clip remains a separate free, temporary QR-triggered WebRTC experience connected to one selected Chrome computer. It does not enroll a durable mobile device or participate in the Cloud Scanner Workspace.

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
- Enrollment Grant: a single-use, short-lived QR payload created by signed-in Chrome that lets the full app obtain a Device Credential. It contains no Clerk JWT.
- Device Credential: a high-entropy opaque credential held in the iOS Keychain and represented in Convex only by a one-way hash; revoking it removes that device's workspace access without affecting the account session in Chrome.
- Local Capture Outbox: the full app's durable, local queue. A capture is accepted only after its result metadata and any photo rendition have been written here.
- Result Batch: an account-owned grouping of Capture Results. It synchronizes to every Enrolled Computer and is not owned by a selected live target.
- Capture Result: one durable OCR, barcode, photo, or saved dictation result with a stable client-generated idempotency key and delivery state.
- Cloud Photo Object: a private Cloudflare R2 object containing a Transfer Photo Rendition. Convex stores its workspace-scoped key and metadata, never its bytes.
- Delivery State: the server-authoritative per-result synchronization lifecycle, including pending upload, available, acknowledged, failed, and deleted.
- Cloud Allowance: the limited free quota available to the full app; verified subscription entitlement unlocks the robust cloud workflow and higher limits.
- Live Computer Target: the one Enrolled Computer currently selected for optional cursor insertion, live dictation, or WebRTC acceleration. It does not own ordinary Result Batches.
- Browser Capture Target: the latest editable browser target reported by the selected Live Computer Target for cursor insertion.
- Cursor-Targeted Capture: an OCR, barcode, or dictation capture optionally inserted into the Browser Capture Target in addition to durable workspace synchronization.
- Mobile Scanner Session: a short-lived WebRTC connection between a phone capture surface and a Chrome target. In the full app it is optional; in the App Clip it is the temporary delivery path.
- Scanner Work Session: the legacy WebRTC work period used for session-based access accounting. Cloud Allowance replaces it for the full cloud workflow, while it remains relevant during migration and for temporary live sessions.
- Usage Session ID: the idempotency-safe identifier for a Scanner Work Session, distinct from a browser session id, Enrollment Grant, Device Credential, and result idempotency key.
- Session Capability: a live transport capability such as OCR insertion, barcode insertion, dictation, or photo acceleration.
- Starting Capture Mode: the mode selected by the full app when capture opens; enrollment or live pairing does not choose it.
- Paired Mode Switch: changing capture modes during an optional Mobile Scanner Session without creating a new session.
- Photo Capture: a capture containing one or more listing-friendly Transfer Photo Renditions. In the full app it is durable through the Local Capture Outbox and Cloud Photo Objects.
- Photo Object Transfer: the obsolete scanner-signal/Vercel Blob design from ADR 0001. ADR 0003 uses direct client-to-R2 transfers governed by Convex metadata and authorization.
- Transfer Photo Rendition: the compressed listing-friendly JPEG stored for Photo Capture, with orientation and useful dimensions preserved and location metadata stripped.
- WebRTC Pairing Session: a Mobile Scanner Session where the phone and extension exchange scanner messages over a WebRTC data channel.
- Background Message: a request sent to the extension background worker to perform privileged browser work such as tab navigation, sidepanel control, enrollment QR generation, or clipboard access.

## Relationships

- One Volt account owns one Cloud Scanner Workspace; every workspace record and R2 object key is tenant-scoped.
- A signed-in Chrome installation becomes an Enrolled Computer and subscribes to the workspace's Result Batches, Capture Results, presence, and delivery state.
- An Enrollment Grant is created by signed-in Chrome, expires quickly, can be redeemed once, and yields a revocable Device Credential. A Clerk JWT is never encoded in the QR or stored by the phone.
- The full app opens directly into capture. Network reachability, WebRTC state, enrollment refresh, and cloud delivery never disable the shutter or recognition controls.
- The full app writes a Capture Result and any Transfer Photo Rendition to its Local Capture Outbox before showing capture success.
- Convex owns workspace identity, enrollment, presence, Result Batch and Capture Result metadata, entitlement and quota decisions, delivery state, and realtime subscriptions.
- Cloudflare R2 privately stores photo bytes. Authorized clients upload and download directly using short-lived presigned URLs; Convex never proxies photo bytes.
- Stable client-generated batch, result, and object idempotency keys make retries safe. Convex uniqueness checks and deterministic workspace-scoped object keys deduplicate repeated requests.
- Ordinary Result Batches belong to the Cloud Scanner Workspace and appear on all Enrolled Computers. Choosing a Live Computer Target changes only live cursor insertion, dictation, and optional acceleration.
- A revoked Device Credential can no longer request metadata or presigned URLs. Existing URLs expire quickly, and server-side state records the revocation for audit and retry behavior.
- Offline captures remain in the Local Capture Outbox and retry asynchronously with bounded exponential backoff and jitter. Delivery resumes after relaunch or connectivity recovery.
- Full-app access is enforced by Cloud Allowance plus verified StoreKit entitlement tied to the account's stable `appAccountToken`. Client claims alone never unlock subscription access.
- The App Clip stays free and temporary: its QR selects one Chrome computer, its WebRTC session carries its results, and it does not read or write the Cloud Scanner Workspace.
