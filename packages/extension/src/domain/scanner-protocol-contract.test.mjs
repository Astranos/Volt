import assert from "node:assert/strict";
import test from "node:test";

import {
  createScannerMessageDuplicateGuard,
  isAppClipCaptureMode,
  isScannerSessionId,
  parseScannerRelayResult,
  parseSessionTarget,
} from "../../../scanner-protocol/src/index.ts";

test("scanner protocol owns session id and mode validation", () => {
  assert.equal(isScannerSessionId("abc_123-safe"), true);
  assert.equal(isScannerSessionId("../bad"), false);
  assert.equal(isAppClipCaptureMode("photo"), true);
  assert.equal(isAppClipCaptureMode("dictation"), false);
});

test("scanner protocol parses relay results by capture mode", () => {
  assert.deepEqual(
    parseScannerRelayResult(
      {
        id: "result-1",
        mode: "ocr",
        message: {
          barcode: "hello",
          format: "live-text",
          kind: "text",
        },
      },
      "2026-05-27T00:00:00.000Z"
    ),
    {
      id: "result-1",
      mode: "ocr",
      message: {
        barcode: "hello",
        dictationPhase: undefined,
        dictationSessionId: undefined,
        format: "live-text",
        insertIntoCursor: undefined,
        kind: "text",
        scannedAt: undefined,
      },
      createdAt: "2026-05-27T00:00:00.000Z",
    }
  );

  assert.equal(
    parseScannerRelayResult({
      id: "bad",
      mode: "barcode",
      message: { barcode: "hello", format: "live-text", kind: "text" },
    }),
    null
  );
});

test("scanner protocol parses and clamps session target metadata", () => {
  assert.deepEqual(parseSessionTarget({ browser: " Chrome ", cursor: " field " }), {
    browser: "Chrome",
    cursor: "field",
    tabTitle: undefined,
    url: undefined,
  });
});

test("scanner protocol duplicate guard centralizes scan de-duping", () => {
  let now = 1000;
  const shouldAccept = createScannerMessageDuplicateGuard(1500, 2500, () => now);
  const message = { barcode: " ABC ", format: "QR", kind: "barcode" };

  assert.equal(shouldAccept(message), true);
  assert.equal(shouldAccept(message), false);
  now += 1600;
  assert.equal(shouldAccept(message), true);
});
