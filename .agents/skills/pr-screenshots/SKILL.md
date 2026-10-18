---
name: pr-screenshots
description: Capture screenshots of Volt extension UI (new tab, sidepanel, context menu, Shopify pages, options) for a PR or to visually check a change, including before/after comparisons against main. Use whenever a change affects how extension UI looks, or the user asks for screenshots, before/after images, or visual verification of the extension.
---

# PR screenshots

Volt has a reusable preview for this. Do not build a throwaway harness, serve
files with python, or drive headless Chrome by hand.

Read `packages/extension/preview/README.md` first. In short:

1. `pnpm shots --list` shows the existing scenarios.
2. If none covers the changed UI, add one in `packages/extension/preview/scenarios/`
   (or a `?state=` variant of an existing one) and commit it with the change, so
   the next PR can reuse it. Put shared sample data in `preview/fixtures/`.
3. Capture with `pnpm shots <scenario...> --before origin/main` (add `--dark`
   when the change touches theming). Look at every PNG it prints before using it;
   fix the scenario if anything is cut off, empty, or mid-animation.
4. When opening the PR, rerun with `--publish` and paste the printed Markdown
   into the PR body. The images live on a `pr-assets/<branch>` branch, never in
   the PR diff.

Screenshots show sample data in a plain tab, not the installed extension. Say so
in the PR when behavior (not just looks) matters, and say what was not checked
in the real extension.
