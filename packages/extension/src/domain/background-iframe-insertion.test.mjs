import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backgroundSource = readFileSync(
  new URL("../../entrypoints/background.ts", import.meta.url),
  "utf8"
);
const contextMenuSource = readFileSync(
  new URL("../../entrypoints/context-menu.tsx", import.meta.url),
  "utf8"
);
const mobileScannerSource = readFileSync(
  new URL("../components/sidepanel/MobileScanner.tsx", import.meta.url),
  "utf8"
);

test("scanner text insertion targets the tracked iframe when the cursor is inside one", () => {
  assert.match(contextMenuSource, /allFrames: true/);
  assert.match(contextMenuSource, /const target = primeEditableTarget\(\)/);
  assert.match(contextMenuSource, /target,/);
  assert.match(backgroundSource, /updateMobileCaptureTarget\(message\.target, sender\)/);
  assert.match(backgroundSource, /mobileCursorTargetsByTabId\.get\(tab\.id\)/);
  assert.match(backgroundSource, /trackedInsertionTarget\?\.frameId/);
  assert.match(backgroundSource, /frameIds: \[targetFrameId\]/);
  assert.match(backgroundSource, /scanner frame insert fallback/);
});

test("scanner text insertion supports iframe rich text documents", () => {
  assert.match(contextMenuSource, /document\.designMode\?\.toLowerCase\(\) === "on"/);
  assert.match(mobileScannerSource, /document\.designMode\?\.toLowerCase\(\) === "on"/);
  assert.match(backgroundSource, /document\.designMode\?\.toLowerCase\(\) === "on"/);
  assert.match(backgroundSource, /const isRichEditable = \(element\) =>/);
  assert.match(mobileScannerSource, /__voltLastEditableRange/);
});
