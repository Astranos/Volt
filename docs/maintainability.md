# Maintainability Notes

This repo should bias toward small canonical modules and explicit boundaries. Avoid adding feature-specific branches to large entrypoints or sidepanel components when the behavior can live in a focused domain helper, controller, or component.

Use the remediation workflow in [`docs/maintainability-remediation-workflow.md`](./maintainability-remediation-workflow.md) to fix the current repo-wide audit findings in dependency order.

## Current Decomposition Targets

The following files are already over the 1,000-line review threshold. New feature work should not make them larger without first extracting a focused module or component:

- `packages/extension/src/components/pages/SettingsPage.tsx`
- `packages/extension/entrypoints/background.ts`
- `packages/extension/src/components/cmdk-palette/CMDKPalette.tsx`
- `packages/extension/entrypoints/context-menu.tsx`

Preferred direction:

- Move background-service behavior behind `src/background/*` controllers instead of extending `entrypoints/background.ts`.
- Split settings sections into independently testable settings components.
- Keep command-palette provider/search logic in domain helpers and leave `CMDKPalette.tsx` mostly as orchestration and rendering.
- Move context-menu data extraction and action dispatch into small pure helpers before adding more UI or Chrome API branches.

## Boundary Rules

- `@volt/scanner-protocol` owns scanner message contracts, runtime validators, protocol constants, and QR/join URL shapes.
- `convex` owns signaling state only. It must not store OCR, barcode, dictation, or photo payloads for the active full-app scanner architecture.
- The extension background layer owns privileged Chrome API work; React components should request actions through typed helpers instead of reaching into Chrome APIs directly when the behavior is shared.
- Generated or build output such as `.wxt/`, `.output/`, and Vite `dist/` output must stay untracked.
