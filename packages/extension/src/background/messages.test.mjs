import assert from "node:assert/strict";
import test from "node:test";

import {
  isScannerOffscreenRuntimeMessage,
  parseRuntimeMessage,
} from "./messages.ts";

test("offscreen delivery messages are handled by background scanner delivery", () => {
  const scanMessage = parseRuntimeMessage({
    action: "scannerOffscreenScan",
    scan: {
      barcode: "012345678905",
      id: "scan-1",
      kind: "barcode",
      scannedAt: "2026-06-23T00:00:00.000Z",
    },
  });
  const photoMessage = parseRuntimeMessage({
    action: "scannerOffscreenPhoto",
    photo: {
      id: "photo-1",
      kind: "photo",
      name: "photo.jpg",
      mimeType: "image/jpeg",
      size: 100,
    },
  });

  assert.equal(isScannerOffscreenRuntimeMessage(scanMessage), false);
  assert.equal(isScannerOffscreenRuntimeMessage(photoMessage), false);
});

test("background-to-offscreen commands are still ignored by the background listener", () => {
  assert.equal(
    isScannerOffscreenRuntimeMessage(parseRuntimeMessage({ action: "scannerOffscreenGetState" })),
    true
  );
  assert.equal(
    isScannerOffscreenRuntimeMessage(parseRuntimeMessage({ action: "scannerOffscreenUpdateTarget", target: {} })),
    true
  );
});

test("sidepanel close notification preserves its window id", () => {
  assert.deepEqual(parseRuntimeMessage({ action: "sidePanelDidClose", windowId: 42 }), {
    action: "sidePanelDidClose",
    windowId: 42,
  });
});
