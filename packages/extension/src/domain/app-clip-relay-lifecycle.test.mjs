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
  assert.match(offscreenSource, /const SCANNER_RESULT_TIMEOUT_MS = 30 \* 60 \* 1000;/);
  assert.match(offscreenSource, /private resultPollTimeout: number \| null = null;/);
  assert.match(offscreenSource, /JSON\.stringify\(mode \? \{ relay: true, mode, target \} : \{ relay: true, target \}\)/);
  assert.match(offscreenSource, /window\.setTimeout\(\(\) => \{/);
  assert.match(offscreenSource, /App Clip session timed out/);
  assert.match(offscreenSource, /window\.clearTimeout\(this\.resultPollTimeout\)/);
});

test("App Clip QR uses the associated domain invocation URL for local and advanced experiences", () => {
  assert.match(offscreenSource, /const SCANNER_APP_CLIP_BASE_URL = "https:\/\/scanner-signal\.vercel\.app\/clip";/);
  assert.match(offscreenSource, /return `\$\{SCANNER_APP_CLIP_BASE_URL\}\?session=\$\{encodedSession\}`;/);
  assert.doesNotMatch(offscreenSource, /SCANNER_APP_CLIP_BASE_URL\}\/\$\{mode\}/);
  assert.doesNotMatch(offscreenSource, /https:\/\/appclip\.apple\.com\/id/);
});

test("App Clip session target updates are forwarded while a session is active", () => {
  assert.match(offscreenSource, /scannerOffscreenUpdateTarget/);
  assert.match(offscreenSource, /\/target`/);
});

test("App Clip relay polling marks sessions connected after the App Clip opens them", () => {
  assert.match(offscreenSource, /connectedAt/);
  assert.match(offscreenSource, /fetch\(`\$\{SCANNER_SIGNAL_URL\}\/\$\{sessionId\}`\)/);
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

test("App Clip photo relay is acknowledged only after extension storage accepts it", () => {
  assert.match(offscreenSource, /acknowledgeRelayResults/);
  assert.match(offscreenSource, /\/result\/ack`/);
  assert.match(offscreenSource, /if \(stored && result\.mode === "photo"\) photoAckIds\.push\(result\.id\)/);
  assert.match(backgroundSource, /async function handleScannerPhoto/);
  assert.match(backgroundSource, /const persisted = await persistMobilePhoto\(photo\)/);
});

test("closing the App Clip QR overlay disconnects the scanner session", () => {
  assert.match(contextMenuSource, /const closeMobileCaptureQr = \(options: \{ disconnect\?: boolean \} = \{\}\) => \{/);
  assert.match(contextMenuSource, /chrome\.runtime\.sendMessage\(\{ action: "scannerDisconnect" \}\)/);
  assert.match(contextMenuSource, /closeMobileCaptureQr\(\{ disconnect: false \}\)/);
});

test("unified Mobile Scanner can drag the selected photo batch", () => {
  assert.match(mobileScannerSource, /selectedPhotoIds/);
  assert.match(mobileScannerSource, /const dragPhotos = selectedPhotoIds\.has\(photo\.id\) \? selectedPhotos : \[photo\]/);
  assert.match(mobileScannerSource, /event\.dataTransfer\.setData\(PHOTO_DROP_MIME, JSON\.stringify\(dragPhotos\)\)/);
  assert.match(mobileScannerSource, /photosToSend\.map\(\(photo\) =>/);
});
