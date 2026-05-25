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

test("App Clip result relay polling has a timeout and clears it on success", () => {
  assert.match(offscreenSource, /const SCANNER_RESULT_TIMEOUT_MS = 30 \* 60 \* 1000;/);
  assert.match(offscreenSource, /private resultPollTimeout: number \| null = null;/);
  assert.match(offscreenSource, /JSON\.stringify\(\{ relay: true, mode \}\)/);
  assert.match(offscreenSource, /window\.setTimeout\(\(\) => \{/);
  assert.match(offscreenSource, /App Clip session timed out/);
  assert.match(offscreenSource, /window\.clearTimeout\(this\.resultPollTimeout\)/);
});

test("closing the App Clip QR overlay disconnects the scanner session", () => {
  assert.match(contextMenuSource, /const closeMobileCaptureQr = \(options: \{ disconnect\?: boolean \} = \{\}\) => \{/);
  assert.match(contextMenuSource, /chrome\.runtime\.sendMessage\(\{ action: "scannerDisconnect" \}\)/);
  assert.match(contextMenuSource, /closeMobileCaptureQr\(\{ disconnect: false \}\)/);
});
