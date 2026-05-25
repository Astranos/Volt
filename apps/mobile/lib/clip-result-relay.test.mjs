import assert from "node:assert/strict";
import test from "node:test";

import { makeClipRelayResult, messageForClipRelayStatus } from "./clip-result-relay.ts";
import { makeBarcodeMessage, makeDictationMessage, makeOcrMessage } from "./scanner-messages.ts";

test("makeClipRelayResult wraps barcode messages for the HTTPS result endpoint", () => {
  const message = makeBarcodeMessage("ABC123", "qr");
  const result = makeClipRelayResult("barcode", message);

  assert.equal(result.mode, "barcode");
  assert.equal(result.message, message);
  assert.match(result.id, /^\d+-[a-z0-9]+$/);
});

test("makeClipRelayResult preserves OCR message shape", () => {
  const message = makeOcrMessage("serial number");
  const result = makeClipRelayResult("ocr", message);

  assert.deepEqual(result.message, {
    ...message,
    kind: "text",
    format: "live-text",
    barcode: "serial number",
    insertIntoCursor: true,
  });
});

test("makeClipRelayResult preserves final dictation metadata", () => {
  const message = makeDictationMessage("dictated text", "clip-abc");
  const result = makeClipRelayResult("dictation", message);

  assert.equal(result.message.kind, "text");
  assert.equal(result.message.format, "dictation");
  assert.equal(result.message.dictationPhase, "final");
  assert.equal(result.message.dictationSessionId, "clip-abc");
});

test("messageForClipRelayStatus explains recoverable session failures", () => {
  assert.match(messageForClipRelayStatus(400), /Mobile Scanner QR/);
  assert.match(messageForClipRelayStatus(404), /browser session expired/);
  assert.match(messageForClipRelayStatus(409), /already sent/);
  assert.match(messageForClipRelayStatus(503), /returned 503/);
});
