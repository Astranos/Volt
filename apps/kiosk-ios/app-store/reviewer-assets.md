# VoltKiosk reviewer assets

Use `volt-kiosk-reviewer-walkthrough.mp4` as the reviewer walkthrough. It is a captioned 1920 × 1080 MP4, approximately 3 minutes 11 seconds long. The native app recording plays at 1.8× and ends with a held catalog frame for the Guided Access instructions. It has no audio. Captions remain beside the app, without covering its controls.

The recording uses the supplied Debug simulator build of `com.volt.kiosk` on an iPad Pro 13-inch (M4), iOS 26.5. The store is `taylormi`, Taylor, 9058 Telegraph Road. The Simulator UDID is `E24ACF3F-ACBE-43AC-B9A8-8139848F475A`.

## Walkthrough

| Video time | Action or visible result |
| --- | --- |
| 00:00 | Kiosk setup. Enter `taylormi`. |
| 00:15 | Open store loads Taylor inventory. |
| 00:40 | Search for `Corsair` shows six matching RAM products. |
| 01:29 | Clear filters, select Computers, and open Budget. |
| 01:59 | Select Up to $100. Open the Corsair RAM product. |
| 02:16 | Product details show photos, price, condition, and SKU. Tap the second thumbnail. |
| 02:26 | Next item opens the MSi motherboard. |
| 02:31 | Previous item returns to Corsair. Open its main photo. |
| 02:45 | Swipe left in the full-screen viewer to photo 2. |
| 02:52 | Tap the previous-photo side preview, then Done. |
| 03:01 | Close returns to the filtered catalog. The final caption explains physical-iPad Guided Access setup. |

Times are caption start times, rounded to the nearest second. The raw capture and `steps.json` preserve the original timing.

## App Store screenshots

The following PNGs are Simulator screen captures exported as opaque RGB PNGs, with no visual edits at 2064 × 2752 pixels, with no alpha channel. The status bar uses 9:41. These dimensions match the 13-inch iPad portrait screenshot slot.

1. `01-ipad13-catalog.png` shows Taylor inventory, categories, search, and filters.
2. `02-ipad13-search.png` shows Corsair search results with the keyboard dismissed.
3. `03-ipad13-filtered.png` shows Computers selected, Budget Up to $100, and 38 matching items.
4. `04-ipad13-detail.png` shows the Corsair product details, thumbnails, SKU, and request control.
5. `05-ipad13-photos.png` shows the full-screen photo viewer, side preview, and photo count.

All five screenshots were visually inspected. Four frames of the captioned export were inspected at 5, 60, 145, and 188 seconds. They show setup, search, item navigation, and the final catalog with readable captions.

## Limits

No customer request was sent. The visible Ask to see this item control was not activated, and no staff queue mutation was performed.

Pinch zoom was not demonstrated because the available simulator tools do not expose a pinch gesture. Guided Access was not enabled or tested in Simulator. The captions explain how to enable it on a physical iPad and identify that limit.

The first 9th-generation iPad take is an unused rough recording. Its text input did not focus the search field, and a close-details tap landed on another control. The clean 13-inch take focuses fields with a touch event before typing and uses the toolbar Close control. The final video shows successful search and return to catalog.

These assets were captured from the supplied prebuilt simulator app. They do not attest to changes introduced in a later release archive.
