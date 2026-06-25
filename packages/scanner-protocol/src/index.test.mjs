import assert from "node:assert/strict";
import test from "node:test";

import { scannerProtocolGolden } from "./protocol-fixtures.mjs";
import {
  PHOTO_TRANSFER_CHANNEL_LABEL,
  PHOTO_TRANSFER_MESSAGE_TYPES,
  SCANNER_BROWSER_CAPABILITIES,
  SCANNER_CAPABILITIES,
  SCANNER_CONTROL_MESSAGE_TYPES,
  SCANNER_JOIN_TOKEN_TTL_MS,
  SCANNER_MOBILE_CAPABILITIES,
  SCANNER_PAIRING_TTL_MS,
  SCANNER_PEER_PLATFORMS,
  SCANNER_STUN_ONLY_ICE_SERVERS,
  SCANNER_CONTROL_CHANNEL_LABEL,
  SCANNER_PROTOCOL_VERSION,
  SCANNER_RECONNECT_REQUEST_TTL_MS,
  buildScannerIceServersResponse,
  buildScannerJoinUrl,
  CAPTURE_MODES,
  decodePhotoTransferMessage,
  decodePhotoTransferChunkFrame,
  decodeScannerControlMessage,
  encodeBarcodeMessage,
  encodePhotoTransferMessage,
  encodePhotoTransferChunkFrame,
  encodeScannerControlMessage,
  isScannerJoinAttemptId,
  isScannerJoinToken,
  isScannerPairingId,
  isScannerProtocolVersionSupported,
  normalizeScannerJoinAttempt,
  normalizeScannerIceServer,
  normalizeScannerIceServers,
  normalizeScannerPairing,
  parseScannerJoinUrl,
  publicPendingScannerReconnectRequest,
  publicScannerJoinAttempt,
  publicScannerJoinToken,
  publicScannerReconnectRequest,
  photoTransferDuplicateKey,
  scannerControlDuplicateKey,
  scannerStunOnlyIceServersResponse,
} from "./index.ts";

const {
  now,
  token,
  sessionId,
  joinAttemptId,
  contributorId,
  peer,
  pairingId,
  pairingSecret,
  displayName,
  phoneDeviceId,
  photo,
  messages,
} = scannerProtocolGolden;

function stripUndefined(value) {
  return JSON.parse(JSON.stringify(value));
}

test("exports ADR 0002 channel labels and version support", () => {
  assert.equal(SCANNER_CONTROL_CHANNEL_LABEL, scannerProtocolGolden.labels.controlChannel);
  assert.equal(PHOTO_TRANSFER_CHANNEL_LABEL, scannerProtocolGolden.labels.photoTransferChannel);
  assert.equal(SCANNER_PROTOCOL_VERSION, scannerProtocolGolden.protocolVersion.string);
  assert.equal(SCANNER_JOIN_TOKEN_TTL_MS, scannerProtocolGolden.timing.joinTokenTtlMs);
  assert.equal(SCANNER_PAIRING_TTL_MS, scannerProtocolGolden.timing.pairingTtlMs);
  assert.equal(SCANNER_RECONNECT_REQUEST_TTL_MS, scannerProtocolGolden.timing.reconnectRequestTtlMs);
  assert.equal(isScannerProtocolVersionSupported({ major: scannerProtocolGolden.protocolVersion.major, minor: 0 }), true);
  assert.equal(isScannerProtocolVersionSupported({ major: 2, minor: 0 }), false);
});

