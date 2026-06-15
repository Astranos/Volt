import assert from "node:assert/strict";
import test from "node:test";

import { assertAssociationPayload } from "./validate-production.mjs";

test("assertAssociationPayload accepts signaling-only Apple association payloads", () => {
  assertAssociationPayload({
    applinks: {
      apps: [],
      details: [],
    },
  });
});

test("assertAssociationPayload rejects appclips associations", () => {
  assert.throws(() =>
    assertAssociationPayload({
      applinks: {
        apps: [],
        details: [],
      },
      appclips: {
        apps: ["TEAM123456.com.example.mobile.Scanner"],
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
    })
  );
});
