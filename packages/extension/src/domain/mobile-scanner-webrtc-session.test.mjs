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
  assert.match(sessionSource, /SCANNER_CONTROL_CHANNEL_LABEL/);
  assert.match(sessionSource, /PHOTO_TRANSFER_CHANNEL_LABEL/);
  assert.match(sessionSource, /pc\.createDataChannel\(SCANNER_CONTROL_CHANNEL_LABEL/);
  assert.match(sessionSource, /pc\.createDataChannel\(PHOTO_TRANSFER_CHANNEL_LABEL/);
  assert.doesNotMatch(sessionSource, /const SCANNER_CONTROL_CHANNEL = "scanner-control"/);
  assert.doesNotMatch(sessionSource, /const PHOTO_TRANSFER_CHANNEL = "photo-transfer"/);
});

test("extension WebRTC session creates offers per join attempt while join window is open", () => {
  assert.match(sessionSource, /openJoinWindow/);
  assert.match(sessionSource, /pollForJoinAttempts/);
  assert.match(sessionSource, /SCANNER_JOIN_TOKEN_TTL_MS/);
  assert.doesNotMatch(sessionSource, /const JOIN_WINDOW_TTL_MS = 30_000/);
  assert.match(sessionSource, /createPeerOffer\(joinWindow, attempt\.joinAttemptId\)/);
  assert.match(sessionSource, /join-token\/\$\{encodeURIComponent\(joinWindow\.joinToken\)\}\/attempt\/\$\{encodeURIComponent\(joinAttemptId\)\}\/offer/);
  assert.match(sessionSource, /closeJoinWindow/);
  assert.match(sessionSource, /join-token\/\$\{encodeURIComponent\(joinWindow\.joinToken\)\}\/revoke/);
});

test("extension keeps polling existing join attempts after the pairing popup closes", () => {
  assert.match(sessionSource, /private answerPollJoinWindow: JoinWindow \| null = null/);
  assert.match(sessionSource, /this\.answerPollJoinWindow = joinWindow/);
  assert.match(sessionSource, /const joinWindow = this\.joinWindow \?\? this\.answerPollJoinWindow/);
  assert.match(sessionSource, /const acceptingNewAttempts = this\.joinWindow\?\.joinToken === joinWindow\.joinToken/);
  assert.match(sessionSource, /if \(!acceptingNewAttempts\) continue/);
  assert.match(sessionSource, /stopHiddenJoinAttemptPollingIfIdle/);
  assert.doesNotMatch(sessionSource, /this\.joinWindow = null;\n\s*this\.stopJoinAttemptPolling\(\);/);
});

test("extension WebRTC session handles handshake, receipts, photo acks, and peer disconnects", () => {
  assert.match(sessionSource, /decodeScannerControlMessage/);
  assert.match(sessionSource, /encodeScannerControlMessage/);
  assert.match(sessionSource, /decodePhotoTransferMessage/);
  assert.match(sessionSource, /decodePhotoTransferChunkFrame/);
  assert.match(sessionSource, /type: "hello"/);
  assert.match(sessionSource, /type: "session_ready"/);
  assert.match(sessionSource, /function controlMessageType/);
  assert.match(sessionSource, /if \(peer\.ready\)/);
  assert.match(sessionSource, /pc\.connectionState === "connected" && peer\.ready/);
  assert.match(sessionSource, /type: "protocol_error"/);
  assert.match(sessionSource, /type: "result_received"/);
  assert.match(sessionSource, /type: "photo_chunk_ack"/);
  assert.match(sessionSource, /type: "photo_received"/);
  assert.match(sessionSource, /session_closed/);
});

test("offscreen and background route global join-window lifecycle separately from peer disconnect", () => {
  assert.match(offscreenSource, /new MobileScannerSession/);
  assert.match(offscreenSource, /scannerOffscreenCloseJoinWindow/);
  assert.match(backgroundSource, /case "scannerCloseJoinWindow"/);
  assert.match(backgroundSource, /case "scannerPairingPopupClosed"/);
  assert.match(backgroundSource, /case "scannerDebugLog"/);
  assert.match(offscreenSource, /action: "scannerDebugLog"/);
  assert.match(backgroundSource, /handleScannerPairingPopupClosed\(sendResponse\)/);
  assert.doesNotMatch(backgroundSource, /case "scannerDisconnect"[\s\S]{0,120}scannerOffscreenCloseJoinWindow/);
});
