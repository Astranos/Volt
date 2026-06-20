import assert from "node:assert/strict";
import test from "node:test";

import {
  PHOTO_BATCH_WINDOW_MS,
  MOBILE_SCANNER_DELETE_UNDO_WINDOW_MS,
  groupPhotoResultsByBatch,
  normalizeScannerScanResult,
  persistAndBroadcastMobileScannerPhoto,
  resolvePhotoBatchId,
  shouldPersistScannerScan,
} from "./mobile-scanner-results.ts";

test("dictation scanner messages are not persisted", () => {
  assert.equal(
    shouldPersistScannerScan({
      barcode: "hello",
      kind: "text",
      format: "dictation",
    }),
    false,
  );
  assert.equal(
    normalizeScannerScanResult({
      id: "dictation-1",
      barcode: "hello",
      kind: "text",
      format: "dictation",
    }),
    null,
  );
});

test("text and barcode scanner messages normalize to timeline records", () => {
  const result = normalizeScannerScanResult({
    id: "scan-1",
    barcode: "012345678905",
    kind: "barcode",
    scannedAt: "2026-06-03T15:00:00.000Z",
  });

  assert.equal(result?.type, "scan");
  assert.equal(result?.id, "scan-1");
  assert.equal(result?.value, "012345678905");
  assert.equal(result?.capturedAt, "2026-06-03T15:00:00.000Z");
});

test("photo batch ids reuse the active rolling five minute batch", () => {
  const capturedAt = Date.UTC(2026, 5, 3, 15, 0, 0);
  assert.equal(
    resolvePhotoBatchId({
      activeBatch: {
        id: "batch-1",
        lastCapturedAt: capturedAt - PHOTO_BATCH_WINDOW_MS + 1,
      },
      capturedAt,
    }),
    "batch-1",
  );

  const nextBatchId = resolvePhotoBatchId({
    activeBatch: {
      id: "batch-1",
      lastCapturedAt: capturedAt - PHOTO_BATCH_WINDOW_MS - 1,
    },
    capturedAt,
  });
  assert.match(nextBatchId, /^photo-batch-/);
});

test("photo batch grouping preserves upload order inside each batch", () => {
  const groups = groupPhotoResultsByBatch([
    {
      type: "photo",
      id: "first",
      photoBatchId: "batch-1",
      capturedAt: "2026-06-03T15:00:00.000Z",
      photo: { id: "first", kind: "photo", photoBatchId: "batch-1", name: "first.jpg", mimeType: "image/jpeg", size: 1 },
    },
    {
      type: "photo",
      id: "second",
      photoBatchId: "batch-1",
      capturedAt: "2026-06-03T15:01:00.000Z",
      photo: { id: "second", kind: "photo", photoBatchId: "batch-1", name: "second.jpg", mimeType: "image/jpeg", size: 1 },
    },
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].entries.map((entry) => entry.id), ["first", "second"]);
});

test("results model owns the delete undo window used by the sidepanel", () => {
  assert.equal(MOBILE_SCANNER_DELETE_UNDO_WINDOW_MS, 7000);
});

test("browser photo receipt is false when storage fails", async () => {
  const broadcasts = [];
  const receipt = await persistAndBroadcastMobileScannerPhoto(createPhoto(), {
    broadcastScannerMessage: (message) => broadcasts.push(message),
    savePhoto: async () => null,
    persistFallbackPhoto: async () => false,
  });

  assert.deepEqual(receipt, { success: false, error: "storage_failed" });
  assert.deepEqual(broadcasts, []);
});

test("browser photo receipt is true only after storage succeeds and then broadcasts", async () => {
  const broadcasts = [];
  const photo = createPhoto();
  const savedResult = {
    type: "photo",
    id: photo.id,
    photoBatchId: "batch-1",
    capturedAt: photo.capturedAt,
    photo: { ...photo, photoBatchId: "batch-1" },
  };

  const receipt = await persistAndBroadcastMobileScannerPhoto(photo, {
    broadcastScannerMessage: (message) => broadcasts.push(message),
    savePhoto: async () => savedResult,
  });

  assert.deepEqual(receipt, { success: true, result: savedResult });
  assert.equal(broadcasts.length, 1);
  assert.equal(broadcasts[0].action, "scannerPhoto");
  assert.equal(broadcasts[0].result, savedResult);
  assert.equal(broadcasts[0].photo.id, photo.id);
});

function createPhoto() {
  return {
    id: "photo-1",
    kind: "photo",
    name: "photo.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,ZmFrZQ==",
    size: 4,
    capturedAt: "2026-06-03T15:00:00.000Z",
  };
}
