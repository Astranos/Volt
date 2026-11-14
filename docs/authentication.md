# Authentication and access

Donut uses Clerk for identity and Convex for authorization, cloud-workspace metadata, cursor delivery, and live dictation drafts. Cloudflare R2 holds private photo bytes. Every signed-in account gets every feature: local iPhone scanning, history, the cloud workspace, and mobile capture sync, with a rolling seven-day capture history. See [workspace storage](workspace-storage.md) for retention, quotas, and cleanup. The App Clip uses a short-lived workspace guest grant created by signed-in Chrome.

## Clerk and Convex

1. In Clerk, use the same instance for the Chrome extension and full iOS app.
2. Create a JWT template named `convex`. Set its audience/application ID to `convex` and add these organization claims:

   ```json
   {
     "org_id": "{{org.id}}",
     "org_name": "{{org.name}}"
   }
   ```

   Donut also accepts Clerk's compact v2 `o.id` organization claim, but the explicit claims keep the extension, app, and Convex configuration easy to inspect.
3. Configure the Convex deployment:

   ```text
   CLERK_JWT_ISSUER_DOMAIN=https://<your-clerk-domain>
   CLERK_SECRET_KEY=sk_...
   ```

   The issuer must exactly match the Clerk JWT `iss` claim. `convex/auth.config.ts` validates tokens against it. `CLERK_SECRET_KEY` is used only by Convex, for QR sign-in and Chrome profile sign-in. Never put a Clerk secret key in the extension or app.

Convex creates one `users` record per Clerk subject.

For the full iOS app, enable Clerk's Native API and register the `com.volt.mobile` bundle identifier. Supply these Xcode build settings in each configuration instead of committing credentials:

```text
VOLT_CLERK_PUBLISHABLE_KEY=pk_...
VOLT_CLERK_FRONTEND_API_DOMAIN=<your Clerk frontend API domain>
VOLT_CLERK_JWT_TEMPLATE=convex
VOLT_CONVEX_SITE_URL=https://<deployment>.convex.site
VOLT_APP_STORE_ID=<numeric App Store app ID>
```

`VOLT_CLERK_FRONTEND_API_DOMAIN` feeds the iPhone app's `webcredentials:` associated-domain entitlement. The App Clip does not link ClerkKit or ClerkKitUI.

## QR sign-in for the iPhone app

The full app's sign-in screen offers **Sign in with QR from Chrome**, so people don't need to remember their Clerk password on the phone.

1. The app sends the typed email to `POST /api/mobile/sign-in/request`. Convex stores a hashed request secret and returns the secret to the phone. The response is identical whether or not the email belongs to an account. Each email is limited to 3 requests per 10 minutes, and all emails together share a budget of 30 new requests per minute.
2. If the email matches exactly one Clerk user with that verified address, every signed-in Chrome for that account receives the request through its Convex subscription (`mobileSignIn:pendingForComputer`) and shows a Chrome notification. Clicking one opens a QR window on that computer only. The others clear once the request closes.
3. The QR is `https://voltresale.app/app-sign-in#code=…`. The code sits in the fragment, so it never reaches a web server. Opening the QR window again replaces the code.
4. The app posts the request secret and the scanned code to `POST /api/mobile/sign-in/redeem`. Both must match, so a photo of the QR is useless on any other phone. Convex closes the request, checks the Clerk user again, and returns a 60-second Clerk sign-in ticket that the app redeems with ClerkKit's `signInWithTicket`.

Requests expire after 5 minutes. "I didn't ask for this" in the QR window declines the request. Sign-in tickets skip MFA, so accounts with two-step verification are told to use regular sign-in, and the redeem endpoint refuses them. The App Clip never takes part in this flow.

## Photo storage

Photo bytes go directly between clients and a private R2 bucket through short-lived signed URLs. Configure these Convex environment variables with a key scoped to object read/write on that bucket:

```text
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_BUCKET=<private-r2-bucket>
R2_ACCESS_KEY_ID=<bucket-scoped-access-key-id>
R2_SECRET_ACCESS_KEY=<bucket-scoped-secret-access-key>
```

## Access HTTP contract

Anonymous credentials use these headers:

```text
X-Volt-Anonymous-Id: <server-issued UUID>
X-Volt-Anonymous-Secret: <server-issued secret>
```

The secret is returned only when `POST /api/access/anonymous` creates a grant. Convex stores its SHA-256 hash, not the raw value. Calling the same endpoint with both headers validates the grant. `GET /api/access/status` accepts those headers, a fresh Clerk bearer token, or both. When both are present, anonymous usage is claimed into the Clerk account exactly once.

Signed-in accounts are always authorized. Anonymous use of the legacy Chrome session flow is limited to five sessions, after which the person is asked to sign in.

Status responses contain:

