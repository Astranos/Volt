import assert from "node:assert/strict";
import test from "node:test";

import {
  chunkPhotoBase64,
  compactPendingPhotos,
  markRetryableAfterDisconnect,
  pendingPhotoSummaries,
} from "./photo-retry-queue.ts";

function photo(overrides = {}) {
  return {
    id: "photo-1",
    batchId: "batch-1",
    name: "volt-photo.jpg",
    mimeType: "image/jpeg",
    dataBase64: "abcdef",
    capturedAt: "2026-06-04T12:00:00.000Z",
    size: 6,
    createdAt: 1_000,
    updatedAt: 1_000,
    totalChunks: 1,
    nextChunkIndex: 0,
    status: "queued",
    progress: 0,
    ...overrides,
  };
}

test("chunkPhotoBase64 keeps chunk indexes stable for WebRTC retry", () => {
  assert.deepEqual(chunkPhotoBase64("abcdef", 2), ["ab", "cd", "ef"]);
});

test("compactPendingPhotos drops 24-hour expired, received, and cancelled photos", () => {
  const day = 24 * 60 * 60 * 1000;
  const compacted = compactPendingPhotos(
    [
      photo({ id: "queued", createdAt: 1_000, status: "queued" }),
      photo({ id: "expired", createdAt: 999, status: "failed" }),
      photo({ id: "received", createdAt: 1_000, status: "received" }),
      photo({ id: "cancelled", createdAt: 1_000, status: "cancelled" }),
    ],
    1_000 + day + 1
  );

  assert.deepEqual(compacted.map((item) => item.id), []);
});

test("pendingPhotoSummaries expose retry queue UI state without payload bytes", () => {
  const summaries = pendingPhotoSummaries([
    photo({ id: "older", createdAt: 1_000, status: "failed", error: "Disconnected" }),
    photo({ id: "newer", createdAt: 2_000, status: "sending", progress: 0.5 }),
    photo({ id: "received", createdAt: 3_000, status: "received" }),
  ]);

  assert.deepEqual(
    summaries.map((item) => item.id),
    ["newer", "older"]
  );
  assert.equal("dataBase64" in summaries[0], false);
  assert.equal(summaries[0].batchId, "batch-1");
  assert.equal(summaries[1].error, "Disconnected");
});

test("markRetryableAfterDisconnect fails sending and sent photos only", () => {
  assert.equal(markRetryableAfterDisconnect(photo({ status: "queued" })).status, "queued");
  assert.equal(markRetryableAfterDisconnect(photo({ status: "sending" })).status, "failed");
  assert.equal(markRetryableAfterDisconnect(photo({ status: "sent" })).status, "failed");
});
