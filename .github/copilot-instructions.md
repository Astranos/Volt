# Volt review instructions

You are reviewing changes to Volt, a monorepo for a scanning browser extension with a cloud workspace backend and native mobile apps.

## Repository layout

- `packages/extension/` — Chrome extension (TypeScript, React sidepanel)
- `packages/scanner-protocol/` — shared protocol types; extension code must not import outside this boundary
- `apps/web/` — marketing/search web app (TanStack Start)
- `apps/kiosk/` — in-store kiosk app
- `apps/mobile/` — iOS app (`ios/Volt.xcodeproj`, targets `Volt` and `VoltClip` App Clip, Swift)
- `convex/` — Convex backend
- `scripts/` — repo tooling and CI policy tests

## Commands

- `pnpm test` — all workspaces (node:test for `.mjs`, vitest for the rest, driven by `scripts/run-tests.mjs`)
- `pnpm typecheck` — every workspace plus `tsc -p convex/tsconfig.json`
- `pnpm check:repo-health` — repository invariants enforced by CI
- `pnpm --filter @volt/mobile test` — Swift helper tests

## Conventions to enforce

- `convex/cloudWorkspace.ts` is the stable registered-API surface; domain modules export plain handlers and never register functions. `convex/backendContracts.test.ts` pins the public contract — flag any change that adds, removes, or renames registered functions without updating that test deliberately.
- Never truncate a list and label it complete: pagination errors (for example "requires pagination") must fail loudly instead of returning partial data marked done.
- Do not edit `convex/_generated/` — it is generated.
- Swift changes must compile for both targets; a file added to `Volt` needs a `project.pbxproj` entry or the CI full-app build fails.
- Tests live next to the code they cover; each test file belongs to exactly one runner by extension (`.mjs` → node:test, otherwise vitest).
