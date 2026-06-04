import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sessionSource = readFileSync(
  new URL("./mobile-scanner-session.ts", import.meta.url),
  "utf8"
);
const offscreenSource = readFileSync(
  new URL("../offscreen/mobile-scanner-offscreen.ts", import.meta.url),
  "utf8"
);
const backgroundSource = readFileSync(
  new URL("../../entrypoints/background.ts", import.meta.url),
  "utf8"
);

test("extension WebRTC session owns scanner-control and photo-transfer channels", () => {
  assert.match(sessionSource, /const SCANNER_CONTROL_CHANNEL = "scanner-control"/);
  assert.match(sessionSource, /const PHOTO_TRANSFER_CHANNEL = "photo-transfer"/);
  assert.match(sessionSource, /pc\.createDataChannel\(SCANNER_CONTROL_CHANNEL/);
  assert.match(sessionSource, /pc\.createDataChannel\(PHOTO_TRANSFER_CHANNEL/);
});

test("extension WebRTC session creates offers per join attempt while join window is open", () => {
  assert.match(sessionSource, /openJoinWindow/);
  assert.match(sessionSource, /pollForJoinAttempts/);
  assert.match(sessionSource, /createPeerOffer\(joinWindow, attempt\.joinAttemptId\)/);
  assert.match(sessionSource, /join-token\/\$\{encodeURIComponent\(joinWindow\.joinToken\)\}\/attempt\/\$\{encodeURIComponent\(joinAttemptId\)\}\/offer/);
  assert.match(sessionSource, /closeJoinWindow/);
  assert.match(sessionSource, /join-token\/\$\{encodeURIComponent\(joinWindow\.joinToken\)\}\/revoke/);
});

test("extension WebRTC session handles handshake, receipts, photo acks, and peer disconnects", () => {
  assert.match(sessionSource, /type: "hello"/);
  assert.match(sessionSource, /type: "session_ready"/);
  assert.match(sessionSource, /type: "protocol_error"/);
  assert.match(sessionSource, /type: "receipt"/);
  assert.match(sessionSource, /type: "photo_chunk_ack"/);
  assert.match(sessionSource, /type: "photo_received"/);
  assert.match(sessionSource, /session_close/);
  assert.match(sessionSource, /disconnect/);
});

test("offscreen and background route global join-window lifecycle separately from peer disconnect", () => {
  assert.match(offscreenSource, /new MobileScannerSession/);
  assert.match(offscreenSource, /scannerOffscreenCloseJoinWindow/);
  assert.match(backgroundSource, /case "scannerCloseJoinWindow"/);
  assert.match(backgroundSource, /case "scannerPairingPopupClosed"/);
  assert.match(backgroundSource, /handleScannerPairingPopupClosed\(sendResponse\)/);
  assert.doesNotMatch(backgroundSource, /case "scannerDisconnect"[\s\S]{0,120}scannerOffscreenCloseJoinWindow/);
});
