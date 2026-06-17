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
const pairingPopupSource = readFileSync(
  new URL("../../entrypoints/mobile-scanner-popup/main.tsx", import.meta.url),
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
  assert.match(sessionSource, /JOIN_WINDOW_TTL_MS = 2 \* 60 \* 1000/);
  assert.doesNotMatch(sessionSource, /const JOIN_WINDOW_TTL_MS = 30_000/);
  assert.match(sessionSource, /createPeerOffer\(joinWindow, attempt\.joinAttemptId\)/);
  assert.match(sessionSource, /join-token\/\$\{encodeURIComponent\(joinWindow\.joinToken\)\}\/attempt\/\$\{encodeURIComponent\(joinAttemptId\)\}\/offer/);
  assert.match(sessionSource, /closeJoinWindow/);
  assert.match(sessionSource, /join-token\/\$\{encodeURIComponent\(joinWindow\.joinToken\)\}\/revoke/);
});

test("extension bounds hidden join-attempt polling after the pairing popup closes", () => {
  assert.match(sessionSource, /private answerPollJoinWindow: JoinWindow \| null = null/);
  assert.match(sessionSource, /this\.answerPollJoinWindow = joinWindow/);
  assert.match(sessionSource, /HIDDEN_JOIN_ATTEMPT_POLL_GRACE_MS = 60 \* 1000/);
  assert.match(sessionSource, /const joinWindow = this\.joinWindow \?\? this\.answerPollJoinWindow/);
  assert.match(sessionSource, /const acceptingNewAttempts = this\.joinWindow\?\.joinToken === joinWindow\.joinToken/);
  assert.match(sessionSource, /if \(!acceptingNewAttempts\) continue/);
  assert.match(sessionSource, /JOIN_ATTEMPT_MAX_POLL_INTERVAL_MS = 10 \* 1000/);
  assert.match(sessionSource, /stopHiddenJoinAttemptPollingIfIdle/);
  assert.doesNotMatch(sessionSource, /this\.joinWindow = null;\n\s*this\.stopJoinAttemptPolling\(\);/);
});

test("pairing popup reuses an active QR when opened from Add iPhone", () => {
  assert.match(pairingPopupSource, /const ensureJoinWindow = useCallback/);
  assert.match(pairingPopupSource, /if \(currentState\?\.qrCodeUrl\) return;/);
  assert.match(pairingPopupSource, /void ensureJoinWindow\(nextState\);/);
  assert.match(pairingPopupSource, /onClick=\{\(\) => startSession\(true\)\}/);
  assert.match(pairingPopupSource, /void startSession\(true\);/);
  assert.doesNotMatch(pairingPopupSource, /void startSession\(false\);/);
  assert.doesNotMatch(pairingPopupSource, /startSession\(Boolean\(nextState\?\.qrCodeUrl\)\)/);
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

test("extension forwards current Chrome input target to connected mobile peers", () => {
  assert.match(sessionSource, /async updateTarget\(target\?: SessionTarget \| null\)/);
  assert.match(sessionSource, /this\.target = target \?\? null/);
  assert.match(sessionSource, /for \(const peer of this\.peers\.values\(\)\)/);
  assert.match(sessionSource, /this\.sendSessionReady\(peer\)/);
  assert.match(sessionSource, /label: this\.target\.cursor/);
  assert.match(offscreenSource, /scannerOffscreenUpdateTarget/);
});

test("extension hydrates persisted identity before polling reconnect requests", () => {
  assert.match(sessionSource, /private identityReady: Promise<void>/);
  assert.match(sessionSource, /this\.identityReady = this\.refreshExtensionIdentity\(\)\.then/);
  assert.match(sessionSource, /private async pollReconnectRequests\(\) \{\n\s+await this\.identityReady;/);
  assert.match(sessionSource, /const response = await fetch\(`\$\{SCANNER_SIGNAL_URL\}\/pairings\/reconnect-requests\?sessionId=\$\{encodeURIComponent\(sessionId\)\}`\)/);
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
