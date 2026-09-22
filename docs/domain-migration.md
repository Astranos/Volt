# Move Volt to voltresale.app

The source tree uses `https://voltresale.app` for public links, QR links, canonical URLs, and iOS associated domains. The intended Clerk endpoints are `https://clerk.voltresale.app` and `https://accounts.voltresale.app`.

## Verified before cutover

- Vercel owns and verifies `voltresale.app` for the existing Volt web project.
- The public root, `/privacy`, and `/.well-known/apple-app-site-association` return HTTP 200.
- The association file contains `GB5SPLUARQ.com.volt.mobile` and `GB5SPLUARQ.com.volt.mobile.Clip`.
- `scripts/public-domain.test.mjs` rejects retired domains in tracked source and configuration.

## Live configuration updated on September 21, 2026

The owner confirmed Clerk's production domain change. All five DNS records, TLS certificates, and mail records verified. Convex's production JWT issuer is `https://clerk.voltresale.app`; its development issuer remains on its separate development instance. The production website was redeployed from its existing production source with the new Clerk key, without deploying this PR. The Chrome release environment and native source/release configuration use the same new key. Retired web aliases redirect to the new public domain.

Google OAuth still needs its authorized redirect URI saved as `https://clerk.voltresale.app/v1/oauth_callback`. Do not claim Google sign-in works until that setting and an actual sign-in are verified. Existing installed iOS and Chrome clients still require updated releases. App Store URL metadata and App Clip experiences have the release restrictions described below. The backend fixes and new snapshot API in this PR have not been deployed.

## Cutover checklist

Before changing the primary domain:

1. Arrange an approved maintenance window and client release plan.
2. Obtain Clerk's DNS requirements for the new primary domain and configure those records in Vercel DNS. Verify both auth and account-portal TLS certificates.
3. Identify the production web, extension release, native release, and Convex configuration that must change together. Keep secret values out of this repository.
4. Confirm access to the OAuth provider configurations. Google and other configured providers may require updated redirect URLs.

During the approved cutover:

1. Change the production Clerk domain to `voltresale.app`.
2. Read the new publishable key from Clerk. Update the web and Chrome release environments and the key embedded in `apps/mobile/ios/Volt/App/AppConfiguration.swift`. Updating Fastlane environment values alone does not change this embedded value. Do not reuse the key that encodes the previous frontend host.
3. Set the production Convex JWT issuer to `https://clerk.voltresale.app` and verify its JWKS endpoint and the `convex` JWT template.
4. Update the Clerk paths, allowed origins, and OAuth redirects without removing required development or Chrome-extension origins.
5. Publish the approved web, backend, extension, and native changes through their separate release processes.
6. Verify fresh sign-in, sign-out, subscription access, photo sync, and App Clip invocation on a physical iPhone.

Do not remove the old hosting configuration before the new flow is verified. Redirecting an old website does not migrate an installed client's Clerk key or Apple's signed associated-domain entitlement.

## App Store and App Clip

Apple currently refuses marketing and privacy URL edits on the released iOS version. The next editable submission must use the values checked into `apps/mobile/fastlane/metadata/en-US/marketing_url.txt` and `privacy_url.txt`.

Apple's advanced App Clip experience API does not allow changing an existing experience's invocation URL. Create and verify a replacement experience for `https://voltresale.app/clip`, using the existing presentation assets and localized text. Release a binary containing the new associated-domain entitlement before retiring the previous experiences. Creating a version, submitting a build, and retiring experiences are separate release actions, not performed by editing the repository.
