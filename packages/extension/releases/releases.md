# Volt Chrome Extension Releases

## Current Development Version

### v1.0.40

The current manifest/package version is `1.0.40`.

Current release build command:

```sh
pnpm zip:extension
```

Build output is generated under:

```text
packages/extension/.output/volt/
```

The generated zip is moved into:

```text
packages/extension/releases/
```

## Recent Release History

### v1.0.32

Release date: May 27, 2026

Changes:

- Improved mobile photo capture reliability.
- Stored received photos in Downloads by session folder.
- Stored lightweight photo metadata in extension storage to avoid quota failures.
- Normalized UPC-A scans that arrive as EAN-13 with a leading zero.

Historical note: this release still referred to App Clip paths in release copy. The active architecture is now full-app WebRTC-only mobile scanner; App Clip/object-transfer work is historical.

### v1.0.29

Release date: May 23, 2026

Changes:

- Included mobile scanner viewfinder updates.
- Built Chrome extension release artifacts.

### v1.0.23

Release date: May 22, 2026

Changes:

- Fixed Mobile Scanner barcode insertion so scans are typed into the active or last-focused page input.
- Preserved scanner results timeline behavior.

### v1.0.22

Release date: May 22, 2026

Changes:

- Fixed Mobile Scanner dictation targeting and duplicate scan handling.
- Refactored search intent, sidepanel tool, background message, top-offer, and mobile scanner session modules.

### v1.0.21

Release date: May 18, 2026

Changes:

- Redesigned the new-tab layout.
- Added relative time formatting for recent and closed tab activity.
- Improved command palette tab results and search prefix previews.
- Refined popup focus behavior and Shopify button placement.

### v1.0.20

Release date: May 5, 2026

Changes:

- Removed the injected floating toolbar.
- Removed the PC cost breakdown sidepanel tool.
- Removed the PriceCharting video game lot tool and related page enhancements.

## Legacy Releases

Older release notes before the current Volt/mobile-scanner architecture may describe removed features such as controller testing, old toolbar behavior, or old zip names. Treat them as historical context, not live documentation.
