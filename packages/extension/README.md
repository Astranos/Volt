# Volt Chrome Extension

Volt is the Chrome extension package in the Volt monorepo. It is built with WXT, React, TypeScript, Tailwind CSS v4, and Chrome Manifest V3.

Volt was made to speed up buying and listing electronic devices for resale. The extension keeps pricing research, offer calculation, barcode/text capture, photo intake, and listing helpers close to the browser so a reseller can move from item evaluation to listing with fewer tabs, fewer copy/paste steps, and less manual data entry.

## Current Version

`1.0.40`

The extension manifest version lives in [wxt.config.ts](wxt.config.ts), and the package version lives in [package.json](package.json). Keep them in sync for release builds.

## What It Does

- Speeds up buying decisions with market-search shortcuts, eBay sold-price helpers, PriceCharting search, and offer calculation.
- Speeds up listing by receiving barcodes, OCR text, dictation, and photos from the Volt mobile app.
- Command palette popup with tabs, quick links, bookmarks, history, search providers, and Mobile Scanner launch.
- Custom new-tab page with closed tabs, quick links, bookmarks, and search modes.
- Unified sidepanel with Mobile Scanner and Offer Calculator.
- Mobile scanner pairing over WebRTC through Convex-backed signaling.
- eBay sold-listing summary content script.
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

The production extension build is written to `.output/volt/`.

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
│   ├── ebay-summary.tsx
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

The extension pairs with the full mobile app through short-lived Convex-backed join tokens. After signaling, capture payloads move over WebRTC data channels only. Convex does not relay OCR, barcode, dictation, or photo payloads.

Relevant implementation:

- [src/domain/mobile-scanner-session.ts](src/domain/mobile-scanner-session.ts)
- [src/domain/mobile-scanner-photo-receiver.ts](src/domain/mobile-scanner-photo-receiver.ts)
- [src/background/scanner-offscreen.ts](src/background/scanner-offscreen.ts)
- [entrypoints/mobile-scanner-popup/main.tsx](entrypoints/mobile-scanner-popup/main.tsx)

## Release Notes

Release history is in [releases/releases.md](releases/releases.md). Release build instructions are in [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md).

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE).
