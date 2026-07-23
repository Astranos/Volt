import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applySessionReadyAccessDecision,
  authorizeSessionReady,
} from "./mobile-scanner-access-decision.ts";

test("access denial sends protocol_error before close and never sends session_ready", async () => {
  const actions = [];
  const accepted = await applySessionReadyAccessDecision(
    { allowed: false, error: "Subscribe in the full app" },
    {
      sendProtocolError: (code, receivedType, detail) =>
        actions.push(["protocol_error", code, receivedType, detail]),
      denySession: (detail) => actions.push(["denied", detail]),
      closePeer: () => actions.push(["closed"]),
      sendSessionReady: () => actions.push(["session_ready"]),
    },
  );

  assert.equal(accepted, false);
  assert.deepEqual(actions, [
    ["protocol_error", "access_exhausted", "hello", "Subscribe in the full app"],
    ["denied", "Subscribe in the full app"],
    ["closed"],
  ]);
  assert.equal(actions.some(([action]) => action === "session_ready"), false);
});

test("usage authorization completes before session_ready is sent", async () => {
  const actions = [];
  const accepted = await authorizeSessionReady({
    joinWindow: {
      joinToken: "join-token",
      qrCodeUrl: "https://example.test/pair",
      sessionId: "browser-session",
      usageSessionId: "usage-session",
    },
    authorize: async () => {
      actions.push("authorized");
      return { allowed: true };
    },
    actions: {
      sendProtocolError: () => actions.push("protocol_error"),
      denySession: () => actions.push("denied"),
      closePeer: () => actions.push("closed"),
      sendSessionReady: () => actions.push("session_ready"),
    },
  });
  assert.equal(accepted, true);
  assert.deepEqual(actions, ["authorized", "session_ready"]);
});

test("unexpected disconnect and explicit end use separate server transitions", async () => {
  const source = await readFile(
    new URL("./mobile-scanner-session.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /onSessionDisconnected\?\.\(usageSessionId\)/);
  assert.match(source, /await this\.events\.onSessionEnded\?\.\(usageSessionId\)/);
  assert.match(source, /this\.closePeer\(peer\.id, true\)/);
});
