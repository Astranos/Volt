import assert from "node:assert/strict";
import test from "node:test";

import { shouldInsertScannerMessage } from "./scanner-message.ts";

test("shouldInsertScannerMessage honors explicit App Clip cursor insertion flags", () => {
  assert.equal(
    shouldInsertScannerMessage({
      barcode: "012345678905",
      format: "ean-13",
      insertIntoCursor: true,
      kind: "barcode",
    }),
    true
  );

  assert.equal(
    shouldInsertScannerMessage({
      barcode: "012345678905",
      format: "ean-13",
      insertIntoCursor: false,
      kind: "barcode",
    }),
    false
  );
});

test("shouldInsertScannerMessage preserves dictation fallback behavior", () => {
  assert.equal(
    shouldInsertScannerMessage({
      barcode: "final words",
      format: "dictation",
      kind: "text",
    }),
    true
  );
});

test("shouldInsertScannerMessage does not insert ordinary scans without an explicit flag", () => {
  assert.equal(
    shouldInsertScannerMessage({
      barcode: "012345678905",
      format: "ean-13",
      kind: "barcode",
    }),
    false
  );
});
