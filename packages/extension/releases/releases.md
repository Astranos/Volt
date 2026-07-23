# Volt Chrome Extension Releases

## Current Submitted Version

### v1.0.53

The manifest/package version remains `1.0.53` until the next package is
submitted.

Submitted to the Chrome Web Store for review on July 23, 2026.

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

## Unreleased Changes

- None.

## Recent Release History

### v1.0.53

Release date: July 23, 2026

Changes:

- Reworked the toolbar action to open a unified side panel with clean Offer Calculator and Scanner tabs.
- Reduced the pairing popup to the QR flow and moved the editable computer name into that popup.
- Simplified the new-tab controls with compact account and settings actions.
- Fixed Clerk authentication returning to Volt without refreshing the open side panel account state.
- Added production Clerk Sync Host configuration and resilient scanner access checks so account loading cannot block QR pairing.
- Refined scanner controls, cloud workspace access, and signed-in workspace presentation throughout the extension.

### v1.0.52

Release date: July 22, 2026

Changes:

- Added Clerk-backed production account access and server-authoritative subscription status.
- Added the durable Cloud Scanner Workspace for account-wide result batches, enrolled devices, and enrolled Chrome computers.
- Added private photo synchronization through short-lived Cloudflare R2 upload and download grants.
- Added stable Chrome extension identity, background token refresh, push-assisted reconnects, and production Convex routing.
- Added temporary App Clip guest cloud grants so successful WebRTC captures can also appear on the QR-issuing account workspace.

### v1.0.51

Release date: July 9, 2026

Changes:

- Added a compact toolbar that appears after selecting non-editable page text.
- Added one-click eBay Prices, Search for UPC, and PriceCharting actions for the selection.
- Refined the right-click menu with clearer grouping, selected-text context, improved keyboard navigation, and a more polished icon-action row.
- Added an independent Selection Suggestions setting plus click-away, right-click, scroll, resize, and Escape dismissal behavior.

### v1.0.50

Release date: July 9, 2026

Changes:

- Fixed Scanner Results getting stuck loading while persisted photo blobs were being restored.
- Flattened new scanner photo downloads into one Volt Photos folder to prevent empty session and batch folders from accumulating.
- Fixed dragging photo batches into Shopify's Shadow DOM-based product media uploader.
- Versioned the photo drag bridge so repaired drag behavior replaces stale page integrations without requiring a Shopify page reload.

### v1.0.49

Release date: July 3, 2026

Changes:

- Included the App Clip pairing QR label fix so freshly scanned sessions show the extension-provided computer name.
- Built a fresh Chrome extension release artifact.

### v1.0.48

Release date: July 1, 2026

Changes:

- Included the latest extension updates for mobile scanner reconnect and shared photo upload progress UI.
- Built a fresh Chrome extension release artifact.

### v1.0.47

Release date: June 26, 2026

Changes:

- Refreshed the extension icon set from the website favicon.
- Improved Quick Links favicon loading in the new tab page.
- Reordered and refined the Mobile Scanner QR popup layout.

### v1.0.46

Release date: June 26, 2026

Changes:

- Updated mobile scanner pairing QR codes to use the App Clip-capable HTTPS invocation URL.
- Kept the signal URL in the QR payload so production and development join tokens resolve against the backend that minted them.
- Refreshed scanner pairing QR windows before expiry, including connected sessions that still show a QR for adding another phone.

### v1.0.43

Release date: June 23, 2026

Changes:

- Made saved-session reconnect polling immediate on extension startup.
- Reduced reconnect fallback polling so missed push wakeups recover quickly.
- Kept reconnect requests retryable when posting a join window fails.

### v1.0.42

Release date: June 23, 2026

Changes:

- Improved mobile scanner signaling retries and connection cleanup.
- Fixed scan receipts so Chrome only reports saved results after storage succeeds.
- Added explicit photo rejection receipts when Chrome cannot store a received photo.
- Improved transient WebRTC disconnect handling for mobile scanner sessions.

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

Older release notes before the current Volt/mobile-scanner architecture may describe removed legacy behavior, old toolbar behavior, or old zip names. Treat them as historical context, not live documentation.
