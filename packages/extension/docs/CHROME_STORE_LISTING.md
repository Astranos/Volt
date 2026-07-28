# Chrome Web Store Listing

The Chrome Web Store API cannot write listing text, so the store description is
edited by hand in the developer dashboard. This file is the source of truth for
what should be pasted there.

**Keep it accurate.** Violation "Red Potassium" (2026-07-28) rejected the listing
because it advertised Google search that the reviewer could not reproduce: the
new tab had dropped general web search in `ff4d4e74`, but the description still
promised it. Every capability named below must be reachable in the shipped build,
and anything removed from the build must be removed from here in the same commit.

The description below deliberately says nothing about Google or general web
search. Google still ships and still works as a command-palette provider — the
new tab is the surface that has no general web search, and a test enforces that
(`src/domain/search-intent.test.mjs`). Mentioning Google is what drew the
violation, so the listing stays silent about it. Do not add it back.

## Where search actually lives

| Surface | Search available |
| --- | --- |
| Command palette (`Cmd/Ctrl+Shift+K`) | Google, Amazon, Best Buy, eBay sold, PriceCharting, BarcodeLookup, UPCItemDB, YouTube, GitHub, X, Home Depot, Lowe's, Menards, Micro Center, plus user-defined providers |
| New tab | Resale lookups only — PriceCharting, BarcodeLookup (UPC), eBay sold prices, Shopify inventory — plus recently closed tabs. **No general web search.** |
| Context menu | eBay sold listings, UPC/MPN lookup, PriceCharting |

## Single purpose

Volt provides a resale workflow that combines price research, purchase-offer
calculation, browser productivity tools, and user-initiated mobile capture of
product text, barcodes, notes, and photos.

## Detailed description

> Paste the block below into the dashboard verbatim.

Volt is a browser extension for people who buy and resell electronics. It keeps price research, offer math, barcode and photo capture, and listing helpers next to the tabs you already have open, so you can go from sizing up an item to listing it with fewer tabs and less copy/paste.

COMMAND PALETTE

Press Cmd+Shift+K (Ctrl+Shift+K on Windows and Linux) to open Volt on any page. From one input you can jump to an open tab, bookmark, or history entry, follow a quick link, or launch the Mobile Scanner.

The palette also routes a query to a retail or pricing site by typing a trigger first: "ebay" for eBay sold prices, "pc" for PriceCharting, "upc" for UPCItemDB, "amazon" for Amazon, "bb" for Best Buy. Home Depot, Lowe's, Menards, and Micro Center are included too. Every destination can be enabled, disabled, and reordered in Settings, and you can add your own with a custom URL template.

NEW TAB

Volt can replace the new-tab page with a resale-focused start page: recently closed tabs, quick links, and bookmarks.

Its search box is scoped to four resale lookups — PriceCharting, BarcodeLookup by UPC, eBay sold prices, and available Shopify inventory — with single-letter prefixes (p, u, e, s) to switch between them. The new-tab override can be turned off in Settings.

OFFER CALCULATOR AND SIDE PANEL

The side panel holds an offer calculator for working out what to pay against a target margin, with configurable rate tables for standard, premium, checkout, and new-customer offers. Captures sent from the Volt mobile app land here too.

MOBILE CAPTURE

Sign in and pair the Volt iPhone app to capture barcodes, OCR text, notes, and photos on your phone and have them show up in the browser. Captures sync to the signed-in account's workspace and are delivered to whichever browser you have set as the active target. Pairing and every capture are user-initiated.

ON-PAGE HELPERS

- eBay: a warning banner when you are looking at active listings instead of sold and completed ones.
- Shopify admin: quick-action buttons and product search helpers.
- Any page: UPC codes are highlighted and can be copied with one click.
- Right-click a selection to search eBay sold listings, look up a UPC or MPN, or check PriceCharting.

PRIVACY

Most functionality runs locally in the browser. Tabs, bookmarks, and history are read only to populate the command palette and new tab, and are not transmitted. Mobile captures sync only for the signed-in account. Full policy: https://volt.juanquenga.com/privacy

Volt Pro is an optional auto-renewing subscription that unlocks the cloud workspace and mobile capture sync. The extension's browser features work without it.
