# Chrome profile authentication

Volt can use the Google account signed into the primary Chrome profile to sign into the existing linked Clerk account. Each computer receives its own Clerk session. The network does not determine identity or share sessions. Google can require consent on each browser; silent sign-in works only when Google permits it.

The feature remains disabled when `WXT_GOOGLE_CHROME_EXTENSION_CLIENT_ID` is absent. Existing tab sign-in and cookie synchronization continue to work in that configuration.

## Configure the Google client

1. In Google Cloud, configure the OAuth consent screen and create an OAuth client of type **Chrome Extension** for Volt's public extension ID: `bmgghhmlflbhlnomgnoodpidekpaaifk`.
2. Request only the `openid` and `email` scopes. If the consent application is in testing, add the intended store Google accounts as test users. Google Workspace policies can require administrator approval.
3. Set the extension's build environment variable `WXT_GOOGLE_CHROME_EXTENSION_CLIENT_ID` to that client ID. Keep the existing stable extension public key. A development extension with a different extension ID needs its own matching OAuth client.
4. Set Convex environment variables `GOOGLE_CHROME_EXTENSION_CLIENT_ID` to the same client ID, `CHROME_EXTENSION_ID` to the matching extension ID, and `CLERK_SECRET_KEY` to the server-side Clerk secret for the same instance as the extension's publishable key. Never put the secret in an extension variable.
5. Both store users must already have a verified Google external account linked in Clerk. The backend matches the Google subject to that linked external account; it does not create users or adopt an account based on an untrusted email address.

The extension and backend must both be deployed before enabling the client ID in a published extension. Configuration alone does not publish a new extension or deploy Convex functions.

## Runtime ownership

The service worker owns profile authentication and serializes simultaneous requests. It obtains the primary profile ID with `getProfileUserInfo({ accountStatus: "ANY" })`, then requests `getAuthToken` for that exact account. A missing primary Chrome login never falls back to an account signed into a Google website.

Startup requests are noninteractive. The **Sign in with Chrome profile** button permits an interactive Google authorization request. The extension sends the Google access token in the Authorization header of `POST /auth/chrome-profile` with `{ googleSubject }`. The backend verifies the credential, client ID, expiry, Google subject and existing Clerk Google-account link, and returns a short-lived single-use Clerk ticket. The extension redeems the ticket and checks the active Clerk user before declaring success.

Native profile authentication stores its client JWT in local extension storage. When profile authentication is configured, UI providers omit `syncHost`; the cookie mirror writes that cache only after the user explicitly chooses **Use another sign-in method**. That fallback imports an existing hosted session immediately and then opens the standard tab sign-in page.

Deliberate sign-out revokes the local Clerk session and records a device-local automatic-sign-in opt-out. Startup and Google identity notifications respect the opt-out. Clicking profile sign-in clears it. A primary Google profile change invalidates the old native session before obtaining another account's session. Hosted manual sign-in is an explicit override and remains in effect until the user chooses profile sign-in.

## Security and rollout checks

Clerk sign-in tickets are privileged credentials. The backend rejects users enrolled in MFA and offers the standard sign-in path. Do not enable this integration for an instance or organization requiring MFA enrollment or enterprise SSO unless that policy is checked explicitly; Clerk's ticket documentation does not guarantee those checks run during ticket redemption.

Before release, verify in real Chrome using two separate computers/profiles:

- MI01 and MI03 each resolve to their own linked Clerk user and Shopify audit connection.
- The first click can complete Google consent; later permitted startup authorization is silent.
- A profile without a Google login cannot use an account merely signed into a Google website.
- Profile switching or signing out of Chrome clears the previous native Volt account.
- Volt sign-out remains signed out after reload and worker restart.
- Manual tab sign-in and Google-denied/MFA fallback still work.
- The offscreen workspace refreshes its native session without keeping a side panel open.

Automated controller tests cover silent versus interactive requests, exact account selection, single-flight exchange, sign-out suppression, manual fallback, profile changes during activation and an in-flight exchange, backend rejection, cached-token invalidation and sender restrictions.
