# Contributing

Thanks for taking the time to contribute.

## Before You Start

1. Search existing issues and pull requests before opening something new.
2. Keep changes scoped to one feature, fix, or cleanup.
3. Do not commit secrets, credentials, signing keys, generated build output, or local machine configuration.

## Setup

```sh
corepack enable
pnpm install
```

If you need the scanner signaling API locally, copy the example environment file:

```sh
cp apps/scanner-signal/.env.example apps/scanner-signal/.env.local
```

Then fill in local or development credentials.

## Useful Commands

```sh
pnpm dev:extension
pnpm dev:web
pnpm dev:mobile
pnpm test
pnpm build:extension
pnpm build:web
pnpm --filter @volt/mobile build:ios
```

The iOS compile check should use the repository script above. It targets the generic iOS Simulator destination and does not require forcing a concrete simulator ID.

## Pull Requests

- Explain the user-facing change and the reason for it.
- Include tests when changing shared protocol behavior, scanner session handling, or signaling API behavior.
- Include manual verification steps for extension, mobile, or browser flows that are not covered by automated tests.
- Update documentation when setup, commands, permissions, or architecture decisions change.

## Code Style

Follow the existing TypeScript, React, Swift, and Expo patterns in the touched package. Prefer small, reviewable changes over broad rewrites.
