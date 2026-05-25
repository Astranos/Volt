import assert from "node:assert/strict";
import test from "node:test";

import { makeBarcodeMessage, makeDictationMessage, makeOcrMessage } from "./scanner-messages.ts";

test("makeBarcodeMessage builds cursor-insertion barcode payloads", () => {
  const message = makeBarcodeMessage(" 012345678905 ", "ean13");

  assert.equal(message.kind, "barcode");
  assert.equal(message.format, "ean13");
  assert.equal(message.barcode, "012345678905");
  assert.equal(message.insertIntoCursor, true);
  assert.match(message.id, /^\d+-[a-z0-9]+$/);
  assert.ok(Date.parse(message.scannedAt));
});

test("makeOcrMessage builds live-text payloads", () => {
  const message = makeOcrMessage(" Shelf label  ");

  assert.equal(message.kind, "text");
  assert.equal(message.format, "live-text");
  assert.equal(message.barcode, "Shelf label");
  assert.equal(message.insertIntoCursor, true);
});

test("makeDictationMessage builds final transcript payloads", () => {
  const message = makeDictationMessage(" Final words ", "clip-session");

  assert.equal(message.kind, "text");
  assert.equal(message.format, "dictation");
  assert.equal(message.barcode, "Final words");
  assert.equal(message.dictationPhase, "final");
  assert.equal(message.dictationSessionId, "clip-session");
  assert.equal(message.insertIntoCursor, true);
});

