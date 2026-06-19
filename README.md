# Volt

Volt is a monorepo for a Chrome extension, a companion mobile scanner app, a web pairing surface, and a small scanner signaling service.

I built Volt to make buying and listing electronic devices for resale faster and easier. The app is shaped around the day-to-day resale workflow: quickly checking market prices while buying, calculating offers, capturing barcodes/text/photos from a phone, and moving clean listing information back into the browser with less manual typing.

## Packages

| Workspace | Purpose |
| --- | --- |
| `packages/extension` | Chrome extension built with WXT, React, and TypeScript. |
| `packages/scanner-protocol` | Shared scanner protocol constants, message types, and validation helpers. |
| `apps/mobile` | Native SwiftUI iOS scanner app. |
| `apps/web` | Vite web app used for scanner pairing and web flows. |
| `apps/scanner-signal` | Vercel-hosted signaling API for scanner sessions, push, and dictation tokens. |

## Requirements

- Node.js 22 or newer
- pnpm 10.x via Corepack
- Chrome for extension development
- Xcode for iOS builds
- Vercel CLI for the scanner signaling service

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

Local secrets must stay out of git. The scanner signaling app documents its required environment variables in:

```sh
apps/scanner-signal/.env.example
```

Copy that file to `apps/scanner-signal/.env.local` for local Vercel development.

## Development Commands

```sh
pnpm test
pnpm build:web
pnpm build:extension
pnpm zip:extension
```

The root `pnpm build` command includes the native mobile build and requires Xcode.

For App Store Connect releases, export a signed native IPA with Xcode, then use EAS as the submission transport:

```sh
pnpm exec eas submit -p ios --profile production --path <path-to-ipa>
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
