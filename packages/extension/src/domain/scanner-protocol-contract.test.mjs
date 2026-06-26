import assert from "node:assert/strict";
import test from "node:test";

import {
  PHOTO_TRANSFER_CHANNEL_LABEL,
  SCANNER_CONTROL_CHANNEL_LABEL,
  SCANNER_PROTOCOL_VERSION,
  buildScannerAppClipJoinUrl,
  buildScannerJoinUrl,
  decodePhotoTransferMessage,
  decodeScannerControlMessage,
  encodePhotoTransferMessage,
  encodeScannerControlMessage,
  isScannerProtocolVersionSupported,
  isScannerSessionId,
  scannerControlDuplicateKey,
} from "@volt/scanner-protocol";

const now = "2026-06-03T12:00:00.000Z";
const sessionId = "session_1234";
const contributorId = "device_1234";

const peer = {
  protocolVersion: { major: 1, minor: 0 },
  appVersion: "1.2.3",
  platform: "ios",
  capabilities: ["ocr", "barcode", "dictation", "photo", "photo_retry_queue"],
  contributorId,
  deviceLabel: "Juan's iPhone",
  chromeSessionId: sessionId,
};

function stripUndefined(value) {
  return JSON.parse(JSON.stringify(value));
}

test("scanner protocol owns ADR 0002 channel labels, version, and session validation", () => {
  assert.equal(SCANNER_CONTROL_CHANNEL_LABEL, "scanner-control");
  assert.equal(PHOTO_TRANSFER_CHANNEL_LABEL, "photo-transfer");
  assert.equal(SCANNER_PROTOCOL_VERSION, "1.0.0");
  assert.equal(isScannerProtocolVersionSupported({ major: 1, minor: 0 }), true);
  assert.equal(isScannerProtocolVersionSupported({ major: 2, minor: 0 }), false);
  assert.equal(isScannerSessionId("abc_123-safe"), true);
  assert.equal(isScannerSessionId("../bad"), false);
});

test("scanner protocol builds join-token URLs for full app pairing", () => {
  const token = "abcdefghijklmnopqrstuvwxyzABCDEF";
  const joinAttemptId = "join_attempt_123";
  assert.equal(
    buildScannerJoinUrl({ token, sessionId, joinAttemptId }),
    `volt://pair?token=${token}&sessionId=${sessionId}&joinAttemptId=${joinAttemptId}`,
  );
  assert.equal(
    buildScannerJoinUrl({ token, sessionId, signalUrl: "https://signal.example.test/api/signal" }),
    `volt://pair?token=${token}&sessionId=${sessionId}&signalUrl=https%3A%2F%2Fsignal.example.test%2Fapi%2Fsignal`,
  );
  assert.equal(
    buildScannerAppClipJoinUrl({ token, sessionId, signalUrl: "https://signal.example.test/api/signal" }),
    `https://volt-scanner.vercel.app/create-session?token=${token}&sessionId=${sessionId}&signalUrl=https%3A%2F%2Fsignal.example.test%2Fapi%2Fsignal`,
  );
});

test("scanner protocol validates scanner-control capture messages and dedupe keys", () => {
  const hello = {
    type: "hello",
    messageId: "m1",
    sentAt: now,
    peer,
  };
  assert.deepEqual(stripUndefined(decodeScannerControlMessage(encodeScannerControlMessage(hello))), hello);

  const result = {
    type: "capture_result",
    messageId: "m2",
    sentAt: now,
    resultId: "result_1",
    resultKind: "barcode",
    value: "  ABC-123  ",
    format: "qr",
    capturedAt: now,
    insertIntoCursor: true,
    contributorId,
  };
  assert.deepEqual(stripUndefined(decodeScannerControlMessage(encodeScannerControlMessage(result))), result);
  assert.equal(scannerControlDuplicateKey(result), "capture_result:result_1");
  assert.equal(
    scannerControlDuplicateKey({
      ...result,
      messageId: "m3",
      resultId: "result_2",
    }),
    "capture_result:result_2",
  );
});

test("scanner protocol validates photo-transfer chunk message shapes", () => {
  const start = {
    type: "photo_start",
    messageId: "p1",
    sentAt: now,
    photoId: "photo_1",
    photoBatchId: "batch_1",
    contributorId,
    filename: "listing-001.jpg",
    mimeType: "image/jpeg",
    size: 2048,
    width: 1800,
    height: 1200,
    capturedAt: now,
    chunkSize: 1024,
    totalChunks: 2,
  };
  assert.deepEqual(stripUndefined(decodePhotoTransferMessage(encodePhotoTransferMessage(start))), start);

  const badChunk = {
    type: "photo_chunk",
    messageId: "p2",
    sentAt: now,
    photoId: "photo_1",
    chunkIndex: 2,
    totalChunks: 2,
    data: "ZmFrZQ==",
  };
  assert.equal(decodePhotoTransferMessage(JSON.stringify(badChunk)), null);
});
