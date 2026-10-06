# Volt Kiosk for iPad

A native SwiftUI customer catalog for store tablets. This app is separate from the Volt iPhone scanner in `apps/mobile`, with its own `VoltKiosk` Xcode scheme and `com.volt.kiosk` bundle ID. It supports iPadOS 17 or later in portrait and landscape, using Swift 6 and system frameworks.

The customer interface contains no web view or external website links. It fetches inventory and requests from the existing kiosk JSON API at `https://pm.juanquenga.com`. The native app and the web portal share the same store inventory and request queue.

## Customer experience

- Search names, descriptions, categories, and variant SKUs. Filter by category and budget, sort by date or price, and browse an adaptive product grid.
- Open native product details with prices, variants, SKUs, condition notes, specification tables, and listing descriptions.
- Browse photos and thumbnails. Open fullscreen photos with paging, pinch zoom, pan, and accessible zoom controls.
- Ask to see an available variant. The app shows sending, success, or retry feedback. A retry reuses the same request key to avoid duplicates.
- Start over manually, or let the app clear the customer session after two idle minutes. A countdown appears for the final 20 seconds, including in details and fullscreen photos. The chosen store persists.

Inventory refreshes every minute. A failed refresh retains the last snapshot and warns that availability cannot be confirmed. Requests are disabled for stale or expired inventory and for items removed from a refreshed catalog. Snapshots expire after five minutes. The backend checks fresh inventory again when accepting a request. Load failures, empty inventory, unmatched searches, and image failures have native recovery states.

## Configure and install

1. Run `pnpm --filter @volt/kiosk-ios open:xcode` from the repository root.
2. Select `VoltKiosk` and the connected iPad.
3. Check Signing & Capabilities. Automatic signing uses the existing development team, `GB5SPLUARQ`, and the separate bundle ID. Change the team if needed.
4. Run the app from Xcode.
5. Enter the store subdomain, such as `taylormi`, or its PayMore address, such as `taylormi.paymore.com`. The app verifies the catalog before saving the store.

To preset a store for installation, set `KioskDefaultStoreSlug` in `ios/VoltKiosk/Info.plist`. A previously saved store takes precedence. To use another deployment of the kiosk backend, change `KioskAPIBaseURL` to its HTTPS origin. This setting is bundled in the app and cannot be edited by customers. No Shopify, Clerk, or Convex secrets belong in the native app.

The app includes its own tablet-and-store icon. To redraw it, run `xcrun swift scripts/render-icon.swift` from `apps/kiosk-ios`. Distribution still needs provisioning for the intended distribution method. This package does not reuse the scanner's release automation.

## Lock the iPad for customers

1. Open iPad Settings → Accessibility → Guided Access. Enable Guided Access and set a staff-only passcode.
2. Open Volt Kiosk and verify the intended store and inventory.
3. Triple-click the top or Home button and start Guided Access. Keep touch and the software keyboard enabled for browsing and search.
4. Confirm that the store setup and staff request controls disappear. Confirm that Home and multitasking gestures cannot leave the app.
5. To change the store or handle requests on this iPad, end Guided Access with the staff passcode or configured biometric method.

Guided Access is configured by staff in iPad Settings. The app observes its state and does not start or end it automatically. See [Apple's Guided Access instructions](https://support.apple.com/111795).

## Staff requests

Outside Guided Access, open **Staff requests** from the setup bar. The native queue polls every three seconds while active and displays unexpired waiting and found requests in arrival order. Staff can mark an item found, shown, given, or cleared. Failed changes show a retry action. A local clock expires cached requests even when disconnected. Poll results cannot overwrite a newer status change.

The app hides staff controls during Guided Access. The existing backend's queue API is public, as documented in `apps/kiosk/README.md`; the app adds no new staff authentication.

## Development and checks

From the repository root:

```sh
pnpm --filter @volt/kiosk-ios typecheck
pnpm --filter @volt/kiosk-ios test
pnpm --filter @volt/kiosk-ios test:live
```

The typecheck checks all SwiftUI sources against the installed iOS Simulator SDK in Swift 6 mode. The deterministic executable tests cover API decoding and request construction, errors, store validation, search/filter/sort, inventory freshness, store persistence, idle resets, idempotent retries, duplicate taps, late responses, shared refreshes, and queue status changes. `test:live` adds catalog and queue GET requests to the production kiosk backend. It never sends a live POST or PATCH. All checks verify that the Xcode source list matches the Swift files on disk.

`Models` owns catalog and request values. `Services/KioskAPI` owns JSON and HTTPS requests. The observable `KioskSession` owns the selected store, browsing filters, inventory, idle timer, and customer request identity. `KioskRequestQueue` owns staff polling, its server clock, and status updates. The views render these native values. No HTML parsing, JavaScript injection, or browser navigation is involved.

Before customer use, run the app on an iPad and check rotation, keyboard search, VoiceOver, image zoom, request delivery to the counter, offline recovery, foreground refresh, store persistence, and Guided Access. Check the idle warning and reset while details or fullscreen photos are open. Those UI and hardware checks require a running app and are separate from the executable data-layer tests.
