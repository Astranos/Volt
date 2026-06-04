# Scout Context

Scout is a Chrome extension and companion web app for resale workflows.

## Current Mobile Scanner Direction

ADR 0002 is the source of truth for the full mobile app scanner flow. The full app pairs through `scanner-signal` join tokens and then sends text, barcode, dictation, and photo results over direct WebRTC data channels only. App Clip relay and photo object transfer remain legacy/App Clip compatibility paths, not the full-app scanner transport.

## Domain Terms

- Command Menu: the CMDK-powered palette for tabs, quick links, bookmarks, tools, search providers, and history.
- New Tab: the custom browser new-tab experience with search modes, recently closed tabs, quick links, bookmarks, and sidepanel tool launchers.
- Search Provider: a configured destination that turns a query into a navigable URL.
- Search Intent: the resolved action from user input, such as opening a URL, searching a provider, or searching Shopify inventory.
- Shopify Inventory Search: a search that resolves the current Shopify store and opens the admin products page ordered by available inventory.
- Sidepanel Tool: a tool hosted in the extension sidepanel, such as Controller Testing, Top Offers, eBay Categories, Buying Guide, Shopify Help, or Mobile Scanner.
- Top Offer: a resale offer value calculated from a projected selling price and configurable rate rules.
- Mobile Scanner Session: a short-lived capture session that links a Chrome browser target to a phone capture surface so captured text, barcodes, dictation, or photos can return to the extension.
- Session Capability: a capture type that a Mobile Scanner Session allows, such as OCR, barcode, dictation, or photo.
- Starting Capture Mode: the mode selected by the QR or launch URL for the initial mobile screen.
- Paired Mode Switch: changing capture modes on a paired phone without creating a new Mobile Scanner Session.
- Browser Capture Target: the latest editable browser target captured by the extension for Cursor-Targeted Captures.
- Cursor-Targeted Capture: an OCR, barcode, or dictation capture intended to insert text into the browser's remembered editable target.
- App Clip Capture Mode: a Mobile Scanner mode supported by the App Clip; currently OCR, barcode, and photo, explicitly excluding dictation.
- Photo Capture: a Mobile Scanner capture whose result is one or more image files delivered from the mobile app or App Clip to the Chrome browser, with browser downloads as an acceptable destination and no silent loss of accepted photos.
- Photo Transfer Broker: scanner-signal's role in Photo Capture; it coordinates short-lived session state, transfer metadata, and acknowledgements, but does not durably store photo bytes.
- Photo Object Transfer: the default Photo Capture delivery path for both the full mobile app and App Clip, where the phone uploads photo bytes to short-lived object storage, scanner-signal brokers the manifest, and the extension downloads each photo to the browser computer.
- Photo Transfer Endpoint: a scanner-signal session endpoint dedicated to Photo Capture grants, manifests, browser acknowledgements, and browser download failures.
- Photo Object Store: the short-lived object storage used by Photo Object Transfer; Vercel Blob is the initial provider, hidden behind a small adapter so the storage provider can change later.
- Photo Upload Grant: a short-lived scanner-signal authorization for exactly one Photo Capture file to be uploaded to the Photo Object Store for a specific Mobile Scanner Session.
- Photo Delivery Acknowledgement: the extension's confirmation that it has downloaded a Photo Capture object and either saved it through browser downloads or persisted local metadata for browser-side use.
- Photo Recovery Window: the 24-hour period where both Photo Capture transfer state and uploaded photo objects remain retrievable for browser-side recovery.
- Browser Claim: a browser-side authorization held by the Chrome profile that created a Photo Capture session; it is required to recover or download that session's photos.
- Photo Contributor: any phone that scans a Photo Capture QR and is allowed to add photos to that session, identified only by a device-generated contributor id.
- App Clip Photo Batch: a small capped Photo Capture batch sent from the App Clip in one invocation.
- Open Photo Capture Queue: a Photo Capture session that can continue accepting new photos until the user ends it or the Photo Recovery Window expires.
- Photo Capture Closure: the end of an Open Photo Capture Queue; the phone may stop adding photos, but the creating Chrome profile finalizes closure for browser recovery.
- Browser Photo Receipt: the browser-side completion of Photo Capture where the extension downloads each photo to the computer and shows it in the Mobile Scanner or Mobile Photos gallery for use.
- Browser Photo Download Failure: a retryable state where a Photo Capture object is available to the browser but has not been saved locally and must not be acknowledged as delivered.
- Photo Download Set: the predictable browser-download folder for a Photo Capture, named by session date with sequence-prefixed photo filenames.
- Photo Transfer Ledger: the compact sidepanel record of Photo Capture photos and their uploaded, downloading, downloaded, failed, and retryable states.
- Mobile Photo Transfer Status: the mobile-side state that distinguishes uploaded photos from browser-received photos so the app can show retry or waiting states honestly.
- Mobile Photo Retry Queue: the full mobile app's durable queue for retrying Photo Capture uploads and receipt checks during the Photo Recovery Window.
- Transfer Photo Rendition: the compressed listing-friendly image file uploaded for Photo Capture, with orientation and dimensions preserved and location metadata stripped.
- WebRTC Pairing Session: a Mobile Scanner Session where the phone and extension exchange scanner messages over a WebRTC data channel.
- App Clip Relay Session: a Mobile Scanner Session where the extension creates a scanner-signal relay, the App Clip posts mode-matched results over HTTPS, and the extension polls for them.
- Background Message: a request sent to the extension background worker to perform privileged browser work such as tab navigation, sidepanel control, QR generation, or clipboard access.

