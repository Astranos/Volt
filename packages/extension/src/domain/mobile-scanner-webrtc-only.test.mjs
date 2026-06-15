import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const offscreenSource = readFileSync(
  new URL("../offscreen/mobile-scanner-offscreen.ts", import.meta.url),
  "utf8"
);
const mobileScannerSource = readFileSync(
  new URL("../components/sidepanel/MobileScanner.tsx", import.meta.url),
  "utf8"
);

test("offscreen scanner is WebRTC-only and has no HTTPS relay session path", () => {
  assert.match(offscreenSource, /new MobileScannerSession/);
  assert.match(offscreenSource, /scannerOffscreenStart/);
  assert.match(offscreenSource, /scannerOffscreenCloseJoinWindow/);
  assert.match(offscreenSource, /scannerOffscreenDisconnect/);
  assert.doesNotMatch(offscreenSource, /SCANNER_RELAY_STATE_STORAGE_KEY/);
  assert.doesNotMatch(offscreenSource, /appClipRelay/);
});

test("offscreen scanner does not poll scanner-signal for relay results or photo manifests", () => {
  assert.doesNotMatch(offscreenSource, /pollForResult/);
  assert.doesNotMatch(offscreenSource, /ScannerRelayResult/);
  assert.doesNotMatch(offscreenSource, /\/result/);
  assert.doesNotMatch(offscreenSource, /\/result\/ack/);
  assert.doesNotMatch(offscreenSource, /\/photo\/manifest/);
  assert.doesNotMatch(offscreenSource, /\/photo\/ack/);
  assert.doesNotMatch(offscreenSource, /\/photo\/failure/);
  assert.doesNotMatch(offscreenSource, /browserClaim/);
});

test("Mobile Scanner sidepanel remains results-only and no longer owns the pairing QR surface", () => {
  assert.doesNotMatch(mobileScannerSource, /QRCode/);
  assert.doesNotMatch(mobileScannerSource, /qrDataUrl/);
  assert.doesNotMatch(mobileScannerSource, /pairingQrOpen/);
  assert.match(mobileScannerSource, /function CompactScannerStatus/);
});

test("unified Mobile Scanner can drag the selected photo batch", () => {
  assert.match(mobileScannerSource, /selectedPhotoIds/);
  assert.match(mobileScannerSource, /const sourcePhotos = selectedPhotoIds\.has\(photo\.id\) \? selectedPhotos : \[photo\]/);
  assert.match(mobileScannerSource, /event\.dataTransfer\.items\.add\(file\)/);
  assert.match(mobileScannerSource, /event\.dataTransfer\.setData\(PHOTO_DROP_MIME, JSON\.stringify\(bridgePayload\)\)/);
  assert.match(mobileScannerSource, /onToggleSelection=\{\(shiftKey\) => onToggleSelection\(entry\.id, shiftKey\)\}/);
});

test("unified Mobile Scanner copies photos as PNG clipboard items", () => {
  assert.match(mobileScannerSource, /async function photoToClipboardPngBlob\(photo: MobilePhoto\)/);
  assert.match(mobileScannerSource, /if \(photo\.blob\) return dataUrlToPngBlob\(await blobToDataUrl\(photo\.blob\)\)/);
  assert.match(mobileScannerSource, /new ClipboardItem\(\{ "image\/png": blob \}\)/);
  assert.doesNotMatch(mobileScannerSource, /new ClipboardItem\(\{ \[photo\.blob\.type \|\| photo\.mimeType\]: photo\.blob \}\)/);
  assert.match(mobileScannerSource, /\[Volt Mobile Scanner\] Photo clipboard copy failed/);
});
