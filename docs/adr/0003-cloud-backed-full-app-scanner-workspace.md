# Cloud-backed scanner workspace

## Status

Accepted for the cloud-workspace model. Its WebRTC migration notes are historical: neither current iOS target uses WebRTC.

## Context

WebRTC-only delivery makes capture success depend on a selected Chrome computer being online, reachable, and able to accept the result. That conflicts with the iPhone app's local capture job: a reseller must be able to open directly into capture, keep working offline, and trust that accepted results will not disappear. It also prevents the same account's other Chrome installations from seeing the work.

Volt already has Convex identity, signaling, access, and verified StoreKit work. The cloud design deepens that module into an account workspace control plane while keeping large private photo bytes out of Convex.

The App Clip has different constraints and remains intentionally temporary. It is free, QR-triggered, redeems a short-lived guest grant into the signed-in Chrome account's workspace, and does not become a durable account device.

## Decision

The iPhone app uses a capture-first local workflow. Pro accounts add a durable, cloud-backed workspace workflow:

1. A signed-in account opens directly into local capture. Account and StoreKit refresh run in the background and never gate launch.
2. It commits each accepted result and any photo rendition to a durable Local Capture Outbox before showing success.
3. A background synchronization worker uploads result metadata to Convex and photo bytes directly to private Cloudflare R2 using short-lived presigned URLs.
4. Every Chrome installation signed into the same Pro Volt account subscribes to the account's Cloud Scanner Workspace and sees the same Result Batches.
5. Selecting a computer affects cursor insertion and installed-app live dictation. It never changes ownership or visibility of ordinary batches.
6. The App Clip uses a QR-scoped guest cloud grant for capture and computer targeting without Clerk, dictation, WebRTC, or durable enrollment.

Convex owns the control plane: account/workspace identity, enrolled devices and computers, presence, batches and result metadata, delivery state, Pro capability and quota decisions, device revocation, and realtime subscriptions. Convex does not proxy photo uploads or downloads.

Cloudflare R2 owns the data plane for private photo bytes. Clients transfer bytes directly with presigned PUT and GET URLs. Object keys are server-selected, workspace-scoped, and opaque to other tenants.

## Identity and Enrollment

A signed-in Chrome installation requests an Enrollment Grant from Convex. The displayed QR contains only a high-entropy, single-use grant and routing/version information. It never contains a Clerk JWT, session cookie, R2 credential, or durable device secret.

The signed-in iPhone app bootstraps an Enrolled Mobile Device for its Clerk account and receives an opaque Device Credential. Every signed-in plan can hold this credential because the AI scanner uses it; cloud workspace operations still require Pro. The phone stores the credential in the iOS Keychain with device-only accessibility. Convex stores only a cryptographic hash. Normal app launches reuse the credential while Clerk remains the account identity.

Enrollment Grants expire after five minutes, become invalid immediately after redemption or cancellation, and are rate-limited by account and installation. Device Credentials are independently revocable. Revocation blocks metadata operations and new presigned URLs without signing the user's Chrome installations out.

An App Clip Guest Cloud Grant is distinct from iPhone workspace enrollment. It is minted only by authenticated Chrome for the workspace represented by the pairing QR, expires with the temporary session, cannot enroll a durable device, and authorizes only the App Clip capture and photo operations required for that session. The raw grant is never stored in workspace records or logs.

Chrome installations use their normal signed-in account identity and register a stable Enrolled Computer id. Computer presence is a renewable lease, not proof of batch ownership or authorization.

## Capture and Offline Behavior

The Local Capture Outbox is the iPhone app's acceptance seam. Its interface guarantees that a successful enqueue has durably written:

- a client-generated batch id and result id
- an idempotency key
- capture kind and timestamps
- text/barcode content when applicable
- normalized photo metadata and a local Transfer Photo Rendition path when applicable
- retry count, next-attempt time, and current delivery state

Camera, OCR, barcode, and photo controls never wait for WebRTC or cloud delivery. The synchronization worker operates independently and resumes after app relaunch and network recovery. iOS background execution is opportunistic; correctness depends on the durable outbox, not on guaranteed background runtime.

Convex cursor delivery may route a low-latency copy to the selected Live Computer Target. It does not remove the outbox item, consume the durable idempotency key, or count as cloud synchronization.

## Synchronization, Retries, and Delivery State

Metadata writes use stable client-generated idempotency keys. Convex enforces uniqueness within the workspace and returns the existing record for a duplicate mutation. R2 object keys are deterministically assigned from workspace, result, and rendition identity, so requesting a replacement PUT URL does not create another logical photo.

The worker retries transient failures with bounded exponential backoff and jitter. Authentication or revocation failures pause the worker and ask for re-enrollment without blocking new local captures. Quota failures retain the item locally, expose a clear state, and resume after allowance becomes available or entitlement changes. Validation and unsupported-format failures require user action and are not retried in a tight loop.

Photo synchronization is a three-step state machine:

1. reserve result metadata and an object key in Convex;
2. PUT bytes directly to R2 with a short-lived URL;
3. finalize metadata idempotently after Convex verifies the expected object identity and declared size/checksum.

A result becomes `available` only after required metadata is committed and any required photo object is finalized. Chrome acknowledgements are per Enrolled Computer and informative; one offline computer does not hold the batch in a globally pending state.

## Entitlement and Quota

Any signed-in account can use local scanning and history. Pro is a capability plan for cloud workspace and mobile capture sync. Pro comes from a verified StoreKit entitlement or a complimentary workplace or admin entitlement. Convex makes the authoritative Pro decision before cloud storage, synchronization, computer targeting, or result publication. Extension browser features remain free.

