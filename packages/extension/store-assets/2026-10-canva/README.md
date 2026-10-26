# Volt Chrome Web Store screenshots

This Canva revision replaces the earlier `2026-10` screenshot set.

[Edit all five pages in Canva](https://www.canva.com/d/CdOYe6EOyYUZohL).
Canva design ID: `DAHZFPhxgqI`.

`chrome-web-store-screenshots.zip` is the original five-page Canva export.
The same five PNGs are in `screenshots/`, in upload order. Each is 1280 × 800,
RGB, opaque, and full bleed. No imagegen assets are used in this revision.

## What changed

The layouts use Inter Regular, short centered headings, large captures,
restrained framing, and a light neutral background. Canva's editor was
checked to confirm Inter, bold off, and a 1280 × 800 canvas. Export settings
were PNG, 1×, high quality, all pages, transparent background off.

Product photos are clean front-and-back shots, centered with consistent
padding in 1024 × 1024 white images. They fit the extension's square thumbnail
slots without cropping the phones. The pink listing now uses a pink phone.
The comparison uses only photos of each matching model.

## Capture provenance

All interface imagery was captured with Playwright at 2× resolution. No interface was drawn
or generated. Layout, headings, background, and screenshot containers were
imported into Canva as editable elements, then exported from Canva itself.

- Inventory and comparison: real Volt React components from commit `b6c0cc8a`
  rendered in the repository's preview harness with sample inventory. During
  capture, Playwright supplied the replacement product images as demo data.
  Production UI source and the existing checkout were not modified.
- UPC hover and right-click menu: actual v1.0.80 content scripts interacting
  with the public page https://www.upcitemdb.com/upc/673419388658.
- Offer Calculator: actual v1.0.80 `sidepanel.html`, with $400 entered. The
  document was captured in an isolated extension tab. Canva places its crop
  beside a research-page capture; it is not a single docked-browser screenshot.

Source screenshots, crops, square photos, image source URLs, and capture
provenance are in `sources/`. Capture profiles were isolated and no signed-in
shop data or credentials were used.

## Style references inspected

The actual Web Store screenshot images of these extensions informed the shorter
headings, lighter typography, screenshot scale, and restrained backgrounds:

- [Momentum](https://chromewebstore.google.com/detail/momentum/laookkfknpbbblfpciffpaejjkokdgca)
- [Raindrop.io](https://chromewebstore.google.com/detail/raindropio/ldgfbffkinooeloadekpmfoklnobpien)
- [Scribe](https://chromewebstore.google.com/detail/scribe-ai-documentation-s/okfkdaglfjjjfefdcppliegebpoegaii)

## Reproduce and verify

`capture-demo.mjs` captures the inventory and comparison from a running checkout
that includes the existing extension preview workflow. Its default URL is
`http://127.0.0.1:5198`; override with `VOLT_PREVIEW_URL`. Use
`CHROME_EXECUTABLE` to select Chrome for Testing. Sample product data is routed
inside the isolated browser, leaving source files unchanged.

`prepare-products.mjs` downloads the referenced product images;
`normalize-products.mjs` centers them on square backgrounds. These scripts
require the extension's installed `sharp` dependency.

`make-layout.mjs` regenerates `canva-import.html`, the self-contained editable
Canva import source. It preserves the captured UI as image elements and uses
native text elements for the surrounding copy. Import it into Canva, then
export all pages as PNG at 1×. Final screenshots must come from Canva's export.

`verification.json` records the final dimensions, RGB channels, and Canva
export settings. The archive's file bytes were compared to the saved PNGs.
The export was visually checked at full resolution and 640 × 400 preview size.

[Chrome Web Store screenshot requirements](https://developer.chrome.com/docs/webstore/images)
allow up to five full-bleed screenshots at 1280 × 800 or 640 × 400.
The Web Store listing was not uploaded or changed.
