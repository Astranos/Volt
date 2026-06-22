# Volt iOS fastlane

This package owns the iOS fastlane setup for repeatable local builds, TestFlight uploads, and App Store screenshot capture. Volt does not use Expo-hosted EAS Build workers; archives are produced locally with Xcode/fastlane.

## Research notes

- fastlane keeps project-wide settings in `fastlane/Appfile` and lane automation in `fastlane/Fastfile`.
- `build_app`/`gym` archives and exports the app through Xcode, producing an `.ipa` and dSYM output.
- `upload_to_testflight`/`pilot` uploads an existing `.ipa` to App Store Connect. fastlane documents App Store Connect API keys as the preferred authentication path because they use Apple's API, avoid 2FA prompts, and work better in CI.
- `snapshot` captures localized App Store screenshots by running an iOS UI-test scheme.
- Apple associates uploaded builds by bundle ID, marketing version, and build string. The uploaded build must finish Apple's processing before it appears in App Store Connect.
- Apple currently accepts one to ten screenshots per locale in `.jpeg`, `.jpg`, or `.png`. For iPhone, provide 6.9-inch screenshots where possible; 6.5-inch screenshots are required only if 6.9-inch screenshots are not provided. Smaller iPhone sizes can be scaled from the larger assets. The iPhone 17 Pro Max simulator produces `1320 x 2868` portrait screenshots, which App Store Connect accepts for 6.9-inch iPhone uploads.

Primary references:

