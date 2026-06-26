# Agent Notes

## iOS Build Verification

For native mobile iOS compile checks, prefer the repo script:

```sh
pnpm --filter @volt/mobile build:ios
```

This uses the workspace/scheme and the generic simulator destination:

```sh
xcodebuild -workspace ios/Volt.xcworkspace -scheme Volt -configuration Debug -destination 'generic/platform=iOS Simulator' build
```

Do not spend time forcing a concrete simulator ID unless you specifically need to install or launch the app; this project may only advertise the generic simulator destination for the `Volt` scheme.

## TestFlight Uploads

For App Store Connect/TestFlight uploads, the App Store Connect API key is stored locally in the repo at:

```sh
apps/mobile/fastlane/AuthKey_2LA645SSNN.p8
```

Run Fastlane from the repository root with the repo-local key path:

```sh
APP_STORE_CONNECT_API_KEY_ID=2LA645SSNN \
APP_STORE_CONNECT_ISSUER_ID=69a6de87-2df2-47e3-e053-5b8c7c11a4d1 \
APP_STORE_CONNECT_API_KEY_PATH="$PWD/apps/mobile/fastlane/AuthKey_2LA645SSNN.p8" \
FASTLANE_SKIP_WAITING_FOR_BUILD_PROCESSING=1 \
pnpm --filter @volt/mobile ios:beta
```

The `.p8` file is local signing/upload material. Do not paste its contents into chat or release notes.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
