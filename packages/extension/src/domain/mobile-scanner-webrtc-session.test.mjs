import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sessionSource = readFileSync(
  new URL("./mobile-scanner-session.ts", import.meta.url),
  "utf8"
);
const identitySource = readFileSync(
  new URL("./mobile-scanner-identity.ts", import.meta.url),
  "utf8"
);
const peerConnectionSource = readFileSync(
  new URL("./mobile-scanner-peer-connection.ts", import.meta.url),
  "utf8"
);
const photoReceiverSource = readFileSync(
  new URL("./mobile-scanner-photo-receiver.ts", import.meta.url),
  "utf8"
);
const signalClientSource = readFileSync(
  new URL("./mobile-scanner-signal-client.ts", import.meta.url),
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
const wxtConfigSource = readFileSync(
  new URL("../../wxt.config.ts", import.meta.url),
  "utf8"
);
const pairingPopupSource = readFileSync(
  new URL("../../entrypoints/mobile-scanner-popup/main.tsx", import.meta.url),
  "utf8"
);

test("extension WebRTC session owns scanner-control and photo-transfer channels", () => {
  assert.match(peerConnectionSource, /SCANNER_CONTROL_CHANNEL_LABEL/);
  assert.match(peerConnectionSource, /PHOTO_TRANSFER_CHANNEL_LABEL/);
  assert.match(peerConnectionSource, /pc\.createDataChannel\(SCANNER_CONTROL_CHANNEL_LABEL/);
  assert.match(peerConnectionSource, /pc\.createDataChannel\(PHOTO_TRANSFER_CHANNEL_LABEL/);
  assert.doesNotMatch(peerConnectionSource, /const SCANNER_CONTROL_CHANNEL = "scanner-control"/);
  assert.doesNotMatch(peerConnectionSource, /const PHOTO_TRANSFER_CHANNEL = "photo-transfer"/);
});

test("extension WebRTC session creates offers per join attempt while join window is open", () => {
  assert.match(sessionSource, /openJoinWindow/);
  assert.match(sessionSource, /pollForJoinAttempts/);
  assert.match(sessionSource, /JOIN_WINDOW_TTL_MS = 2 \* 60 \* 1000/);
  assert.doesNotMatch(sessionSource, /const JOIN_WINDOW_TTL_MS = 30_000/);
  assert.match(sessionSource, /createPeerOffer\(joinWindow, attempt\.joinAttemptId\)/);
  assert.match(signalClientSource, /join-token\/\$\{encodeURIComponent\(joinWindow\.joinToken\)\}\/attempt\/\$\{encodeURIComponent\(joinAttemptId\)\}\/offer/);
  assert.match(sessionSource, /closeJoinWindow/);
  assert.match(signalClientSource, /join-token\/\$\{encodeURIComponent\(joinWindow\.joinToken\)\}\/revoke/);
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
  assert.match(photoReceiverSource, /decodePhotoTransferMessage/);
  assert.match(photoReceiverSource, /decodePhotoTransferChunkFrame/);
  assert.match(sessionSource, /type: "hello"/);
  assert.match(sessionSource, /type: "session_ready"/);
  assert.match(sessionSource, /function controlMessageType/);
  assert.match(sessionSource, /if \(peer\.ready\)/);
  assert.match(peerConnectionSource, /pc\.connectionState === "connected" && peer\.ready/);
  assert.match(sessionSource, /type: "protocol_error"/);
  assert.match(sessionSource, /type: "result_received"/);
  assert.match(photoReceiverSource, /type: "photo_chunk_ack"/);
  assert.match(photoReceiverSource, /type: "photo_received"/);
  assert.match(sessionSource, /session_closed/);
});

test("extension forwards current Chrome input target to connected mobile peers", () => {
  assert.match(sessionSource, /async updateTarget\(target\?: SessionTarget \| null\)/);
  assert.match(sessionSource, /this\.target = target \?\? null/);
  assert.match(sessionSource, /for \(const peer of this\.peerConnections\.peers\.values\(\)\)/);
  assert.match(sessionSource, /this\.sendSessionReady\(peer\)/);
  assert.match(sessionSource, /label: this\.target\.cursor/);
  assert.match(offscreenSource, /scannerOffscreenUpdateTarget/);
});

test("extension hydrates persisted identity before polling reconnect requests", () => {
  assert.match(sessionSource, /private (readonly )?identityReady: Promise<void>/);
  assert.match(sessionSource, /this\.identityReady = this\.refreshExtensionIdentity\(\)\.then/);
  assert.match(sessionSource, /private async pollReconnectRequests\(\) \{\n\s+await this\.identityReady;/);
  assert.match(signalClientSource, /const response = await fetch\(`\$\{SCANNER_SIGNAL_URL\}\/pairings\/reconnect-requests\?sessionId=\$\{encodeURIComponent\(sessionId\)\}`\)/);
});

test("offscreen localStorage fallback persists durable pairing arrays", () => {
  assert.match(identitySource, /JSON\.parse\(storedValue\)/);
  assert.match(identitySource, /globalThis\.localStorage\?\.setItem\(key, JSON\.stringify\(value\)\)/);
  assert.match(identitySource, /globalThis\.localStorage\?\.removeItem\(key\)/);
});

test("extension boots offscreen reconnect polling without opening scanner UI", () => {
  assert.match(wxtConfigSource, /"alarms"/);
  assert.match(wxtConfigSource, /"notifications"/);
  assert.match(backgroundSource, /SCANNER_RECONNECT_ALARM_NAME = "volt\.mobileScanner\.reconnectPoll"/);
  assert.match(backgroundSource, /function ensureScannerReconnectAlarm\(\)/);
  assert.match(backgroundSource, /chrome\.alarms\?\.create\?\.\(SCANNER_RECONNECT_ALARM_NAME/);
  assert.match(backgroundSource, /async function pollScannerReconnectRequests\(reason = "startup"\)/);
  assert.match(backgroundSource, /action: "scannerOffscreenPollReconnectRequests"/);
  assert.match(backgroundSource, /self\.addEventListener\("push"/);
  assert.match(backgroundSource, /event\.waitUntil\(pollScannerReconnectRequests\("push"\)\)/);
  assert.match(backgroundSource, /pollScannerReconnectRequests\("push"\)/);
  assert.match(backgroundSource, /async function getScannerPushSubscriptionOnce\(\)/);
  assert.match(backgroundSource, /pushManager\.subscribe/);
  assert.match(backgroundSource, /case "scannerGetPushSubscription"/);
  assert.match(backgroundSource, /function bootstrapScannerReconnectListener\(reason = "startup"\)/);
  assert.match(backgroundSource, /void ensureScannerOffscreenDocument\(\)\.catch/);
  assert.match(backgroundSource, /bootstrapScannerReconnectListener\("installed"\)/);
  assert.match(backgroundSource, /pollScannerReconnectRequests\("startup"\)/);
  assert.match(backgroundSource, /pollScannerReconnectRequests\("background-main"\)/);
  assert.match(backgroundSource, /chrome\.alarms\?\.onAlarm\?\.addListener/);
  assert.match(backgroundSource, /pollScannerReconnectRequests\("alarm"\)/);
  assert.match(offscreenSource, /scannerOffscreenPollReconnectRequests/);
  assert.match(offscreenSource, /offscreen poll requested/);
  assert.match(sessionSource, /async pollReconnectRequestsNow\(\)/);
  assert.match(identitySource, /async function getMobileScannerPushSubscription\(\)/);
  assert.match(identitySource, /action: "scannerGetPushSubscription"/);
  assert.match(signalClientSource, /pushSubscription: pushSubscription \?\? undefined/);
  assert.match(sessionSource, /reconnect requests fetched/);
  assert.match(sessionSource, /join window posted/);
});

test("extension retries reconnect requests until join-window posting succeeds", () => {
  const answerStart = sessionSource.indexOf("await this.answerReconnectRequest(pairing, request.requestId);");
  const seenStart = sessionSource.indexOf("this.seenReconnectRequests.add(key);", answerStart);
  assert.ok(answerStart > -1);
  assert.ok(seenStart > answerStart);
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