- `access`: `trial` while authorized, or `exhausted` when an anonymous grant has used its sessions. Older App Store subscribers report `subscription`.
- `isAuthorized`, `freeSessionsRemaining`, and `requiresSignIn` for the legacy session flow. `requiresSubscription` is always `false` and remains only for older clients.
- `capabilities`: local capture, cloud workspace, and AI product scanner permissions. Cloud workspace is enabled for every signed-in account. Anonymous grants do not get account cloud access.
- `aiScannerQuota`: the monthly AI scanner allowance for older app builds. See [AI product scanner](#ai-product-scanner).
- `hasFullAppAccess`, `plan`, `subscriptionStatus`, `productId`, `appAccountToken`, and `expiresAt`: legacy fields that older clients still decode. They never gate a feature; the iPhone app uses `subscriptionStatus` only to show Manage and Restore to earlier subscribers.
- `clerkUserId` for signed-in users, and an optional `organizationId`.

Join-token creation uses the same authorization:

```http
POST /api/signal/join-token
Authorization: Bearer <optional fresh Clerk JWT>
X-Volt-Anonymous-Id: <required when anonymous>
X-Volt-Anonymous-Secret: <required when anonymous>
Content-Type: application/json

{"sessionId":"<browser transport session>","usageSessionId":"<new usage-session UUID>"}
```

Creating a QR code or join token does not count as a session. Once the browser receives `hello/session_ready` on the WebRTC control channel, it reports that successful connection:

```http
POST /api/signal/join-token/<token>/session-ready
Content-Type: application/json

{"usageSessionId":"<same usage-session UUID>"}
```

Use the same authorization or anonymous headers. The response includes `startedAt` and `maxEndsAt`; clients must close a still-open channel at `maxEndsAt`. This server mutation is the only point where a session is counted, and it is idempotent by `usageSessionId`.

Report an involuntary connection loss with `POST /api/access/session/disconnect`. Report an explicit user disconnect with `POST /api/access/session/end`. Both accept `{"usageSessionId":"..."}` and the same access headers. A reconnect within, but not at, 30 minutes reuses the session. At 30 minutes disconnected, or at the 8-hour maximum, the server ends it. Reconnecting afterward requires a new `usageSessionId`.

The App Clip uses a short-lived, workspace-scoped cloud grant created by signed-in Chrome. It does not use the legacy join-token/WebRTC session and does not hold Clerk or a durable account credential. Cloud workspace and mobile capture sync use `capabilities.cloudWorkspace`. Device enrollment, capture, computer presence, and photo access require authentication or a valid scoped credential. The Chrome extension reads account status through the same Clerk user and Convex status endpoint.

## Existing App Store subscribers

The iPhone app no longer sells anything. The server still verifies App Store transactions for people who subscribed earlier, so their renewals and cancellations are recorded correctly. Those records don't unlock any feature. Every account has the same access.

That verification needs these Convex environment variables:

```text
STOREKIT_PRODUCT_ID=com.volt.mobile.pro.monthly
APPLE_BUNDLE_ID=<full-app-bundle-id>
APPLE_APP_ID=<numeric-App-Store-app-id>
APPLE_ROOT_CA_CERTIFICATES_BASE64=["<base64-DER-Apple-root-1>","<base64-DER-Apple-root-2>"]
APPLE_ENABLE_ONLINE_CHECKS=true
```

Download the current Apple root certificates from [Apple PKI](https://www.apple.com/certificateauthority/), base64-encode each DER certificate (PEM is accepted too), and store them as the JSON array above. Keep online certificate checks enabled in production.

App Store Server Notifications (version 2) for both Production and Sandbox go to `https://<convex-deployment>.convex.site/api/storekit/notifications`. The app reports transaction updates to `POST /api/storekit/transactions` with a fresh Clerk token. The server verifies every signed payload with Apple's library, matches it to the account's stored `appAccountToken`, and never trusts a client-side result alone. Replayed or older payloads cannot undo newer state.

## AI product scanner

The iOS app no longer offers the AI product scanner. The endpoint stays in place for older installed builds and can be removed once those builds are gone.

Each signed-in account gets 10 analyses per UTC calendar month by default. Set `AI_SCANNER_FREE_MONTHLY_LIMIT` on the server to change it. Older App Store subscribers have no monthly limit. A development or preview deployment can set `AI_SCANNER_QUOTA_MODE=unlimited`; that setting is server-side only. An analysis counts after the image is processed, including a response with no confident match. Validation, upstream, and server failures don't count. Ordinary barcode and text capture are never limited.

## Setup checklist

These values and dashboard actions cannot be completed from the repository:

- Clerk publishable keys, the secret key for Convex, and the `convex` JWT template
- ClerkKit and extension redirect origins allowed in Clerk
- private R2 bucket credentials scoped to object read/write
- for existing App Store subscribers: the Apple bundle ID, numeric app ID, root certificates, and Server Notification URLs

No capture, photo, OCR result, or live dictation draft is added to the access tables. Cloud-workspace tables may store synchronized OCR text, barcodes, dictation, and private-photo metadata.