test("exports the scanner protocol surface used by native drift tests", () => {
  assert.deepEqual(CAPTURE_MODES, scannerProtocolGolden.surface.captureModes);
  assert.deepEqual(SCANNER_PEER_PLATFORMS, scannerProtocolGolden.surface.peerPlatforms);
  assert.deepEqual(SCANNER_CAPABILITIES, scannerProtocolGolden.surface.capabilities);
  assert.deepEqual(SCANNER_MOBILE_CAPABILITIES, scannerProtocolGolden.surface.mobileCapabilities);
  assert.deepEqual(SCANNER_BROWSER_CAPABILITIES, scannerProtocolGolden.surface.browserCapabilities);
  assert.deepEqual(SCANNER_CONTROL_MESSAGE_TYPES, scannerProtocolGolden.surface.controlMessageTypes);
  assert.deepEqual(PHOTO_TRANSFER_MESSAGE_TYPES, scannerProtocolGolden.surface.photoTransferMessageTypes);
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
    signalUrl: undefined,
    token,
    sessionId,
    joinAttemptId,
  });
  const urlWithSignal = buildScannerJoinUrl({
    token,
    sessionId,
    signalUrl: scannerProtocolGolden.urls.signalDev,
  });
  assert.equal(
    urlWithSignal,
    `volt://pair?token=${token}&sessionId=${sessionId}&signalUrl=${encodeURIComponent(scannerProtocolGolden.urls.signalDev)}`,
  );
  assert.equal(parseScannerJoinUrl(urlWithSignal)?.signalUrl, scannerProtocolGolden.urls.signalDev);
  assert.equal(parseScannerJoinUrl("volt://pair?token=bad"), null);
});

test("normalizes scanner ICE server responses", () => {
  const iceServers = normalizeScannerIceServers([
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"],
      username: "temporary-user",
      credential: "temporary-credential",
    },
  ]);

  assert.deepEqual(iceServers, [
    { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
    {
      urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"],
      username: "temporary-user",
      credential: "temporary-credential",
    },
  ]);
  assert.equal(normalizeScannerIceServer({ urls: "turn:turn.cloudflare.com:3478?transport=udp" }), null);
  assert.equal(normalizeScannerIceServers([{ urls: "https://example.com/not-ice" }]), null);

  assert.deepEqual(
    buildScannerIceServersResponse({
      iceServers,
      nowMs: Date.parse(now),
      source: "cloudflare",
      ttlSeconds: 60,
    }),
    {
      iceServers,
      expiresAt: "2026-06-03T12:01:00.000Z",
      ttlSeconds: 60,
      source: "cloudflare",
    }
  );
});

test("builds STUN-only ICE fallback responses", () => {
  assert.deepEqual(
    scannerStunOnlyIceServersResponse({
      iceServers: SCANNER_STUN_ONLY_ICE_SERVERS,
      nowMs: Date.parse(now),
      ttlSeconds: 300,
    }),
    {
      iceServers: SCANNER_STUN_ONLY_ICE_SERVERS,
      expiresAt: "2026-06-03T12:05:00.000Z",
      ttlSeconds: 300,
      source: "stun-fallback",
    }
  );
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
      secret: pairingSecret,
      browserSessionId: sessionId,
      displayName,
      phoneDeviceId,
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
    pairingId,
    requestId: "request_12345",
    browserSessionId: sessionId,
    displayName,
    phoneDeviceId,
    phoneLabel: undefined,
    createdAt: now,
    expiresAt: "2026-06-03T12:00:30.000Z",
  });
});

test("round-trips scanner-control messages", () => {
  const hello = messages.hello;

  assert.deepEqual(stripUndefined(decodeScannerControlMessage(encodeScannerControlMessage(hello))), hello);

  const sessionReady = messages.sessionReady;

  assert.deepEqual(stripUndefined(decodeScannerControlMessage(encodeScannerControlMessage(sessionReady))), sessionReady);

  const result = messages.captureResult;

  assert.deepEqual(stripUndefined(decodeScannerControlMessage(encodeScannerControlMessage(result))), result);
  assert.equal(scannerControlDuplicateKey(result), "capture_result:result_1");
  assert.equal(
    scannerControlDuplicateKey({
      ...result,
      messageId: "m3",
      resultId: "result_2",
    }),
    "capture_result:result_2"
  );

  const barcodeMessage = decodeScannerControlMessage(
    encodeBarcodeMessage({ barcode: " 012345678905 ", format: "ean13" })
  );
  assert.equal(barcodeMessage?.type, "capture_result");
  assert.equal(barcodeMessage?.resultKind, "barcode");
  assert.equal(barcodeMessage?.value, "012345678905");
  assert.equal(barcodeMessage?.format, "ean13");
  assert.equal(barcodeMessage?.insertIntoCursor, true);
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
  const start = photo.start;
  assert.deepEqual(stripUndefined(decodePhotoTransferMessage(encodePhotoTransferMessage(start))), start);
  assert.equal(photoTransferDuplicateKey(start), "photo_start:photo_1");

  const chunk = photo.chunk;
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
