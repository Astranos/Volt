import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCaptureMode, parseCaptureInvocation } from "./capture-url.ts";

test("parseCaptureInvocation accepts full-app links with all capture modes", () => {
  assert.deepEqual(
    parseCaptureInvocation("volt://pair?mode=barcode&session=session-42"),
    { mode: "barcode", sessionId: "session-42" }
  );
  assert.deepEqual(parseCaptureInvocation("volt://pair?mode=dictation&session=phone_123"), {
    mode: "dictation",
    sessionId: "phone_123",
  });
});

test("parseCaptureInvocation accepts full-app custom scheme paths", () => {
  assert.deepEqual(parseCaptureInvocation("volt://photo?session=phone_123"), {
    mode: "photo",
    sessionId: "phone_123",
  });
});

test("parseCaptureInvocation rejects invalid or incomplete URLs", () => {
  assert.equal(parseCaptureInvocation("not a url"), null);
  assert.equal(parseCaptureInvocation("https://scanner-signal.vercel.app/clip/photo?session=abcd"), null);
  assert.equal(parseCaptureInvocation("https://example.com/photo?mode=barcode&session=session-42"), null);
  assert.equal(parseCaptureInvocation("volt://clip/photo?session=phone_123"), null);
  assert.equal(parseCaptureInvocation("https://scanner-signal.vercel.app/clip/ocr"), null);
  assert.equal(parseCaptureInvocation("https://scanner-signal.vercel.app/clip/ocr?session=%20"), null);
  assert.equal(parseCaptureInvocation("https://scanner-signal.vercel.app/clip/ocr?session=abc"), null);
  assert.equal(
    parseCaptureInvocation(`https://scanner-signal.vercel.app/clip/ocr?session=${"x".repeat(81)}`),
    null
  );
  assert.equal(parseCaptureInvocation("https://scanner-signal.vercel.app/clip/ocr?session=abc<script>"), null);
});

test("normalizeCaptureMode only returns supported capture modes", () => {
  assert.equal(normalizeCaptureMode("ocr"), "ocr");
  assert.equal(normalizeCaptureMode("barcode"), "barcode");
  assert.equal(normalizeCaptureMode("dictation"), "dictation");
  assert.equal(normalizeCaptureMode("photo"), "photo");
  assert.equal(normalizeCaptureMode(undefined), null);
});
