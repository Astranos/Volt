# Volt

Volt is a monorepo for a Chrome extension, a companion mobile scanner app, a Convex-backed scanner signaling backend, and a Vercel-hosted web/app-store support surface.

I built Volt to make buying and listing electronic devices for resale faster and easier. The app is shaped around the day-to-day resale workflow: quickly checking market prices while buying, calculating offers, capturing barcodes/text/photos from a phone, and moving clean listing information back into the browser with less manual typing.

## Packages

| Workspace | Purpose |
| --- | --- |
| `packages/extension` | Chrome extension built with WXT, React, and TypeScript. |
| `packages/scanner-protocol` | Shared scanner protocol constants, message types, and validation helpers. |
| `apps/mobile` | Native SwiftUI iOS scanner app. |
| `apps/web` | TanStack Start, Base UI, and Tailwind CSS v4 app for the Vercel landing/app-store support deployment. |
| `convex` | Convex schema, HTTP actions, Web Push action, and cleanup cron for scanner signaling state. |

## Requirements

- Node.js 22 or newer
- pnpm 10.x via Corepack
- Chrome for extension development
- Xcode for iOS builds
- Convex CLI access for signaling backend development

## Getting Started

```sh
corepack enable
pnpm install
```

Run the extension:

```sh
pnpm dev:extension
```

Run the web app:

```sh
pnpm dev:web
```

Run the mobile app on a simulator:

```sh
pnpm dev:mobile
```

Build, install, and launch the mobile app on a paired iPhone:

```sh
pnpm --filter @volt/mobile ios:device -- --id=<device-id>
```

Find the device id with:

```sh
xcrun devicectl list devices
```

For a native iOS compile check, use:

```sh
pnpm --filter @volt/mobile build:ios
```

## Environment

Local secrets must stay out of git. Convex development is configured by `npx convex dev`, which writes `.env.local` with `CONVEX_DEPLOYMENT`, `CONVEX_URL`, and `CONVEX_SITE_URL`.

Scanner signaling uses Convex environment variables for optional Web Push wakeups: `SCANNER_PUSH_VAPID_PUBLIC_KEY`, `SCANNER_PUSH_VAPID_PRIVATE_KEY`, and `SCANNER_PUSH_VAPID_SUBJECT`.

## Development Commands

```sh
pnpm test
pnpm test:convex
pnpm build:web
pnpm build:extension
pnpm zip:extension
```

The root `pnpm build` command includes the native mobile build and requires Xcode. Mobile build and release archives are produced locally with Xcode or fastlane.

For App Store Connect releases, use fastlane to build a signed IPA and upload it to TestFlight:

```sh
pnpm --filter @volt/mobile ios:beta
```

## Documentation

- [Project context](CONTEXT.md)
- [Maintainability notes](docs/maintainability.md)
- [Deferred App Clip photo capture](docs/deferred-app-clip.md)
- [Architecture decisions](docs/adr)
- [Chrome extension README](packages/extension/README.md)
- [Contributor guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License

Volt is licensed under the AGPL-3.0-or-later. See [LICENSE](LICENSE).
