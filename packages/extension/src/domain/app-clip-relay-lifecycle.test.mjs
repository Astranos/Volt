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
  assert.match(offscreenSource, /JSON\.stringify\(mode \? \{ relay: true, mode, target \} : \{ relay: true, target \}\)/);
  assert.match(offscreenSource, /window\.setTimeout\(\(\) => \{/);
  assert.match(offscreenSource, /App Clip session timed out/);
  assert.match(offscreenSource, /window\.clearTimeout\(this\.resultPollTimeout\)/);
});

test("App Clip QR uses the associated domain invocation URL for local and advanced experiences", () => {
  assert.match(offscreenSource, /const SCANNER_APP_CLIP_BASE_URL = "https:\/\/scanner-signal\.vercel\.app\/clip";/);
  assert.match(offscreenSource, /return `\$\{SCANNER_APP_CLIP_BASE_URL\}\/\$\{mode\}\?session=\$\{encodedSession\}`;/);
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

test("closing the App Clip QR overlay disconnects the scanner session", () => {
  assert.match(contextMenuSource, /const closeMobileCaptureQr = \(options: \{ disconnect\?: boolean \} = \{\}\) => \{/);
  assert.match(contextMenuSource, /chrome\.runtime\.sendMessage\(\{ action: "scannerDisconnect" \}\)/);
  assert.match(contextMenuSource, /closeMobileCaptureQr\(\{ disconnect: false \}\)/);
});