- [fastlane iOS setup](https://docs.fastlane.tools/getting-started/ios/setup/)
- [fastlane Appfile](https://docs.fastlane.tools/advanced/Appfile/)
- [fastlane Fastfile](https://docs.fastlane.tools/advanced/Fastfile/)
- [fastlane build_app/gym](https://docs.fastlane.tools/actions/build_app/)
- [fastlane upload_to_testflight/pilot](https://docs.fastlane.tools/actions/upload_to_testflight/)
- [fastlane snapshot](https://docs.fastlane.tools/actions/snapshot/)
- [fastlane App Store Connect API key](https://docs.fastlane.tools/actions/app_store_connect_api_key/)
- [fastlane match/sync_code_signing](https://docs.fastlane.tools/actions/sync_code_signing/)
- [Apple upload builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/)
- [Apple TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)
- [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
- [Apple screenshot upload guidance](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots/)

## Setup

Run commands from the repo root unless noted.

```sh
pnpm --filter @volt/mobile fastlane:install
```

The mobile package has its own `Gemfile`; run fastlane through Bundler so every machine uses the locked Ruby dependencies. The package scripts set `BUNDLE_PATH=vendor/bundle` so gems install inside `apps/mobile` instead of the macOS system Ruby path. Runtime scripts also set `FASTLANE_SKIP_UPDATE_CHECK=1` to keep local and CI output stable.

On this machine, macOS system Ruby 2.6 resolves fastlane `2.230.0`; fastlane `2.235.0+` requires Ruby 3.0. Use a Ruby 3 runtime and run `bundle update fastlane` when the team wants to move to the newest fastlane release.

## Local Build Validation

Use the repo-preferred compile check:

```sh
pnpm --filter @volt/mobile build:ios
```

The fastlane wrapper calls the same command:

```sh
pnpm --filter @volt/mobile ios:fastlane:build
```

## TestFlight

The beta lane builds a Release archive with `build_app` and uploads the generated `.ipa` with `upload_to_testflight`. When `APP_STORE_CONNECT_API_KEY_PATH`, `APP_STORE_CONNECT_API_KEY_ID`, and `APP_STORE_CONNECT_ISSUER_ID` are present, the archive export also passes those credentials to Xcode with `-allowProvisioningUpdates` so automatic signing can create or update App Store distribution assets for the configured team.

```sh
APP_STORE_CONNECT_API_KEY_ID=... \
APP_STORE_CONNECT_ISSUER_ID=... \
APP_STORE_CONNECT_API_KEY_PATH=/secure/path/AuthKey_XXXXXXXXXX.p8 \
pnpm --filter @volt/mobile ios:beta
```

You can provide key content instead of a file path:

```sh
APP_STORE_CONNECT_API_KEY_ID=... \
APP_STORE_CONNECT_ISSUER_ID=... \
APP_STORE_CONNECT_API_KEY_CONTENT="$(cat /secure/path/AuthKey_XXXXXXXXXX.p8)" \
pnpm --filter @volt/mobile ios:beta
```

Supported environment variables:

- `APP_STORE_CONNECT_API_KEY_ID`: App Store Connect API key ID.
- `APP_STORE_CONNECT_ISSUER_ID`: App Store Connect issuer ID.
- `APP_STORE_CONNECT_API_KEY_PATH`: local path to the `.p8` key file. Required if Xcode should use the API key for automatic provisioning updates during export.
- `APP_STORE_CONNECT_API_KEY_CONTENT`: raw `.p8` contents when a file path is not used.
- `APP_STORE_CONNECT_API_KEY_CONTENT_BASE64`: set to `true` when `APP_STORE_CONNECT_API_KEY_CONTENT` is base64 encoded.
- `APP_STORE_CONNECT_API_KEY_DURATION`: token duration in seconds. Defaults to `1200`.
- `TESTFLIGHT_CHANGELOG`: optional TestFlight "What to Test" text.
- `FASTLANE_SKIP_WAITING_FOR_BUILD_PROCESSING`: defaults to `true`. Set to `false` if the lane should wait for Apple processing.
- `VOLT_IOS_BUNDLE_ID`: defaults to `com.volt.mobile`.
- `VOLT_APPLE_TEAM_ID`: defaults to `GB5SPLUARQ`.
- `FASTLANE_APPLE_ID`: optional Apple account email for tools that still need it.
- `APP_STORE_CONNECT_TEAM_ID`: optional App Store Connect provider/team override.

## Screenshots

The screenshot lane runs the shared `VoltScreenshots` UI-test scheme through `snapshot`.

```sh
pnpm --filter @volt/mobile ios:screenshots
```

The current UI-test harness captures one launch-state screenshot on `iPhone 17 Pro Max` for `en-US`. Expand `ios/VoltScreenshots/VoltScreenshots.swift` with additional flows when stable screenshot fixtures and navigation paths exist.

Generated screenshots are written to:

```text
apps/mobile/fastlane/screenshots/
```

Only raw App Store Connect-sized screenshots should live in this directory. Framed screenshots are useful for review, but App Store Connect rejects their resized dimensions. Generate them separately with:

```sh
pnpm --filter @volt/mobile ios:screenshots:frame
```

Framed previews are written to:

```text
apps/mobile/build/framed-screenshots/
```

Upload the raw iPhone screenshots with:

```sh
APP_STORE_CONNECT_API_KEY_ID=... \
APP_STORE_CONNECT_ISSUER_ID=... \
APP_STORE_CONNECT_API_KEY_PATH=/secure/path/AuthKey_XXXXXXXXXX.p8 \
pnpm --filter @volt/mobile ios:screenshots:upload
```

The upload lane validates screenshot dimensions before contacting App Store Connect, so framed or resized files fail locally with the offending filenames.

## Signing Scope

This setup intentionally does not add `match`. The Xcode project currently uses automatic signing for team `GB5SPLUARQ`, and the lanes preserve that first. With a file-backed App Store Connect API key, fastlane lets Xcode perform automatic provisioning updates during export. `match` would require choosing encrypted certificate/profile storage, deciding who can access those signing assets, and rotating credentials through that storage. Add it later only after that team policy is explicit.

For the beta lane to work, the local machine or CI runner still needs:

- Xcode installed with the iOS SDK used by the project.
- App Store distribution signing available to Xcode automatic signing for `com.volt.mobile`.
- An App Store Connect app record matching `com.volt.mobile`.
- An App Store Connect API key with upload access.
- A unique `CFBundleVersion`/build number for each TestFlight upload.

## Commands

```sh
pnpm --filter @volt/mobile fastlane:install
pnpm --filter @volt/mobile fastlane:lanes
pnpm --filter @volt/mobile ios:fastlane:build
pnpm --filter @volt/mobile ios:archive
pnpm --filter @volt/mobile ios:beta
pnpm --filter @volt/mobile ios:screenshots
pnpm --filter @volt/mobile ios:screenshots:upload
pnpm --filter @volt/mobile ios:screenshots:frame
```
