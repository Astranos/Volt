import assert from "node:assert/strict";
import test from "node:test";

import {
  USAGE_RECONNECT_WINDOW_MS,
  USAGE_SESSION_MAX_MS,
  canReuseUsageSession,
  connectedUsageSession,
  getOrCreateUsageSession,
} from "./usage-session.ts";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");

test("reconnects before thirty minutes reuse the work-session id", () => {
  const current = {
    usageSessionId: "usage-existing",
    createdAt: NOW - 60_000,
    startedAt: NOW - 60_000,
    disconnectedAt: NOW - USAGE_RECONNECT_WINDOW_MS + 1,
  };

  assert.equal(canReuseUsageSession(current, NOW), true);
  assert.equal(
    getOrCreateUsageSession(current, () => "usage-new", NOW),
    current,
  );
});
test("the thirty-minute boundary starts a new work-session id", () => {
  const current = {
    usageSessionId: "usage-existing",
    createdAt: NOW - USAGE_RECONNECT_WINDOW_MS,
    disconnectedAt: NOW - USAGE_RECONNECT_WINDOW_MS,
  };

  assert.deepEqual(
    getOrCreateUsageSession(current, () => "usage-new", NOW),
    { usageSessionId: "usage-new", createdAt: NOW },
  );
});

test("the eight-hour hard limit prevents client-side reuse", () => {
  const current = {
    usageSessionId: "usage-existing",
    createdAt: NOW - USAGE_SESSION_MAX_MS,
    startedAt: NOW - USAGE_SESSION_MAX_MS,
  };
  assert.equal(canReuseUsageSession(current, NOW), false);
});

test("server session timing controls the hard-stop deadline", () => {
  const connected = connectedUsageSession(
    { usageSessionId: "usage-1", createdAt: NOW - 5_000 },
    { startedAt: NOW, maxEndsAt: NOW + 10_000 },
    NOW,
  );
  assert.equal(connected.startedAt, NOW);
  assert.equal(connected.maxEndsAt, NOW + 10_000);
  assert.equal(connected.disconnectedAt, undefined);
});
