# Volt Kiosk for iPad

A separate native iPad app for the customer portal in `apps/kiosk`. The scanner remains in `apps/mobile`. This app has its own Xcode project, shared `VoltKiosk` scheme, and `com.volt.kiosk` bundle ID. It supports iPadOS 17 or later in portrait and landscape.

The app displays the portal in one `WKWebView`. There are no browser tabs, address bar, or controls that open Safari. Document navigation is restricted to the exact HTTPS portal origin. External websites, app URL schemes, downloads, and link context menus are blocked. Allowed links that request another window load in the existing view. Web images and API requests continue to use the portal's existing web configuration.

The persistent web data store preserves the portal's selected store. The portal handles its existing customer idle reset. The app keeps the screen awake while active, displays a retry screen on load failure, and reloads the portal if the web process terminates.

## Configure the portal

The initial URL is `https://pm.juanquenga.com`, which served the PayMore portal when checked on October 5, 2026. Confirm the intended store before installing the app for customers.

In `ios/VoltKiosk/Info.plist`, set `KioskPortalURL` to the deployed HTTPS URL. Include a store path such as `/taylormi` to start at one store. Set `WKAppBoundDomains` to that URL's hostname, without a scheme or path. The app refuses an invalid URL or a hostname missing from that list. Customers cannot edit the bundled address.

## Install on an iPad

1. Run `pnpm --filter @volt/kiosk-ios open:xcode` from the repository root.
2. Select the `VoltKiosk` scheme and the connected iPad.
3. Check Signing & Capabilities. The project uses the scanner project's existing development team, `GB5SPLUARQ`, with automatic signing and a separate bundle ID. Change the team if needed.
4. Run the app from Xcode. Confirm that the selected store's catalog, images, search, product details, and request flow work on the deployed portal.

The initial project has no App Store icon or release automation. Add release artwork and distribution provisioning before submitting it to App Store Connect.

## Lock the customer iPad

1. Open iPad Settings → Accessibility → Guided Access. Enable Guided Access and set a staff-only passcode.
2. Open Volt Kiosk and select the store if the bundled URL does not include a store path.
3. Triple-click the top button or Home button. Start Guided Access. Keep touch and the software keyboard enabled for catalog search. Configure hardware buttons and time limits for the store's needs.
4. Confirm that the staff setup banner disappears and that customers cannot leave the app using Home or multitasking gestures.
5. To end the session, triple-click the button and authenticate with the staff passcode or the configured biometric method.

Guided Access is an iPad setting. The app does not start or end it automatically. See [Apple's Guided Access instructions](https://support.apple.com/111795).

## Check the app

Run `pnpm --filter @volt/kiosk-ios typecheck` to validate the Swift sources against the installed iOS Simulator SDK. Run `pnpm --filter @volt/kiosk-ios test` to exercise the URL navigation policy, including deceptive hostnames, non-HTTPS URLs, credentials, ports, and links to other apps. Both commands require macOS and Xcode.

On a physical iPad, also check allowed navigation, a blocked external link, a link that requests a new window, offline retry, rotation, store persistence after relaunch, and Guided Access. These device checks are required before customer use.
