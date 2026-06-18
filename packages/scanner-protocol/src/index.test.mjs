import assert from "node:assert/strict";
import test from "node:test";

import {
  PHOTO_TRANSFER_CHANNEL_LABEL,
  SCANNER_JOIN_TOKEN_TTL_MS,
  SCANNER_PAIRING_TTL_MS,
  SCANNER_CONTROL_CHANNEL_LABEL,
  SCANNER_PROTOCOL_VERSION,
  SCANNER_RECONNECT_REQUEST_TTL_MS,
  buildScannerJoinUrl,
  decodePhotoTransferMessage,
  decodePhotoTransferChunkFrame,
  decodeScannerControlMessage,
  encodePhotoTransferMessage,
  encodePhotoTransferChunkFrame,
  encodeScannerControlMessage,
  isScannerJoinAttemptId,
  isScannerJoinToken,
  isScannerPairingId,
  isScannerProtocolVersionSupported,
  normalizeScannerJoinAttempt,
  normalizeScannerPairing,
  parseScannerJoinUrl,
  publicPendingScannerReconnectRequest,
  publicScannerJoinAttempt,
  publicScannerJoinToken,
  publicScannerReconnectRequest,
  photoTransferDuplicateKey,
  scannerControlDuplicateKey,
} from "./index.ts";

const now = "2026-06-03T12:00:00.000Z";
const token = "abcdefghijklmnopqrstuvwxyzABCDEF";
const sessionId = "session_1234";
const joinAttemptId = "join_attempt_123";
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

test("exports ADR 0002 channel labels and version support", () => {
  assert.equal(SCANNER_CONTROL_CHANNEL_LABEL, "scanner-control");
  assert.equal(PHOTO_TRANSFER_CHANNEL_LABEL, "photo-transfer");
  assert.equal(SCANNER_PROTOCOL_VERSION, "1.0.0");
  assert.equal(SCANNER_JOIN_TOKEN_TTL_MS, 5 * 60 * 1000);
  assert.equal(SCANNER_PAIRING_TTL_MS, 180 * 24 * 60 * 60 * 1000);
  assert.equal(SCANNER_RECONNECT_REQUEST_TTL_MS, 2 * 60 * 1000);
  assert.equal(isScannerProtocolVersionSupported({ major: 1, minor: 0 }), true);
  assert.equal(isScannerProtocolVersionSupported({ major: 2, minor: 0 }), false);
});

test("validates join tokens, join attempt ids, and join URLs", () => {
  assert.equal(isScannerJoinToken(token), true);
  assert.equal(isScannerJoinToken("too-short"), false);
  assert.equal(isScannerJoinAttemptId(joinAttemptId), true);
  assert.equal(isScannerJoinAttemptId("short"), false);

  const url = buildScannerJoinUrl({ token, sessionId, joinAttemptId });
  assert.equal(url, `volt://pair?token=${token}&sessionId=${sessionId}&joinAttemptId=${joinAttemptId}`);
  assert.deepEqual(parseScannerJoinUrl(url), {
    baseUrl: "volt://pair",
    token,
    sessionId,
    joinAttemptId,
  });
  assert.equal(parseScannerJoinUrl("volt://pair?token=bad"), null);
});

test("validates durable pairing ids and exposes signal response DTO helpers", () => {
  assert.equal(isScannerPairingId("pairing_test_12345"), true);
  assert.equal(isScannerPairingId("short"), false);

  const attempt = {
    id: joinAttemptId,
    createdAt: Date.parse(now),
    expiresAt: Date.parse(now) - 1,
    status: "waiting_for_offer",
    contributorId,
    offer: "offer-sdp",
  };
  const expiredAttempt = normalizeScannerJoinAttempt(attempt, Date.parse(now));
  assert.equal(expiredAttempt.status, "expired");
  assert.deepEqual(publicScannerJoinAttempt(expiredAttempt), {
    id: joinAttemptId,
    status: "expired",
    contributorId,
    deviceLabel: undefined,
    protocolVersion: undefined,
    capabilities: undefined,
    createdAt: now,
    expiresAt: "2026-06-03T11:59:59.999Z",
    offeredAt: undefined,
    answeredAt: undefined,
    hasOffer: true,
    hasAnswer: false,
  });

  assert.deepEqual(
    publicScannerJoinToken({
      token,
      sessionId,
      createdAt: Date.parse(now),
      expiresAt: Date.parse(now) + 1000,
      graceExpiresAt: Date.parse(now) + 2000,
      attempts: [attempt],
    }),
    {
      token,
      sessionId,
      expiresAt: "2026-06-03T12:00:01.000Z",
      graceExpiresAt: "2026-06-03T12:00:02.000Z",
      revokedAt: undefined,
      rotatedTo: undefined,
    }
  );

  const pairing = normalizeScannerPairing(
    {
      id: "pairing_test_12345",
      secret: "abcdefghijklmnopqrstuvwxyzABCDEFGH123456",
      browserSessionId: sessionId,
      displayName: "Chrome on Mac",
      phoneDeviceId: "phone_1234",
      createdAt: Date.parse(now),
      lastSeenAt: Date.parse(now),
      expiresAt: Date.parse(now) + 100_000,
      reconnectRequests: [
        {
          id: "request_12345",
          createdAt: Date.parse(now),
          expiresAt: Date.parse(now) + 30_000,
          status: "waiting_for_browser",
        },
      ],
    },
    Date.parse(now)
  );
  assert.equal(pairing.reconnectRequests.length, 1);
  assert.deepEqual(publicScannerReconnectRequest(pairing.reconnectRequests[0]), {
    id: "request_12345",
    status: "waiting_for_browser",
    createdAt: now,
    expiresAt: "2026-06-03T12:00:30.000Z",
    joinUrl: undefined,
    joinToken: undefined,
    sessionId: undefined,
    answeredAt: undefined,
  });
  assert.deepEqual(publicPendingScannerReconnectRequest(pairing, pairing.reconnectRequests[0]), {
    pairingId: "pairing_test_12345",
    requestId: "request_12345",
    browserSessionId: sessionId,
    displayName: "Chrome on Mac",
    phoneDeviceId: "phone_1234",
    phoneLabel: undefined,
    createdAt: now,
    expiresAt: "2026-06-03T12:00:30.000Z",
  });
});

