import assert from "node:assert/strict";
import test from "node:test";

import {
  MOBILE_SCANNER_STORAGE_KEY,
  createCursorTargetedCaptureDelivery,
} from "../background/mobile-capture-delivery.ts";

test("cursor targeted capture delivery inserts dictation and returns the offscreen receipt", async () => {
  const insertions = [];
  const broadcasts = [];
  const delivery = createCursorTargetedCaptureDelivery({
    chromeApi: createChromeApi(),
    log: () => {},
    broadcastScannerMessage: (message) => broadcasts.push(message),
    insertScannerText: async (text, options) => {
      insertions.push({ text, options });
      return true;
    },
  });

  const receipt = await delivery.deliverScannerScan({
    id: "dictation-1",
    barcode: "hello world",
    dictationPhase: "final",
    dictationSessionId: "session-1",
    format: "dictation",
    kind: "text",
    scannedAt: "2026-06-03T15:00:00.000Z",
  });

  assert.deepEqual(receipt, { success: true, insertedIntoCursor: true });
  assert.deepEqual(insertions, [
    {
      text: "hello world",
      options: {
        dictationPhase: "final",
        dictationSessionId: "session-1",
        format: "dictation",
        kind: "text",
      },
    },
  ]);
  assert.deepEqual(broadcasts, []);
});

test("cursor targeted capture delivery persists and broadcasts barcodes without cursor insertion", async () => {
  const storageWrites = [];
  const broadcasts = [];
  const logs = [];
  const delivery = createCursorTargetedCaptureDelivery({
    chromeApi: createChromeApi({ storageWrites }),
    log: (...args) => logs.push(args),
    broadcastScannerMessage: (message) => broadcasts.push(message),
    insertScannerText: async () => {
      throw new Error("barcode should not insert into cursor");
    },
  });
  const scan = {
    id: "scan-1",
    barcode: "012345678905",
    kind: "barcode",
    scannedAt: "2026-06-03T15:00:00.000Z",
  };

  const receipt = await delivery.deliverScannerScan(scan);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(receipt, { success: true, insertedIntoCursor: false });
  assert.deepEqual(broadcasts, [{ action: "scannerScan", scan, result: undefined }]);
  assert.equal(logs[0][0], "scanner IndexedDB scan persist failed");
  assert.deepEqual(storageWrites, [{ [MOBILE_SCANNER_STORAGE_KEY]: [scan] }]);
});

test("cursor targeted capture delivery reports unsaved when primary and fallback storage fail", async () => {
  const broadcasts = [];
  const delivery = createCursorTargetedCaptureDelivery({
    chromeApi: createChromeApi({ storageFails: true }),
    log: () => {},
    broadcastScannerMessage: (message) => broadcasts.push(message),
    insertScannerText: async () => false,
  });

  const receipt = await delivery.deliverScannerScan({
    id: "scan-unsaved",
    barcode: "012345678905",
    kind: "barcode",
    scannedAt: "2026-06-03T15:00:00.000Z",
  });

  assert.deepEqual(receipt, { success: false, insertedIntoCursor: false });
  assert.deepEqual(broadcasts, []);
});

function createChromeApi({ storageWrites = [], storageFails = false } = {}) {
  const runtime = {};
  return {
    runtime,
    storage: {
      local: {
        get(defaults, callback) {
          callback(defaults);
        },
        set(value, callback) {
          storageWrites.push(value);
          runtime.lastError = storageFails ? { message: "storage failed" } : undefined;
          callback?.();
          runtime.lastError = undefined;
        },
      },
    },
  };
}
