# Extension Release Process

This guide covers release builds for the Volt Chrome extension package.

## Version Files

Keep these two versions identical:

- `packages/extension/package.json`
- `packages/extension/wxt.config.ts`, under `manifest.version`

Current version: `1.0.39`.

## Build And Test

From the repository root:

```sh
pnpm --filter @volt/extension test:scanner
pnpm build:extension
```

The build output is:

```text
packages/extension/.output/volt/
```

Do not use root `pnpm build` unless you also want the monorepo build, including native mobile.

## Create Release Zip

Preferred command from the repository root:

```sh
pnpm zip:extension
```

This delegates to `@volt/extension` and moves the WXT-generated zip into `packages/extension/releases/`.

Manual fallback from `packages/extension`:

```sh
pnpm build
cd .output
zip -r volt-v{VERSION}.zip volt
mv volt-v{VERSION}.zip ../releases/
cd ..
```

## Update Release Notes

Update [../releases/releases.md](../releases/releases.md) with:

- Version number and date.
- User-visible changes.
- Verification performed.
- Installation instructions for the generated zip.

## Verification Checklist

- [ ] `package.json` and `wxt.config.ts` versions match.
- [ ] `pnpm --filter @volt/extension test:scanner` passes.
- [ ] `pnpm build:extension` passes.
- [ ] `.output/volt/manifest.json` has the expected version and name.
- [ ] Release zip exists in `packages/extension/releases/`.
- [ ] Release notes mention the new version.

## Chrome Web Store

Upload the production zip or the contents of `.output/volt/` through the Chrome Web Store Developer Dashboard, depending on the dashboard flow being used.
