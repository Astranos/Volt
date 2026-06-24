import assert from "node:assert/strict";
import test from "node:test";

import { encodePhotoTransferMessage } from "@volt/scanner-protocol";
import { MobileScannerPhotoReceiver } from "./mobile-scanner-photo-receiver.ts";

const peer = { id: "attempt-photo" };
const sentAt = "2026-06-03T15:00:00.000Z";

test("photo receiver sends photo_received after Chrome stores a completed photo", async () => {
  const controls = [];
  const photos = [];
  const receiver = new MobileScannerPhotoReceiver({
    onPhoto: async (photo) => {
      photos.push(photo);
      return true;
    },
    sendControl: (_peer, message) => controls.push(message),
  });

  await sendOneChunkPhoto(receiver);

  assert.equal(photos.length, 1);
  assert.equal(photos[0].id, "photo_123");
  assert.equal(photos[0].photoBatchId, "batch_123");
  assert.equal(photos[0].dataUrl, "data:image/jpeg;base64,aGVsbG8=");
  assert.equal(controls.some((message) => message.type === "photo_chunk_ack"), true);
  const receipt = controls.find((message) => message.type === "photo_received");
  assert.equal(receipt.photoId, "photo_123");
  assert.equal(receipt.photoBatchId, "batch_123");
});

test("photo receiver sends photo_rejected when Chrome cannot store a completed photo", async () => {
  const controls = [];
  const receiver = new MobileScannerPhotoReceiver({
    onPhoto: async () => false,
    sendControl: (_peer, message) => controls.push(message),
  });

  await sendOneChunkPhoto(receiver);

  const rejection = controls.find((message) => message.type === "photo_rejected");
  assert.equal(rejection.photoId, "photo_123");
  assert.equal(rejection.reason, "storage_full");
  assert.equal(rejection.retryable, true);
});

async function sendOneChunkPhoto(receiver) {
  const base = {
    sentAt,
    photoId: "photo_123",
  };
  await receiver.handlePhotoTransferMessage(peer, encodePhotoTransferMessage({
    ...base,
    type: "photo_start",
    messageId: "photo-start-1",
    photoBatchId: "batch_123",
    contributorId: "volt-photo-123456789012345678901234",
    filename: "photo.jpg",
    mimeType: "image/jpeg",
    size: 5,
    width: 10,
    height: 10,
    capturedAt: sentAt,
    chunkSize: 1024,
    totalChunks: 1,
  }));
  await receiver.handlePhotoTransferMessage(peer, encodePhotoTransferMessage({
    ...base,
    type: "photo_chunk",
    messageId: "photo-chunk-1",
    chunkIndex: 0,
    totalChunks: 1,
    data: "aGVsbG8=",
  }));
  await receiver.handlePhotoTransferMessage(peer, encodePhotoTransferMessage({
    ...base,
    type: "photo_complete",
    messageId: "photo-complete-1",
    totalChunks: 1,
  }));
}
