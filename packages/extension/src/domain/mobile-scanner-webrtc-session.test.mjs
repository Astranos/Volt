import assert from "node:assert/strict";
import test from "node:test";

import {
  SCANNER_CONTROL_CHANNEL_LABEL,
  PHOTO_TRANSFER_CHANNEL_LABEL,
  encodeScannerControlMessage,
  decodeScannerControlMessage,
  encodePhotoTransferMessage,
  decodePhotoTransferMessage,
} from "@volt/scanner-protocol";
import { createScannerOffscreenController } from "../background/scanner-offscreen.ts";

test("extension WebRTC protocol round-trips control and photo-transfer messages", () => {
  assert.equal(SCANNER_CONTROL_CHANNEL_LABEL, "scanner-control");
  assert.equal(PHOTO_TRANSFER_CHANNEL_LABEL, "photo-transfer");

  const now = "2026-06-03T12:00:00.000Z";
  const peer = {
    protocolVersion: { major: 1, minor: 0 },
    appVersion: "1.2.3",
    platform: "ios",
    capabilities: ["ocr", "barcode", "dictation", "photo"],
    contributorId: "phone_1234",
    deviceLabel: "Juan's iPhone",
    chromeSessionId: "session_1234",
  };
  const hello = { type: "hello", messageId: "m1", sentAt: now, peer };
  assert.deepEqual(stripUndefined(decodeScannerControlMessage(encodeScannerControlMessage(hello))), hello);

  const photo = {
    type: "photo_start",
    messageId: "p1",
    sentAt: now,
    photoId: "photo_1",
    photoBatchId: "batch_1",
    contributorId: "phone_1234",
    filename: "listing-001.jpg",
    mimeType: "image/jpeg",
    size: 2048,
    width: 1800,
    height: 1200,
    capturedAt: now,
    chunkSize: 1024,
    totalChunks: 2,
  };
  assert.deepEqual(stripUndefined(decodePhotoTransferMessage(encodePhotoTransferMessage(photo))), photo);
});

function stripUndefined(value) {
  return JSON.parse(JSON.stringify(value));
}

test("extension boots offscreen reconnect polling without opening scanner UI", async () => {
  const messages = [];
  const alarmCreates = [];
  const controller = createScannerOffscreenController({
    chromeApi: {
      runtime: {
        sendMessage: async (message) => {
          messages.push(message);
          if (message.action === "scannerOffscreenPing") return { ready: true };
          return { status: "ok", sessionId: "global-session-reconnect", connectedPeerCount: 0 };
        },
      },
      alarms: {
        create: (name, options) => alarmCreates.push({ name, options }),
      },
    },
    log: () => {},
    createOffscreenDocument: async () => true,
    getOffscreenContexts: async () => [],
    signalUrl: "https://signal.example.test",
    reconnectAlarmName: "volt.mobileScanner.reconnectPoll",
  });

  controller.ensureScannerReconnectAlarm();
  const pollResult = await controller.pollScannerReconnectRequests("startup");

  assert.equal(pollResult, true);
  assert.deepEqual(alarmCreates, [
    {
      name: "volt.mobileScanner.reconnectPoll",
      options: { delayInMinutes: 1, periodInMinutes: 1 },
    },
  ]);
  assert.deepEqual(messages.map((message) => message.action), [
    "scannerOffscreenPing",
    "scannerOffscreenPollReconnectRequests",
  ]);
  assert.equal(messages[1].reason, "startup");
});

test("push events forward reconnect polling through waitUntil", async () => {
  const messages = [];
  const waited = [];
  const controller = createScannerOffscreenController({
    chromeApi: {
      runtime: {
        sendMessage: async (message) => {
          messages.push(message);
          if (message.action === "scannerOffscreenPing") return { ready: true };
          return { status: "ok" };
        },
      },
    },
    log: () => {},
    createOffscreenDocument: async () => true,
    getOffscreenContexts: async () => [],
    signalUrl: "https://signal.example.test",
    reconnectAlarmName: "volt.mobileScanner.reconnectPoll",
  });

  controller.handlePushEvent({
    data: { json: () => ({ type: "scanner-reconnect" }) },
    waitUntil: (promise) => waited.push(promise),
  });
  await Promise.all(waited);

  assert.equal(waited.length, 1);
  assert.equal(messages.at(-1).action, "scannerOffscreenPollReconnectRequests");
  assert.equal(messages.at(-1).reason, "push");
});
