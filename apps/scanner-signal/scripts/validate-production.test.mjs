import assert from "node:assert/strict";
import test from "node:test";

import { assertAssociationPayload, assertClipFallbackHtml } from "./validate-production.mjs";

test("assertAssociationPayload accepts environment-backed Apple ids", () => {
  assertAssociationPayload(
    {
      applinks: {
        details: [{ appIDs: ["TEAM123456.com.example.mobile"] }],
      },
      appclips: {
        apps: ["TEAM123456.com.example.mobile.Clip"],
      },
    },
    {
      appClipBundleId: "com.example.mobile.Clip",
      fullAppBundleId: "com.example.mobile",
      teamId: "TEAM123456",
    }
  );
});

test("assertAssociationPayload rejects stale hard-coded Apple ids", () => {
  assert.throws(() =>
    assertAssociationPayload(
      {
        applinks: {
          details: [{ appIDs: ["GB5SPLUARQ.com.volt.mobile"] }],
        },
        appclips: {
          apps: ["GB5SPLUARQ.com.volt.mobile.Clip"],
        },
      },
      {
        appClipBundleId: "com.example.mobile.Clip",
        fullAppBundleId: "com.example.mobile",
        teamId: "TEAM123456",
      }
    )
  );
});

test("assertClipFallbackHtml accepts configured App Clip metadata and session", () => {
  assertClipFallbackHtml(
    '<meta name="apple-itunes-app" content="app-clip-bundle-id=com.example.mobile.Clip" /><div>Session test123</div>',
    {
      appClipBundleId: "com.example.mobile.Clip",
      session: "test123",
    }
  );
});