## Relationships

- A Photo Capture has one or more photos.
- A Photo Capture remains an Open Photo Capture Queue until explicitly ended or expired.
- A phone can mark a Photo Capture as done adding photos, but only the Browser Claim can finalize Photo Capture Closure.
- A Cursor-Targeted Capture uses the latest Browser Capture Target; a Photo Capture does not.
- Cursor-Targeted Captures use the lightweight scanner-signal relay result endpoint; Photo Captures use Photo Object Transfer.
- Photo Transfer Endpoints are separate from the scanner-signal relay result endpoint used by Cursor-Targeted Captures.
- A Mobile Scanner Session uses one session id across cursor-targeted relay results and Photo Capture transfer endpoints; photo transfer has a separate contract, not a separate user-visible session.
- Mobile Scanner Sessions are capability-bound rather than mode-bound; a session can allow multiple Session Capabilities while the UI starts in a selected mode.
- The QR or launch URL may provide a Starting Capture Mode, but scanner-signal owns the allowed Session Capabilities for the session.
- The full mobile app and App Clip both support Paired Mode Switch among the Session Capabilities they can run; App Clip still excludes dictation.
- WebRTC Pairing Sessions are for small scanner messages, not the default Photo Capture delivery path.
- Dictation remains a full mobile app capture mode and is not an App Clip Capture Mode.
- Each Photo Capture photo moves through uploaded, available_to_browser, and browser_received.
- A Photo Delivery Acknowledgement means the browser side has taken responsibility for the photo.
- Photo Delivery Acknowledgements are per photo, not per session.
- Active polling may stop after 30 minutes, but Photo Capture transfer state and uploaded photo objects remain recoverable for 24 hours.
- Photo Capture recovery is limited to the Chrome profile that created the session, even when multiple store users are transferring photos from nearby phones and computers.
- A Photo Contributor is authorized by scanning the QR, but recovery and downloads still require the Browser Claim.
- A Photo Contributor id supports dedupe, debugging, and transfer status; it is not a user identity.
- Each Photo Capture file requires its own Photo Upload Grant, even when grants are requested in a batch.
- A Photo Upload Grant is requested after the Transfer Photo Rendition is created, so scanner-signal can validate the actual MIME type, size, dimensions, contributor id, and proposed filename.
- An App Clip Photo Batch supports up to 10 photos or 100 MB total, while the full mobile app can support larger Photo Capture queues.
- Browser Photo Receipt includes both automatic browser downloads and a sidepanel gallery entry; the download is the durable result and the gallery is the working surface.
- Browser Photo Download Failure leaves the photo available_to_browser, shows a retry or download action, and does not create a Photo Delivery Acknowledgement.
- Browser downloads for a Photo Capture are grouped under Volt Photos by session date and use collision-safe sequence-prefixed filenames.
- The mobile app and App Clip do not treat a Photo Capture as sent until Browser Photo Receipt is observed; uploaded-but-unreceived photos remain visible as waiting or retryable.
- The sidepanel shows a Photo Transfer Ledger so batch transfers and multi-phone contributions have visible delivery status.
- The full mobile app persists a Mobile Photo Retry Queue for the Photo Recovery Window; App Clip retry is best-effort and must not be the only recovery path.
- Photo Capture uploads Transfer Photo Renditions, not original camera files.
