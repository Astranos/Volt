# Maintainability notes

This repo should bias toward small canonical modules and explicit boundaries. Avoid adding feature-specific branches to large entrypoints or sidepanel components when the behavior can live in a focused domain helper, controller, or component.

Run `pnpm check:repo-health` for the current file-size and package-boundary checks. CI requires this command to pass. The [earlier remediation workflow](./maintainability-remediation-workflow.md) records a previous audit, not the current list of failures.

## Module ownership

Source and test files under `apps/`, `packages/`, and `convex/` must stay within 1,000 lines. Extract by responsibility, not by arbitrary line ranges:

- Move background-service behavior behind `src/background/*` controllers instead of extending `entrypoints/background.ts`.
- Split settings sections into independently testable settings components.
- Keep command-palette provider/search logic in domain helpers and leave `CMDKPalette.tsx` mostly as orchestration and rendering.
- Move context-menu data extraction and action dispatch into small pure helpers before adding more UI or Chrome API branches.
- Keep registered `cloudWorkspace:*` Convex APIs in `convex/cloudWorkspace.ts`. Its domain modules own device identity, batches, photos, dictation, and delivery handlers without registering duplicate API paths.
- Keep App Clip capture, history, connections, and photo upload views in their respective files under `apps/mobile/ios/VoltClip/Views`.

## Boundary rules

- `@volt/scanner-protocol` owns scanner message contracts, runtime validators, protocol constants, and QR/join URL shapes.
- Convex owns workspace identity, capture metadata, text and barcode results, delivery state, and signaling. Private photo bytes go directly to R2. See [the current domain model](../CONTEXT.md).
- The extension background layer owns privileged Chrome API work; React components should request actions through typed helpers instead of reaching into Chrome APIs directly when the behavior is shared.
- Generated or build output such as `.wxt/`, `.output/`, and Vite `dist/` output must stay untracked.

## Verification

`pnpm test` discovers repository tests automatically. Use `.test.mjs` or `.spec.mjs` for Node tests, and `.test.ts`, `.test.tsx`, `.test.js`, or `.test.jsx` for Vitest tests. Vitest also accepts the corresponding `.spec` names. Do not import `node:test` into a Vitest suite. `node scripts/run-tests.mjs all --list` prints the runner assignment for every discovered test.

Prefer tests that execute behavior. Native source contracts remain static checks and do not prove iOS compilation or camera behavior. The macOS CI job executes the Swift helper tests; device flows still need manual verification.

Run `pnpm typecheck` for workspace and backend TypeScript checks. Maintainers can run `pnpm check:github` with an authorized GitHub CLI login to verify the live merge and release settings without changing them.

The repository requires an approving review, including for admins. CODEOWNERS currently assigns backend and release changes to `@JuanQuenga`. Add another maintainer when they take ownership so changes authored by the current owner can receive an independent code-owner review. Chrome releases require maintainer approval and run only from `main`.
