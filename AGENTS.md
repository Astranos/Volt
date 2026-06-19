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
