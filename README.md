# Volt

Volt is a monorepo for a Chrome extension, a companion mobile scanner app, a web pairing surface, and a small scanner signaling service.

## Packages

| Workspace | Purpose |
| --- | --- |
| `packages/extension` | Chrome extension built with WXT, React, and TypeScript. |
| `packages/scanner-protocol` | Shared scanner protocol constants, message types, and validation helpers. |
| `apps/mobile` | Expo/React Native iOS scanner app with native Swift components. |
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

## Documentation

- [Project context](CONTEXT.md)
- [Architecture decisions](docs/adr)
- [Chrome extension README](packages/extension/README.md)
- [Contributor guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## License

Volt is licensed under the AGPL-3.0-or-later. See [LICENSE](LICENSE).
