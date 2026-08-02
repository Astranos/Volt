import assert from "node:assert/strict";
import test from "node:test";

import { createComputerRegistrationHeartbeat } from "./computer-registration-heartbeat.ts";

function createManualTimers() {
  let nextId = 1;
  const intervals = new Map();
  const timeouts = new Map();

  return {
    timers: {
      setInterval(callback) {
        const id = nextId++;
        intervals.set(id, callback);
        return id;
      },
      clearInterval(id) {
        intervals.delete(id);
      },
      setTimeout(callback) {
        const id = nextId++;
        timeouts.set(id, callback);
        return id;
      },
      clearTimeout(id) {
        timeouts.delete(id);
      },
    },
    pendingTimeouts() {
      return timeouts.size;
    },
    pendingIntervals() {
      return intervals.size;
    },
    runNextTimeout() {
      const entry = timeouts.entries().next().value;
      assert.ok(entry, "expected a pending timeout");
      const [id, callback] = entry;
      timeouts.delete(id);
      callback();
    },
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

test("a failed registration gets only one retry per heartbeat", async () => {
  const clock = createManualTimers();
  let attempts = 0;
  const heartbeat = createComputerRegistrationHeartbeat({
    attempt: async () => {
      attempts += 1;
      throw new Error("registration rejected");
    },
    intervalMs: 60_000,
    retryDelayMs: 5_000,
    timers: clock.timers,
    onError: () => {},
  });

  heartbeat.start();
  await settle();

  assert.equal(attempts, 1);
  assert.equal(clock.pendingTimeouts(), 1);

  clock.runNextTimeout();
  await settle();

  assert.equal(attempts, 2);
  assert.equal(clock.pendingTimeouts(), 0);
});

test("stopping the heartbeat cancels its interval and pending retry", async () => {
  const clock = createManualTimers();
  const heartbeat = createComputerRegistrationHeartbeat({
    attempt: async () => {
      throw new Error("registration rejected");
    },
    intervalMs: 60_000,
    retryDelayMs: 5_000,
    timers: clock.timers,
    onError: () => {},
  });

  heartbeat.start();
  await settle();
  heartbeat.stop();

  assert.equal(clock.pendingIntervals(), 0);
  assert.equal(clock.pendingTimeouts(), 0);
});