test("round-trips scanner-control messages", () => {
  const hello = {
    type: "hello",
    messageId: "m1",
    sentAt: now,
    peer,
  };

  assert.deepEqual(stripUndefined(decodeScannerControlMessage(encodeScannerControlMessage(hello))), hello);

  const sessionReady = {
    type: "session_ready",
    messageId: "m-ready",
    sentAt: now,
    peer,
    pairing: {
      pairingId: "pairing_test_12345",
      pairingSecret: "abcdefghijklmnopqrstuvwxyzABCDEFGH123456",
      browserSessionId: "session_1234",
      displayName: "Chrome on Mac",
    },
    cursorTarget: {
      tabTitle: "Product Admin",
      url: "https://example.com/products/1",
      label: "SKU",
      hasCursorTarget: true,
    },
  };

  assert.deepEqual(stripUndefined(decodeScannerControlMessage(encodeScannerControlMessage(sessionReady))), sessionReady);

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
  assert.equal(
    scannerControlDuplicateKey(result),
    "capture_result:barcode:qr:abc-123:device_1234"
  );
});

test("rejects unsupported and invalid scanner-control messages", () => {
  const unsupportedMajor = {
    type: "hello",
    messageId: "m1",
    sentAt: now,
    peer: {
      ...peer,
      protocolVersion: { major: 2, minor: 0 },
    },
  };
  assert.equal(decodeScannerControlMessage(JSON.stringify(unsupportedMajor)), null);

  const unknownType = {
    type: "future_critical_message",
    messageId: "m2",
    sentAt: now,
  };
  assert.equal(decodeScannerControlMessage(JSON.stringify(unknownType)), null);

  const badAck = {
    type: "photo_chunk_ack",
    messageId: "m3",
    sentAt: now,
    photoId: "photo_1",
    chunkIndex: 4,
    totalChunks: 4,
  };
  assert.equal(decodeScannerControlMessage(JSON.stringify(badAck)), null);
});

test("round-trips photo-transfer messages and dedupe keys", () => {
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
  assert.equal(photoTransferDuplicateKey(start), "photo_start:photo_1");

  const chunk = {
    type: "photo_chunk",
    messageId: "p2",
    sentAt: now,
    photoId: "photo_1",
    chunkIndex: 1,
    totalChunks: 2,
    data: "ZmFrZS1qcGVnLWJ5dGVz",
  };
  assert.deepEqual(stripUndefined(decodePhotoTransferMessage(encodePhotoTransferMessage(chunk))), chunk);
  assert.equal(photoTransferDuplicateKey(chunk), "photo_chunk:photo_1:1:2");

  const frame = encodePhotoTransferChunkFrame(
    {
      type: "photo_chunk",
      messageId: "p3",
      sentAt: now,
      photoId: "photo_1",
      chunkIndex: 0,
      totalChunks: 2,
    },
    new Uint8Array([1, 2, 3, 4])
  );
  const decodedFrame = decodePhotoTransferChunkFrame(frame);
  assert.equal(decodedFrame?.type, "photo_chunk");
  assert.equal(decodedFrame?.photoId, "photo_1");
  assert.deepEqual([...decodedFrame.data], [1, 2, 3, 4]);
});

test("rejects invalid photo-transfer messages", () => {
  const pngStart = {
    type: "photo_start",
    messageId: "p1",
    sentAt: now,
    photoId: "photo_1",
    photoBatchId: "batch_1",
    contributorId,
    filename: "listing.png",
    mimeType: "image/png",
    size: 2048,
    width: 1800,
    height: 1200,
    capturedAt: now,
    chunkSize: 1024,
    totalChunks: 2,
  };
  assert.equal(decodePhotoTransferMessage(JSON.stringify(pngStart)), null);

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
  assert.equal(decodePhotoTransferChunkFrame(new Uint8Array([0, 0, 0, 99])), null);
});