StoreKit transactions remain verified server-side and tied to the account's stable `appAccountToken`. A client-supplied product id, receipt claim, or local StoreKit state cannot grant access by itself. Idempotent quota reservations prevent retries from consuming allowance more than once.

The App Clip remains free and checkout-free. Guest-mirrored results are authorized against the workspace that minted the QR grant; the App Clip does not receive subscription management, a durable account credential, or an AI account capability.

AI product scanning is available to every signed-in account. Free accounts receive 10 analyses per UTC calendar month by default. Set `AI_SCANNER_FREE_MONTHLY_LIMIT` on the server to adjust that quota. Pro and complimentary workplace or admin Pro have no monthly AI quota. Metered deployments still apply a safety rate limit. Development and preview deployments can set `AI_SCANNER_QUOTA_MODE=unlimited` on the server. An analysis counts only after OpenRouter processes the image, including a no-confident-match result. Pre-model validation and upstream or server failures do not consume quota. The app checks AI capability when the feature is used, not at launch.

## Privacy and Tenant Isolation

Capture content is private workspace data. Convex may store OCR/barcode text and the minimum photo metadata needed for synchronization; it never receives photo bytes. R2 buckets are private and have no public object URLs. Presigned URLs are scoped to one method and object, expire after at most five minutes for PUT and ten minutes for GET, and are issued only after workspace authorization and quota checks.

Every Convex read and mutation resolves the workspace from the authenticated account, hashed Device Credential, or hashed short-lived App Clip Guest Cloud Grant. Callers cannot choose an arbitrary workspace id as authority. Every batch, result, device, computer, delivery record, and object key includes the resolved workspace identity. Tests must prove cross-workspace reads, mutation, enrollment redemption, guest-grant use, and presign attempts fail closed.

Logs and diagnostics may contain ids, state transitions, byte counts, checksums, and timing. They must not contain Device Credentials, Enrollment Grants, presigned URLs, OCR/barcode content, dictation text, or photo bytes.

## Retention and Deletion

Initial retention defaults are:

- local outbox metadata and photo files remain until cloud finalization, then local photo files are deleted promptly while lightweight delivery history may remain for 30 days;
- active cloud batches, result metadata, and R2 photos remain for 30 days unless the user deletes them earlier or a future paid policy explicitly extends retention;
- deletion creates a tombstone before removing the R2 object so every subscribed computer converges and stale retries cannot resurrect the result;
- tombstones remain for 30 days, then metadata is hard-deleted;
- expired Enrollment Grants are deleted within 24 hours; device revocation/audit metadata remains for 90 days;
- account deletion revokes credentials immediately and schedules workspace metadata and R2 objects for physical deletion within 30 days, subject to documented backup/legal obligations.

R2 lifecycle rules are defense in depth; Convex deletion jobs remain the authoritative cleanup path. Failed cleanup is retryable and observable.

## Presence and Live Targeting

Enrolled Computers renew short presence leases. The phone may select one present computer as its Live Computer Target. The selection is workspace metadata used only to route cursor insertion and installed-app live dictation.

Result Batches never carry a required destination computer id. All Enrolled Computers query the same account workspace. A computer that returns after being offline catches up through Convex instead of asking the phone to resend.

## Device Revocation

Revocation records the device id, time, and actor, invalidates the stored credential hash, cancels unredeemed grants created for that device flow, and rejects future metadata and presign requests. Already issued presigned URLs are not centrally retractable, so their short expiry limits exposure. Highly sensitive revocation may additionally rotate or delete an unfinalized object key.

The phone keeps uncopied captures in its Local Capture Outbox after revocation. It may continue capturing locally and offers re-enrollment; it must not silently move those captures into a different account workspace. Re-enrollment to another account requires an explicit user choice about retaining, exporting, or deleting the old local outbox.

## Migration from ADR 0002

This completed migration did not discard local captures:

1. Add the Convex workspace schema, enrollment, quotas, delivery state, and private R2 presign module behind configuration flags.
2. Add Pro workspace Device Credential enrollment and the Local Capture Outbox. During this phase, existing WebRTC delivery may run as acceleration, but outbox persistence happens first.
3. Add Chrome account-workspace subscription and merge cloud results into the sidepanel using stable result ids. Keep existing live peer handling for cursor insertion/dictation and mint an optional short-lived guest cloud grant for App Clip pairing.
4. Enable cloud synchronization for enrolled Pro devices. Treat WebRTC receipts as live-delivery telemetry, not durable completion.
5. Stop creating new WebRTC-only workspace retry records after cloud delivery is verified. Existing 24-hour retry records remain readable until they expire; do not bulk-upload them without user consent.
6. Remove obsolete WebRTC requirements from both iOS targets and use the App Clip's QR-scoped guest workspace grant as its capture transport.

No migration step may discard a local pending capture. Schema changes are additive until all supported clients understand the new delivery states.

## Consequences

The iPhone app works offline and no longer depends on a selected computer. Account results converge across Chrome installations, and capture acceptance has one durable local seam. Photo bytes avoid Convex bandwidth and size limits.

The system now operates two intentionally different products: a temporary App Clip cloud path authorized by a QR-scoped guest grant, and a durable Pro workspace path for the iPhone app and Chrome. Local iPhone capture remains available to every signed-in account. The system also assumes responsibility for private object storage, retention jobs, quota reservations, device credentials, guest grants, tombstones, and migration compatibility. These costs are accepted because they are required for reliable capture and account-wide synchronization.
