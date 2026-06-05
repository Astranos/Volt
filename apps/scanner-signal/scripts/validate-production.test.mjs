import assert from "node:assert/strict";
import test from "node:test";

import { assertAssociationPayload, assertClipObsoleteResponse } from "./validate-production.mjs";

test("assertAssociationPayload accepts signaling-only Apple association payloads", () => {
  assertAssociationPayload({
    applinks: {
      apps: [],
      details: [],
    },
    appclips: {
      apps: [],
    },
  });
});

test("assertAssociationPayload rejects App Clip associations", () => {
  assert.throws(() =>
    assertAssociationPayload({
      applinks: {
        apps: [],
        details: [],
      },
      appclips: {
        apps: ["TEAM123456.com.example.mobile.Clip"],
      },
    })
  );
});

test("assertAssociationPayload rejects /clip links assigned to the full app", () => {
  assert.throws(() =>
    assertAssociationPayload({
      applinks: {
        apps: [],
        details: [{ appIDs: ["TEAM123456.com.example.mobile"], components: [{ "/": "/clip/*" }] }],
      },
      appclips: {
        apps: [],
      },
    })
  );
});

test("assertClipObsoleteResponse accepts the obsolete scanner response", () => {
  assertClipObsoleteResponse(
    { status: 410 },
    "Volt App Clip scanner links are obsolete. Pair the full mobile app from the Chrome extension QR code."
  );
});
