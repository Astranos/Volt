# Volt Context

Volt is a Chrome extension and companion mobile app for electronic-device resale workflows. It exists to make buying quicker, reduce repetitive lookup work, and make the listing process easier by bringing market search, offer calculation, scanning, dictation, and photo capture into one browser-centered workflow.

The product is built for resellers who buy electronics and similar inventory, then list those items for resale. The core loop is: evaluate an item quickly, decide what to pay, capture accurate product details, and prepare listing-friendly text and photos with as little manual re-entry as possible.

## Current Mobile Scanner Direction

ADR 0002 is the source of truth for the full mobile app scanner flow. The active scanner architecture is mobile-app-only WebRTC. The full app pairs through short-lived `scanner-signal` join tokens and then sends OCR, barcode, dictation, and photo payloads over direct WebRTC data channels only. App Clip relay, HTTPS result relay, and Photo Object Transfer are obsolete for the full-app scanner transport.

## Domain Terms

- Command Menu: the CMDK-powered palette for tabs, quick links, bookmarks, tools, search providers, and history.
- New Tab: the custom browser new-tab experience with search modes, recently closed tabs, quick links, bookmarks, and sidepanel tool launchers.
- Search Provider: a configured destination that turns a query into a navigable URL.
- Search Intent: the resolved action from user input, such as opening a URL, searching a provider, or searching Shopify inventory.
- Shopify Inventory Search: a search that resolves the current Shopify store and opens the admin products page ordered by available inventory.
- Sidepanel Tool: a tool hosted in the extension sidepanel. The live sidepanel switcher currently exposes Offer Calculator and Mobile Scanner.
- Top Offer: a resale offer value calculated from a projected selling price and configurable rate rules.
- Mobile Scanner Session: a short-lived capture session that links a Chrome browser target to a phone capture surface so captured text, barcodes, dictation, or photos can return to the extension.
- Session Capability: a capture type that a Mobile Scanner Session allows, such as OCR, barcode, dictation, or photo.
- Starting Capture Mode: the mode selected by the full mobile app for the initial mobile screen; QR pairing itself does not choose a mode.
- Paired Mode Switch: changing capture modes on a paired phone without creating a new Mobile Scanner Session.
- Browser Capture Target: the latest editable browser target captured by the extension for Cursor-Targeted Captures.
- Cursor-Targeted Capture: an OCR, barcode, or dictation capture intended to insert text into the browser's remembered editable target.
- Photo Capture: a Mobile Scanner capture whose result is one or more listing-friendly image files delivered from the full mobile app to Chrome over WebRTC, with no silent loss of accepted photos.
- Photo Object Transfer: obsolete full-app architecture from ADR 0001 where photos were uploaded to short-lived object storage through scanner-signal grants. ADR 0002 supersedes it.
- Photo Recovery Window: the 24-hour period where the full app keeps unreceipted local retry copies eligible for WebRTC redelivery.
- Photo Contributor: any phone that joins the WebRTC scanner session and is identified only by a device-generated contributor id.
- Browser Photo Receipt: Chrome's `photo_received` control message confirming it has stored final photo blob/metadata and mobile can delete its pending retry copy.
- Mobile Photo Transfer Status: the mobile-side queued, sending, sent, failed, received, or cancelled state for each pending WebRTC photo.
- Mobile Photo Retry Queue: the full mobile app's durable local queue for retrying WebRTC Photo Capture delivery during the Photo Recovery Window.
- Transfer Photo Rendition: the compressed listing-friendly JPEG sent for Photo Capture, with orientation and useful dimensions preserved and location metadata stripped.
- WebRTC Pairing Session: a Mobile Scanner Session where the phone and extension exchange scanner messages over a WebRTC data channel.
- Background Message: a request sent to the extension background worker to perform privileged browser work such as tab navigation, sidepanel control, QR generation, or clipboard access.

## Relationships

- A Photo Capture has one or more photos.
- A Cursor-Targeted Capture uses the latest Browser Capture Target; a Photo Capture does not.
- OCR, barcode, dictation, and photo payloads are sent over WebRTC after pairing. `scanner-signal` is only a signaling rendezvous for join tokens, offers, and answers.
- Mobile Scanner Sessions are capability-bound rather than mode-bound; a session can allow multiple Session Capabilities while the UI starts in a selected mode.
- The QR opens a join-token WebRTC Pairing Session; scanner-signal owns only signaling state, not capture modes or payload delivery.
- The full mobile app supports Paired Mode Switch among OCR, barcode, dictation, and photo in one WebRTC session.
- Dictation remains a full mobile app capture mode.
- Each Photo Capture photo moves through queued, sending, sent, failed, received, or cancelled on mobile.
- A Photo Delivery Acknowledgement means the browser side has taken responsibility for the photo.
- Photo Delivery Acknowledgements are per photo, not per session.
- Mobile retry copies expire after 24 hours.
- A Photo Contributor is authorized by scanning the QR for the visible join token.
- A Photo Contributor id supports dedupe, debugging, and transfer status; it is not a user identity.
- Browser Photo Receipt includes storing browser-side blob/metadata and showing the photo in the sidepanel gallery.
- Browser storage rejection leaves the mobile photo failed and retryable after the user frees space.
- The mobile app does not treat a Photo Capture as delivered until Browser Photo Receipt is observed; sent-but-unreceived photos remain visible as waiting or retryable.
- The sidepanel shows a Photo Transfer Ledger so batch transfers and multi-phone contributions have visible delivery status.
- The full mobile app persists a Mobile Photo Retry Queue for the Photo Recovery Window.
- Photo Capture sends Transfer Photo Renditions over WebRTC, not original camera files and not object-storage uploads.
