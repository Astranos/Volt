# Authentication and billing setup

Volt uses Clerk for identity, Convex for authorization, usage, and cloud-workspace metadata, Cloudflare R2 for private photo bytes, and StoreKit for the iOS subscription. There is no Stripe integration. Live scanner control remains peer-to-peer WebRTC traffic. Captures are also copied to the authenticated Cloud Scanner Workspace when an enrolled full app or a QR-scoped App Clip guest grant is present.

## Clerk and Convex

1. In Clerk, use the same instance for the Chrome extension and full iOS app.
2. Create a JWT template named `convex`. Set its audience/application ID to `convex` and add these organization claims:

   ```json
   {
     "org_id": "{{org.id}}",
     "org_name": "{{org.name}}"
   }
   ```

   Volt also accepts Clerk's compact v2 `o.id` organization claim, but the explicit claims keep the extension, app, and Convex configuration easy to inspect.
3. Configure the Convex deployment:

   ```text
   CLERK_JWT_ISSUER_DOMAIN=https://<your-clerk-domain>
   CLERK_COMPLIMENTARY_ORGANIZATION_ID=org_<workplace-organization-id>
   CLERK_COMPLIMENTARY_USER_IDS=user_abc,user_def
   CLERK_COMPLIMENTARY_EMAILS=owner@example.com,reviewer@example.com
   CLERK_COMPLIMENTARY_EMAIL_DOMAINS=company.example
   ```

   The issuer must exactly match the Clerk JWT `iss` claim. `convex/auth.config.ts` validates tokens against it. Do not put a Clerk secret key in the extension or app.
4. Make the intended workplace Clerk Organization active for work users. Membership in the configured organization grants complimentary access and never creates a StoreKit requirement. Explicit Clerk user IDs are the most stable way to grant individual access. Email entries require Clerk's verified-email claim; domain entries apply only to the exact domain, not subdomains.

   Update individual production grants without rebuilding the app. Values are comma-separated, and replacing a value replaces the whole allowlist:

   ```sh
   pnpm exec convex env set --prod CLERK_COMPLIMENTARY_USER_IDS 'user_abc,user_def'
   pnpm exec convex env set --prod CLERK_COMPLIMENTARY_EMAILS 'owner@example.com,reviewer@example.com'
   ```

   The new entitlement is synchronized the next time that account refreshes access in Volt. Removing a user or email from the allowlist revokes the matching complimentary entitlement on its next authenticated refresh.

Convex creates one `users` record per Clerk subject. The first authenticated request generates and stores a UUID as that user's StoreKit `appAccountToken`; subsequent requests return the same value. The full app must pass that UUID to StoreKit purchases. A verified transaction can only update the Clerk user whose stored token matches the signed transaction.

For the full iOS app, enable Clerk's Native API and register the `com.volt.mobile` bundle identifier. Supply these Xcode build settings in each configuration instead of committing credentials:

```text
VOLT_CLERK_PUBLISHABLE_KEY=pk_...
VOLT_CLERK_FRONTEND_API_DOMAIN=<your Clerk frontend API domain>
VOLT_CLERK_JWT_TEMPLATE=convex
VOLT_CONVEX_SITE_URL=https://<deployment>.convex.site
VOLT_STOREKIT_PRODUCT_ID=com.volt.mobile.pro.monthly
VOLT_APP_STORE_ID=<numeric App Store app ID>
```

`VOLT_CLERK_FRONTEND_API_DOMAIN` feeds the full app's `webcredentials:` associated-domain entitlement. The App Clip does not link ClerkKit or ClerkKitUI and must remain checkout-free.

## StoreKit and App Store Connect

Create an auto-renewable monthly subscription priced at USD $9.00. The product identifier is configurable and defaults to:

```text
com.volt.mobile.pro.monthly
```

Configure a one-week free introductory offer for this subscription in App Store Connect. Eligible customers authorize the subscription before entering the full app, receive the first week free, and then renew at the displayed monthly price unless they cancel. StoreKit determines introductory-offer eligibility; Volt does not run a separate trial timer.

Configure these Convex environment variables:

```text
STOREKIT_PRODUCT_ID=com.volt.mobile.pro.monthly
APPLE_BUNDLE_ID=<full-app-bundle-id>
APPLE_APP_ID=<numeric-App-Store-app-id>
APPLE_ROOT_CA_CERTIFICATES_BASE64=["<base64-DER-Apple-root-1>","<base64-DER-Apple-root-2>"]
APPLE_ENABLE_ONLINE_CHECKS=true
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_BUCKET=<private-r2-bucket>
R2_ACCESS_KEY_ID=<bucket-scoped-access-key-id>
R2_SECRET_ACCESS_KEY=<bucket-scoped-secret-access-key>
```

