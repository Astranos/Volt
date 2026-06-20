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

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
