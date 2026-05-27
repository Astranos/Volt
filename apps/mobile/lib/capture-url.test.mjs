import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCaptureMode, parseCaptureInvocation } from "./capture-url.ts";

test("parseCaptureInvocation accepts production App Clip URLs", () => {
  assert.deepEqual(parseCaptureInvocation("https://scanner-signal.vercel.app/clip?session=abc_123"), {
    sessionId: "abc_123",
  });
  assert.deepEqual(
    parseCaptureInvocation("https://scanner-signal.vercel.app/clip/ocr?session=abc_123"),
    { mode: "ocr", sessionId: "abc_123" }
  );
  assert.deepEqual(
    parseCaptureInvocation("https://scanner-signal.vercel.app/clip/barcode?session=session-42"),
    { mode: "barcode", sessionId: "session-42" }
  );
});

test("parseCaptureInvocation accepts Apple default App Clip links from QR scans", () => {
  assert.deepEqual(
    parseCaptureInvocation("https://appclip.apple.com/id?p=com.volt.mobile.Clip&mode=barcode&session=session-42"),
    { mode: "barcode", sessionId: "session-42" }
  );
  assert.deepEqual(
    parseCaptureInvocation("https://appclip.apple.com/id?p=com.volt.mobile.Clip&mode=dictation&session=phone_123"),
    { mode: "dictation", sessionId: "phone_123" }
  );
});

test("parseCaptureInvocation accepts custom scheme paths", () => {
  assert.deepEqual(parseCaptureInvocation("volt://clip/dictation?session=phone_123"), {
    mode: "dictation",
    sessionId: "phone_123",
  });
  assert.deepEqual(parseCaptureInvocation("volt://open/clip/barcode?session=phone-123"), {
    mode: "barcode",
    sessionId: "phone-123",
  });
});

test("parseCaptureInvocation rejects invalid or incomplete URLs", () => {
  assert.equal(parseCaptureInvocation("not a url"), null);
  assert.deepEqual(parseCaptureInvocation("https://scanner-signal.vercel.app/clip/photo?session=abcd"), {
    mode: "photo",
    sessionId: "abcd",
  });
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
