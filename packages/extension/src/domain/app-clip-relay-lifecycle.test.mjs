import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const offscreenSource = readFileSync(
  new URL("../offscreen/mobile-scanner-offscreen.ts", import.meta.url),
  "utf8"
);
const contextMenuSource = readFileSync(
  new URL("../../entrypoints/context-menu.tsx", import.meta.url),
  "utf8"
);
const backgroundSource = readFileSync(
  new URL("../../entrypoints/background.ts", import.meta.url),
  "utf8"
);
const mobileScannerSource = readFileSync(
  new URL("../components/sidepanel/MobileScanner.tsx", import.meta.url),
  "utf8"
);

test("App Clip result relay polling has a timeout and clears it on success", () => {
  assert.match(offscreenSource, /const SCANNER_RESULT_TIMEOUT_MS = SCANNER_SESSION_TTL_MS;/);
  assert.match(offscreenSource, /private resultPollTimeout: number \| null = null;/);
  assert.match(offscreenSource, /JSON\.stringify\(mode \? \{ relay: true, mode, target, browserClaim \} : \{ relay: true, target, browserClaim \}\)/);
  assert.match(offscreenSource, /window\.setTimeout\(\(\) => \{/);
  assert.match(offscreenSource, /App Clip session timed out/);
  assert.match(offscreenSource, /window\.clearTimeout\(this\.resultPollTimeout\)/);
});

test("App Clip QR uses the associated domain invocation URL for local and advanced experiences", () => {
  assert.match(offscreenSource, /const SCANNER_APP_CLIP_BASE_URL = SCANNER_SIGNAL_URL\.replace\("\/api\/signal", "\/clip"\);/);
  assert.match(offscreenSource, /isAppClipCaptureMode\(mode\)/);
  assert.match(offscreenSource, /`\$\{SCANNER_APP_CLIP_BASE_URL\}\/\$\{encodeURIComponent\(mode\)\}\?session=\$\{encodedSession\}`/);
  assert.match(offscreenSource, /`\$\{SCANNER_APP_CLIP_BASE_URL\}\?session=\$\{encodedSession\}`/);
  assert.doesNotMatch(offscreenSource, /https:\/\/appclip\.apple\.com\/id/);
});

test("App Clip session target updates are forwarded while a session is active", () => {
  assert.match(offscreenSource, /scannerOffscreenUpdateTarget/);
  assert.match(offscreenSource, /\/target`/);
});

test("App Clip relay polling marks sessions connected after the App Clip opens them", () => {
  assert.match(offscreenSource, /connectedAt/);
  assert.match(offscreenSource, /fetch\(`\$\{SCANNER_SIGNAL_URL\}\/\$\{sessionId\}`\)/);
  assert.match(offscreenSource, /sessionPayload\.connectedAt !== this\.state\.connectedAt/);
  assert.match(offscreenSource, /connectedAt: sessionPayload\.connectedAt/);
});

test("Mobile Scanner sidepanel no longer owns the pairing QR surface", () => {
  assert.doesNotMatch(mobileScannerSource, /QRCode/);
  assert.doesNotMatch(mobileScannerSource, /qrDataUrl/);
  assert.doesNotMatch(mobileScannerSource, /pairingQrOpen/);
  assert.match(mobileScannerSource, /function CompactScannerStatus/);
});

test("Mobile Scanner context menu opens the QR pairing session in the browser action popup", () => {
  assert.match(contextMenuSource, /action: "openMobileCapture"/);
  assert.match(contextMenuSource, /surface: "popup"/);
  assert.match(contextMenuSource, /onInvoke: \(\) => openMobileCapture\("barcode"\)/);
  assert.doesNotMatch(contextMenuSource, /MobileCaptureQrOverlay/);
  assert.doesNotMatch(contextMenuSource, /openMobileSidepanel/);
  assert.match(backgroundSource, /mobile-scanner-popup\.html/);
  assert.match(backgroundSource, /chrome\.action\.setPopup/);
  assert.match(backgroundSource, /chrome\.action\.openPopup/);
  assert.doesNotMatch(backgroundSource, /chrome\.windows\.create\(\{\s*url: popupUrl\.href/);
  assert.match(backgroundSource, /case "scannerPairingPopupClosed"/);
});

test("App Clip relay session survives offscreen document recreation", () => {
  assert.match(offscreenSource, /SCANNER_RELAY_STATE_STORAGE_KEY = "volt\.mobileScanner\.relaySession\.v1"/);
  assert.match(offscreenSource, /restorePersistedSession/);
  assert.match(offscreenSource, /this\.pollForResult\(persisted\.sessionId, persisted\.createdAt\)/);
  assert.match(offscreenSource, /seenResultIds: Array\.from\(this\.seenRelayResultIds\)\.slice\(-200\)/);
  assert.doesNotMatch(offscreenSource, /chrome\.storage\.local/);
  assert.match(backgroundSource, /case "scannerRelayStateGet"/);
  assert.match(backgroundSource, /case "scannerRelayStateSet"/);
  assert.match(backgroundSource, /case "scannerRelayStateRemove"/);
});

test("App Clip photo relay is acknowledged only after extension downloads and stores metadata", () => {
  assert.match(offscreenSource, /acknowledgeRelayResults/);
  assert.match(offscreenSource, /\/result\/ack`/);
  assert.match(offscreenSource, /if \(stored && result\.mode === "photo"\) photoAckIds\.push\(result\.id\)/);
  assert.match(backgroundSource, /async function handleScannerPhoto/);
  assert.match(backgroundSource, /const downloadResult = await downloadMobilePhoto\(photo\)/);
  assert.match(backgroundSource, /saveMobileScannerPhoto\(downloadedPhoto\)/);
  assert.match(backgroundSource, /const persisted = savedPhoto \? true : await persistMobilePhoto\(downloadedPhoto\)/);
  assert.match(backgroundSource, /const \{ blob, \.\.\.savedPhotoMetadata \} = savedPhoto\?\.photo \?\? \{\}/);
  assert.match(backgroundSource, /\{ \.\.\.savedPhotoMetadata, dataUrl: downloadedPhoto\.dataUrl \}/);
});

test("Mobile Scanner popup entrypoint renders and dismisses the pairing QR", () => {
  const popupSource = readFileSync(
    new URL("../../entrypoints/mobile-scanner-popup/main.tsx", import.meta.url),
    "utf8"
  );
  assert.match(popupSource, /QRCode\.toDataURL\(state\.qrCodeUrl/);
  assert.match(popupSource, /action: "scannerStartForMode"/);
  assert.match(popupSource, /appClipRelay: true/);
  assert.match(backgroundSource, /appClipRelay: message\?\.surface === "popup"/);
  assert.match(backgroundSource, /appClipRelay: message\?\.appClipRelay === true/);
  assert.match(popupSource, /joinWindowExpiresAt/);
  assert.match(popupSource, /Date\.parse\(state\.joinWindowExpiresAt\)/);
  assert.match(popupSource, /expiresAt - Date\.now\(\) - 5_000/);
  assert.match(popupSource, /startSession\(true\)/);
  assert.match(popupSource, /message\?\.action !== "scannerStateChanged"/);
  assert.match(popupSource, /scannerPairingPopupClosed/);
  assert.match(popupSource, /state\.status === "connected"/);
  assert.match(popupSource, /const openedAt = useMemo\(\(\) => Date\.now\(\), \[\]\);/);
  assert.match(popupSource, /connectedAt < openedAt - 1_000/);
  assert.match(popupSource, /window\.close\(\)/);
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

test("live dictation insertion preserves spaces between partial deltas", () => {
  assert.match(backgroundSource, /const liveDictationDelta = \(sourceLength\) => \{/);
  assert.match(backgroundSource, /return sourceLength > 0 \? delta : delta\.trimStart\(\);/);
  assert.match(backgroundSource, /live\.node\.nodeValue = liveDictationDelta\(liveSourceStart\);/);
  assert.match(backgroundSource, /const nextValue = live\?\.sessionId === liveSessionId \? liveDictationDelta\(liveSourceLength\) : value;/);
  assert.match(backgroundSource, /liveDictationDelta\(replaceLiveInput \? liveSourceStart : liveSourceLength\)/);
  assert.doesNotMatch(backgroundSource, /value\.slice\(liveSourceLength\)\.trimStart\(\)/);
});
