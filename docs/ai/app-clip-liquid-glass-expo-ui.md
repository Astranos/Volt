# App Clip Liquid Glass, Expo UI, and Expo SDK 56

Obsolete for the active full-app scanner architecture. ADR 0002 makes the v1 scanner mobile-app-only WebRTC; this note remains historical App Clip UI context only.

This note is for agents working on the Volt App Clip control drawer, bottom mode navigation, or iOS 26 Liquid Glass behavior.

## Current Stack

- Mobile app: `apps/mobile`
- Expo SDK: `expo ~56.0.4`
- React Native: `0.85.3`
- Expo UI package: `@expo/ui ~56.0.12`
- App Clip plugin: `react-native-app-clip 0.8.0`
- App Clip entry: `apps/mobile/clip-entry.tsx`
- App Clip screen: `apps/mobile/app/clip/[mode].clip.tsx`
- Native App Clip Liquid Glass bridge:
  - `apps/mobile/ios/VoltClip/VoltClipLiquidTabBarView.swift`
  - `apps/mobile/ios/VoltClip/VoltClipLiquidTabBarViewManager.m`

## Important: SDK 56, Not SDK 26

Expo uses SDK versions such as SDK 55 and SDK 56. iOS uses platform versions such as iOS 26. When debugging Liquid Glass, be precise:

- Expo SDK 56 is the JavaScript/native module version in this repo.
- iOS 26 is the Apple OS version where native Liquid Glass APIs such as `UIGlassEffect` are available.

## What Expo Documents Say

Expo SDK 56 marks Expo UI SwiftUI APIs as stable. SwiftUI components are imported from `@expo/ui/swift-ui`, and SwiftUI trees must be wrapped in `Host`.

Expo also ships `expo-glass-effect`, whose `GlassView` uses native iOS Liquid Glass via `UIVisualEffectView`. Current docs call out two practical issues:

- `GlassView` is only available on iOS 26+ and falls back on unsupported platforms.
- Do not fade `GlassView` or its parent with React Native `opacity: 0`; use native glass animation props instead.
- Check `isGlassEffectAPIAvailable()` before using the iOS 26 glass API because some iOS 26 beta builds exposed crash-prone API availability.

Sources:

- Expo SDK 56 changelog: https://expo.dev/changelog/sdk-56
- Expo UI SwiftUI docs: https://docs.expo.dev/versions/v56.0.0/sdk/ui/swift-ui/
- Expo UI guide: https://docs.expo.dev/guides/expo-ui-swift-ui/
- Expo GlassEffect docs: https://docs.expo.dev/versions/latest/sdk/glass-effect/
- Apple `UIGlassEffect`: https://developer.apple.com/documentation/uikit/uiglasseffect

## App Clip Constraint

Do not casually import `@expo/ui`, `@expo/ui/swift-ui`, or `expo-glass-effect` from the App Clip bundle.

This repo intentionally excludes both `@expo/ui` and `expo-glass-effect` from App Clip native autolinking in `apps/mobile/app.json` and `apps/mobile/ios/Podfile`. The App Clip is size-sensitive, and the implementation plan records that excluding unused native packages is part of keeping the clip small.

If an agent wants to use Expo UI or Expo GlassEffect in the App Clip, treat it as an architecture change:

1. Remove the package from the `react-native-app-clip` `excludedPackages` list.
2. Run `pod install` or the project’s generated native sync flow.
3. Rebuild the App Clip target.
4. Run App Clip size/preflight checks.
5. Confirm the added native dependencies are worth the size and startup cost.

For the current control drawer, prefer the local native UIKit bridge.

## Current Recommended Pattern

Use the existing native bridge for App Clip glass:

- `VoltClipLiquidGlassView` for drawer/sheet glass.
- `VoltClipLiquidTabBarView` for the bottom native tab bar.
- Register via `VoltClipLiquidTabBarViewManager.m`.
- Consume from JS only after checking `UIManager.getViewManagerConfig(...)`.

The Swift bridge already guards iOS 26 APIs:

- Compile-time guard: `#if compiler(>=6.2)`
- Runtime guard: `if #available(iOS 26.0, *)`
- API existence guard: `NSClassFromString("UIGlassEffect")`
- Fallback: `UIBlurEffect` material when native Liquid Glass is unavailable.

This avoids crashing on older iOS versions and avoids making Expo UI or Expo GlassEffect part of the App Clip native dependency graph.

## Bottom Navigation Rules

For the App Clip drawer:

- Use the native `UITabBar` bridge for bottom mode switching when available.
- Render the bottom native tab bar only when the drawer is fully open, or fade it in at the end of the drawer animation.
- Keep a JS fallback for missing native view registration.
- Do not duplicate a custom JS nav and native `UITabBar` at the same time.
- Keep the tab bar height stable. Avoid content-dependent drawer height changes around the tab bar.

The native bottom nav should feel like system chrome, not a custom segmented control.

## Common Bugs And Fixes

### The App Clip crashes or renders blank on older iOS

Likely cause: direct use of iOS 26 Liquid Glass APIs without compile/runtime guards.

Fix:

- Keep `#if compiler(>=6.2)` around references to `UIGlassEffect`, `UICornerRadius`, and iOS 26-only properties.
- Keep `if #available(iOS 26.0, *)`.
- Return to `UIBlurEffect` fallback when unavailable.

### Native glass does not appear

Likely causes:

- Running on iOS below 26.
- Building with an older compiler.
- The API is unavailable on the current iOS beta.
- Parent opacity is animating to `0`.
- The native view manager was not registered with React Native.

Fix:

- Confirm `UIManager.getViewManagerConfig("VoltClipLiquidGlassView")` and `UIManager.getViewManagerConfig("VoltClipLiquidTabBarView")`.
- Avoid opacity-zero animation on glass containers when using Expo GlassEffect.
- For the local UIKit bridge, keep fallback blur active.
- Rebuild native code after changing Swift or Objective-C managers.

### The App Clip gets larger unexpectedly

Likely cause: importing a full-app native package into the clip or removing it from `excludedPackages`.

Fix:

- Check `apps/mobile/clip-entry.tsx` and `apps/mobile/app/clip/[mode].clip.tsx` imports.
- Check `apps/mobile/app.json` `react-native-app-clip.excludedPackages`.
- Run `pnpm --filter @volt/mobile test:clip`.
- The retired `preflight:clip` script is no longer available; this note is historical only.

### Metro warns about React Native deep imports

Do not import private React Native paths such as `react-native/Libraries/...` in `clip-entry.tsx`. The App Clip entry should only use public package imports.

### Expo UI Host content does not size correctly

Expo UI SwiftUI `Host` bridges SwiftUI into React Native. It needs explicit layout from React Native or SwiftUI modifiers. If using Expo UI in the full app, give `Host` stable dimensions and avoid expecting it to infer drawer or tab bar height from surrounding RN layout.

For the App Clip, avoid this path unless the dependency and size tradeoff has been accepted.

## Validation Commands

Use these after changing App Clip glass/nav code:

```bash
pnpm --filter @volt/mobile typecheck
pnpm --filter @volt/mobile test:clip
cd apps/mobile/ios && xcodebuild -workspace Volt.xcworkspace -scheme VoltClip -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

For release or size-sensitive work, also run the App Clip preflight flow documented in `apps/mobile/APP_CLIP_IMPLEMENTATION_PLAN.md`.
