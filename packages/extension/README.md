# Volt Chrome Extension

Volt is the Chrome extension package in the Volt monorepo. It is built with WXT, React, TypeScript, Tailwind CSS v4, and Chrome Manifest V3.

Volt was made to speed up buying and listing electronic devices for resale. The extension keeps pricing research, offer calculation, barcode/text capture, photo intake, and listing helpers close to the browser so a reseller can move from item evaluation to listing with fewer tabs, fewer copy/paste steps, and less manual data entry.

## Current Version

The checked-in version lives only in [package.json](package.json). WXT uses it
for the generated manifest. Chrome Web Store releases automatically choose a
version no lower than that checked-in floor and newer than every published or
submitted version; do not edit a version for release by hand.

## What It Does

- Speeds up buying decisions with market-search shortcuts, eBay sold-price helpers, PriceCharting search, and offer calculation.
- Speeds up listing by reactively syncing barcodes, OCR text, and photos from the signed-in Volt mobile app's account cloud workspace.
- Command palette popup with tabs, quick links, bookmarks, history, search providers, and Mobile Scanner launch.
- Custom new-tab page with closed tabs, quick links, bookmarks, and search modes.
- Unified sidepanel with Mobile Scanner and Offer Calculator.
- Registers as a Cloud Scanner Workspace computer and, when selected as the live cursor target, receives per-result cursor deliveries over a reactive Convex subscription.
- eBay sold/completed-listing warning content script.
- Shopify admin quick-action buttons and product search helpers.
- UPC highlighter with click-to-copy behavior.
- Context-menu searches for selected text, UPCs, MPNs, eBay sold listings, and PriceCharting.

## Keyboard Shortcuts

Configured in [wxt.config.ts](wxt.config.ts):

| Shortcut | Action |
| --- | --- |
| `Cmd+Shift+K` / `Ctrl+Shift+K` | Open Volt command palette |
| `Cmd+Shift+O` / `Ctrl+Shift+O` | Open Volt options |
| `Cmd+Shift+Z` / `Ctrl+Shift+Z` | Reopen last closed tab |

Chrome users can customize these at `chrome://extensions/shortcuts`.

## Development

From the repository root:

```sh
pnpm dev:extension
pnpm build:extension
pnpm zip:extension
```

From this package directory:

```sh
pnpm dev
pnpm build
pnpm zip
pnpm test:scanner
```

To inspect or publish the Chrome Web Store item from the repository root:

```sh
pnpm status:extension-store
pnpm release:extension:dry-run
pnpm release:extension
```

See [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md) for one-time service
account and GitHub Actions setup.

The production extension build is written to `.output/volt/`.

### Authentication and access configuration

Set these public build-time values before packaging the extension:

```sh
WXT_CLERK_PUBLISHABLE_KEY=pk_...
WXT_CLERK_SYNC_HOST=https://clerk.volt.juanquenga.com # optional override
WXT_CLERK_SIGN_IN_URL=https://accounts.volt.juanquenga.com/sign-in
WXT_EXTENSION_PUBLIC_KEY=<Chrome manifest public key>
WXT_VOLT_FULL_APP_URL=https://apps.apple.com/us/app/volt-scanner/id6771770148
```

`WXT_EXTENSION_PUBLIC_KEY` keeps the Chrome extension ID stable. In the Clerk
Dashboard, add `chrome-extension://<extension-id>` to the instance's allowed
origins, enable the instance's Native API, and create a JWT template named
`convex`. Include Clerk's organization ID claim in that template so selecting
the complimentary workplace in the extension can be authorized by Convex.

Google OAuth runs on `WXT_CLERK_SIGN_IN_URL`, then `WXT_CLERK_SYNC_HOST`
shares the resulting Clerk session with the popup and background worker. OAuth
must not redirect directly back into an extension popup or side panel. When the
sync host is omitted, the extension derives it from the publishable key so the
cookie host and Clerk Frontend API cannot drift apart.

Only the background service worker asks Clerk for the `convex` token. It asks
freshly for every Convex access request, never sends a JWT to content scripts or
the offscreen document, and never writes a raw token to extension storage.
Anonymous grant credentials are issued by Convex and stored in
`chrome.storage.local`; they are claimed/merged by `/api/access/anonymous` after
sign-in. Subscription checkout remains in the full iPhone app.

## Loading In Chrome

1. Run `pnpm dev:extension` or `pnpm build:extension`.
2. Open `chrome://extensions/`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select `packages/extension/.output/volt`.

## Tests

```sh
pnpm --filter @volt/extension test:scanner
```

The root `pnpm test` command also runs extension domain tests along with scanner protocol, Convex signaling, and mobile library tests.

## Project Structure

```text
packages/extension/
├── entrypoints/
│   ├── background.ts
│   ├── context-menu.tsx
│   ├── ebay-sold-listing-warning.tsx
│   ├── install/
│   ├── mobile-scanner-popup/
│   ├── newtab/
│   ├── offscreen.html
│   ├── options/
│   ├── popup/
│   ├── sidepanel/
│   ├── shopify-buttons.ts
│   ├── shopify-product-search.ts
│   └── upc-highlighter.ts
├── public/assets/
├── src/background/
├── src/components/
├── src/domain/
├── src/lib/
├── src/types/
├── src/utils/
├── wxt.config.ts
└── package.json
```

## Search Providers

Default command-palette providers are configured in [src/components/cmdk-palette/SearchProviders.tsx](src/components/cmdk-palette/SearchProviders.tsx). URL templates live in [src/domain/search.ts](src/domain/search.ts).

Current built-in providers include Google, Volt Search, Amazon, Best Buy, eBay sold prices, PriceCharting, BarcodeLookup, UPCItemDB, YouTube, GitHub, X/Twitter, Home Depot, Lowe's, Menards, and Micro Center.

## Mobile Scanner

The full mobile app is cloud-first: every accepted capture belongs to the signed-in Clerk user's Cloud Scanner Workspace and syncs through Convex (metadata) and Cloudflare R2 (photo bytes), with no pairing, WebRTC connection, or Chrome-generated QR required. A signed-in Chrome installation registers as an Enrolled Computer and subscribes to the reactive Convex `workspaceSnapshot` query for Scanner Results. When the phone selects this computer as its live cursor target, the extension also subscribes to `pendingCursorDeliveries` and inserts each result into the last-focused editable field, then acknowledges it back to Convex. The `ConvexClient` lives in the offscreen document and drives both subscriptions whenever the user is signed in.

The App Clip is a free, temporary, cloud-only client for the signed-in Chrome account's workspace. The new-tab phone button creates a short-lived workspace grant QR that opens `/clip`; the App Clip can then choose among the workspace's online computers for text and barcode insertion without WebRTC, an account Device Credential, or a Clerk session.

Relevant implementation:

- [src/offscreen/mobile-scanner-offscreen.ts](src/offscreen/mobile-scanner-offscreen.ts)
- [src/cloud-scanner/workspace-snapshot.ts](src/cloud-scanner/workspace-snapshot.ts)
- [src/background/cloud-workspace-controller.ts](src/background/cloud-workspace-controller.ts)
- [src/background/mobile-capture-delivery.ts](src/background/mobile-capture-delivery.ts)
- [entrypoints/mobile-scanner-popup/main.tsx](entrypoints/mobile-scanner-popup/main.tsx)

## Release Notes

Release history is in [releases/releases.md](releases/releases.md). Release build instructions are in [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md).

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
