import assert from "node:assert/strict";
import test from "node:test";

import {
  PHOTO_BATCH_WINDOW_MS,
  groupPhotoResultsByBatch,
  normalizeScannerScanResult,
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

test("photo batch grouping sorts entries inside each batch newest first", () => {
  const groups = groupPhotoResultsByBatch([
    {
      type: "photo",
      id: "old",
      photoBatchId: "batch-1",
      capturedAt: "2026-06-03T15:00:00.000Z",
      photo: { id: "old", kind: "photo", photoBatchId: "batch-1", name: "old.jpg", mimeType: "image/jpeg", size: 1 },
    },
    {
      type: "photo",
      id: "new",
      photoBatchId: "batch-1",
      capturedAt: "2026-06-03T15:01:00.000Z",
      photo: { id: "new", kind: "photo", photoBatchId: "batch-1", name: "new.jpg", mimeType: "image/jpeg", size: 1 },
    },
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].entries.map((entry) => entry.id), ["new", "old"]);
});

