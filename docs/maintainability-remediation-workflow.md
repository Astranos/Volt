# Maintainability Remediation Workflow

This workflow fixes the repo-wide maintainability findings in dependency order. Each phase should be a separate PR unless the change is trivial. Do not mix cleanup-only movement with behavior changes.

## Phase 0: Repository Hygiene

Goal: remove generated output from the repository so reviews and searches only cover source.

Tasks:

- Remove tracked iOS build output from git:
  - `apps/mobile/ios/build-device-liquid/`
  - any other `apps/mobile/ios/build*/` output that is tracked.
- Add ignore rules for local Xcode output:
  - `apps/mobile/ios/build*/`
  - `apps/mobile/ios/DerivedData/`
  - `*.xcresult`
  - `*.xcarchive`
- Confirm generated web and extension output remains ignored.

Acceptance checks:

```sh
git ls-files | rg '(^|/)(build-device-liquid|DerivedData|\.xcresult|\.xcarchive)(/|$)' && exit 1 || true
git ls-files | rg '(^|/)(node_modules|dist|\.output|\.wxt)(/|$)' && exit 1 || true
pnpm test
```

## Phase 1: Settings Page Decomposition

Goal: make settings a composed page instead of a 2k-line component.

Tasks:

- Create a `useExtensionSettings` hook that owns:
  - initial storage load
  - merged defaults
  - `saveSettings(nextSettings)`
  - saved-state feedback
- Create focused settings sections:
  - `SearchProvidersSettings`
  - `FeatureTogglesSettings`
  - `BookmarkFoldersSettings`
  - `TopOffersSettings`
  - `CsvCacheSettings`
- Move top-offer rate editor duplication into reusable rule editor components.
- Keep `SettingsPage.tsx` as layout and composition only.

Acceptance checks:

```sh
wc -l packages/extension/src/components/pages/SettingsPage.tsx
pnpm --filter @volt/extension compile
pnpm --filter @volt/extension test:scanner
```

Target: `SettingsPage.tsx` below 600 lines, with each extracted section below 500 lines.

## Phase 2: Typed Extension Message Contracts

Goal: replace stringly typed runtime messages with one canonical contract.

Tasks:

- Add `packages/extension/src/background/messages.ts`.
- Define discriminated unions for runtime messages and responses.
- Add runtime parsers for untrusted inbound messages.
- Replace `Record<string, any>`, broad `unknown`, and `@ts-nocheck` in background message paths.
- Convert `tab-message-handler.ts` to typed inputs and remove `@ts-nocheck`.

Acceptance checks:

```sh
rg -n '@ts-nocheck|no-explicit-any|Record<string, any>|declare const chrome: any' packages/extension/src/background packages/extension/entrypoints/background.ts
pnpm --filter @volt/extension compile
pnpm --filter @volt/extension test:scanner
```

## Phase 3: Background Service Worker Split

Goal: make `entrypoints/background.ts` a thin registrar.

Tasks:

- Move context menu setup into `src/background/context-menu-controller.ts`.
- Move tab delivery and content-script injection into `src/background/tab-delivery.ts`.
- Move preview popup state into `src/background/preview-popup-controller.ts`.
- Move clipboard bridge into `src/background/clipboard-controller.ts`.
- Move CSV, QR, debug, and disabled-site actions into focused handlers.
- Replace the main switch with a typed action registry.

Acceptance checks:

```sh
wc -l packages/extension/entrypoints/background.ts
pnpm --filter @volt/extension compile
pnpm --filter @volt/extension test:scanner
```

Target: `background.ts` below 500 lines and only responsible for registering controllers.

## Phase 4: Behavioral Scanner Tests

Goal: delete source-text tests and test behavior through module seams.

Tasks:

- Remove tests that assert strings in `background.ts`.
- Delete the scanner source-contract anchor comment block from `background.ts`.
- Add direct tests for:
  - reconnect alarm registration
  - push event forwarding
  - offscreen reconnect polling
  - iframe cursor target routing
  - rich-text insertion behavior
- Use fake Chrome APIs and exported controller factories instead of reading source files.

Acceptance checks:

```sh
rg -n 'readFileSync|source-contract anchors|backgroundSource|assert\.match\(.*Source' packages/extension/src/domain
pnpm --filter @volt/extension test:scanner
```

The first command should return no implementation-contract tests.

## Phase 5: Package Boundary Cleanup

Goal: make `@volt/scanner-protocol` the only scanner protocol import surface.

Tasks:

- Replace `../../../scanner-protocol/src` and similar imports with `@volt/scanner-protocol`.
- Ensure `@volt/scanner-protocol` has the necessary package exports.
- Add workspace dependency declarations where missing.
- Typecheck every consumer.

Acceptance checks:

```sh
rg -n 'scanner-protocol/src' packages convex apps && exit 1 || true
pnpm --filter @volt/scanner-protocol typecheck
pnpm --filter @volt/extension compile
pnpm test:convex
```

## Phase 6: Convex Signaling Lifecycle Cleanup

Goal: make scanner signaling state transitions explicit and harder to misuse.

Tasks:

- Split `convex/scannerSignal.ts` by aggregate:
  - join tokens
  - join attempts
  - pairings
  - reconnect requests
  - shared public response mappers
- Extract transition helpers:
  - `requireActiveJoinToken`
  - `requireBrowserClaim`
  - `expireAttemptIfNeeded`
  - `expireReconnectIfNeeded`
  - `requireActivePairing`
- Keep all database access indexed and bounded.
- Preserve public HTTP behavior.

Acceptance checks:

```sh
pnpm test:convex
pnpm test
```

## Phase 7: Guardrails

Goal: prevent the same issues from reappearing.

Tasks:

- Add a size check for tracked source files crossing 1,000 lines.
- Add a generated-output check using the Phase 0 `git ls-files` patterns.
- Add a boundary check that rejects `scanner-protocol/src` imports outside the package.
- Add a check that rejects source-text tests using `readFileSync` on production source unless explicitly allowlisted.

Acceptance checks:

```sh
pnpm test
pnpm run check:repo-health
```

If `check:repo-health` does not exist yet, add it as part of this phase.

## Execution Order

1. Phase 0 first. It reduces noise and avoids reviewing generated files.
2. Phase 2 before Phase 3. Typed contracts make the background split safer.
3. Phase 4 after Phase 3. Controller seams make behavioral tests practical.
4. Phase 5 can run in parallel with Phase 1 or Phase 3 if kept mechanical.
5. Phase 6 should stay isolated because it touches backend semantics.
6. Phase 7 last, after the repo conforms to the new rules.
