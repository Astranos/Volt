import assert from "node:assert/strict";
import test from "node:test";

import { barcodeCandidateKey, createBarcodeCandidateGuard } from "./barcode-candidate-guard.ts";

test("barcodeCandidateKey normalizes format and value", () => {
  assert.equal(
    barcodeCandidateKey({ format: " QR ", value: " ABC-123 " }),
    "qr:abc-123"
  );
});

test("createBarcodeCandidateGuard rejects repeated candidates inside the duplicate window", () => {
  let now = 1000;
  const shouldAccept = createBarcodeCandidateGuard(1500, () => now);

  assert.equal(shouldAccept({ format: "ean13", value: "012345678905" }), true);
  now += 200;
  assert.equal(shouldAccept({ format: "ean13", value: "012345678905" }), false);
  now += 1500;
  assert.equal(shouldAccept({ format: "ean13", value: "012345678905" }), true);
});

test("createBarcodeCandidateGuard treats different values and formats independently", () => {
  let now = 2000;
  const shouldAccept = createBarcodeCandidateGuard(1500, () => now);

  assert.equal(shouldAccept({ format: "ean13", value: "012345678905" }), true);
  assert.equal(shouldAccept({ format: "ean13", value: "999999999999" }), true);
  assert.equal(shouldAccept({ format: "qr", value: "012345678905" }), true);
});