Download the current Apple root certificates from [Apple PKI](https://www.apple.com/certificateauthority/), convert each certificate to DER if needed, base64-encode it, and store the values as the JSON array above. PEM certificates are accepted too. The roots are public trust material, but keeping them in deployment configuration makes rotation explicit. `APPLE_APP_ID` is required for production verification. Keep online certificate checks enabled in production; setting the value to `false` is intended only for isolated test environments.

In App Store Connect, set both the Production and Sandbox App Store Server Notification URLs to:

```text
https://<convex-deployment>.convex.site/api/storekit/notifications
```

Select notification version 2. Send a test notification after deployment and confirm a `storeKitNotifications` row is created. The endpoint verifies the outer notification JWS and nested transaction JWS with Apple's server library before changing access. Notification UUIDs and transaction IDs are idempotency keys. Invalid signatures receive HTTP 400; an unknown `appAccountToken` receives a non-2xx response so Apple can retry after the account association is repaired.

After purchase, restore, and each StoreKit transaction update, the signed-in full app sends the verified transaction's JWS representation:

```http
POST /api/storekit/transactions
Authorization: Bearer <fresh Clerk convex-template JWT>
Content-Type: application/json

{"signedTransaction":"<StoreKit signed JWS>"}
```

The server independently verifies the JWS, bundle, environment, product, expiry/revocation state, Clerk user, and `appAccountToken`. A client-side StoreKit result alone never grants access.
Transaction state advances monotonically by Apple's signed transaction date. Replayed equal or older JWS data cannot remove a newer revocation or reduce a newer expiry; stale signed notifications are recorded and acknowledged without regressing entitlement state.

## Access HTTP contract

Anonymous credentials use these headers:

```text
X-Volt-Anonymous-Id: <server-issued UUID>
X-Volt-Anonymous-Secret: <server-issued secret>
```

The secret is returned only when `POST /api/access/anonymous` creates a grant. Convex stores its SHA-256 hash, not the raw value. Calling the same endpoint with both headers validates the grant. `GET /api/access/status` accepts either those headers, a fresh Clerk bearer token, or both. When both are present, anonymous usage is claimed into the Clerk account exactly once.

Status responses contain:

- `access`: `trial`, `complimentary`, `subscription`, or `exhausted`
- `isAuthorized`, `freeSessionsRemaining`, `requiresSignIn`, and `requiresSubscription` for the legacy App Clip/Chrome session flow
- `hasFullAppAccess`, which is true only for an active StoreKit or complimentary entitlement
- `subscriptionStatus`: `none`, `active`, or `expired`
- `productId` and, for signed-in users, `clerkUserId` and `appAccountToken`
- optional `organizationId` and subscription `expiresAt`

Join-token creation is access-gated:

```http
POST /api/signal/join-token
Authorization: Bearer <optional fresh Clerk JWT>
X-Volt-Anonymous-Id: <required when anonymous>
X-Volt-Anonymous-Secret: <required when anonymous>
Content-Type: application/json

{"sessionId":"<browser transport session>","usageSessionId":"<new billing-session UUID>"}
```

Creating a QR code or join token does not consume usage. Once the browser receives `hello/session_ready` on the WebRTC control channel, it reports that successful connection:

```http
POST /api/signal/join-token/<token>/session-ready
Content-Type: application/json

{"usageSessionId":"<same billing-session UUID>"}
```

Use the same authorization or anonymous headers. The response includes `startedAt` and `maxEndsAt`; clients must close a still-open channel at `maxEndsAt`. This server mutation is the only trial-consumption point and is idempotent by `usageSessionId`.

Report an involuntary connection loss with `POST /api/access/session/disconnect`. Report an explicit user disconnect with `POST /api/access/session/end`. Both accept `{"usageSessionId":"..."}` and the same access headers. A reconnect within, but not at, 30 minutes reuses the session. At 30 minutes disconnected, or at the 8-hour maximum, the server ends it. Reconnecting afterward requires a new `usageSessionId`.

The App Clip may issue/use anonymous access but must not show StoreKit checkout. A signed-in Chrome session may include a short-lived, workspace-scoped guest cloud grant in its pairing QR so successful App Clip captures are mirrored to that account's workspace without adding Clerk or a durable account credential to the App Clip. When access is exhausted, it should hand off to the full app's App Store page. The full app requires `hasFullAppAccess`, performs Clerk sign-in and StoreKit purchase/restore, and treats an active introductory trial like any other active StoreKit entitlement. The Chrome extension reads the resulting entitlement through the same Clerk user and Convex status endpoint.

## Local completion checklist

These values and dashboard actions cannot be completed from the repository:

- Clerk publishable keys and the `convex` JWT template
- the workplace Clerk Organization ID and memberships
- ClerkKit/extension redirect origins allowed in Clerk
- the App Store subscription, price, agreements, tax, and banking status
- Apple bundle ID, numeric app ID, root-certificate values, and Server Notification V2 URLs
- production and sandbox purchase/restore tests with real signed transactions
- private R2 bucket credentials scoped to object read/write for the production bucket

No capture, photo, OCR result, SDP, or ICE payload is added to the access tables. Signaling data remains limited to rendezvous metadata. Cloud-workspace tables may store synchronized OCR text, barcodes, dictation, and private-photo metadata; photo bytes travel directly between clients and private R2 storage through short-lived signed URLs.
