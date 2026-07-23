import assert from "node:assert/strict";
import test from "node:test";

import { settleWithin } from "./async-timeout.ts";

test("settleWithin returns completed work", async () => {
  assert.equal(await settleWithin(Promise.resolve("ready"), 25), "ready");
});

test("settleWithin releases callers when work stalls", async () => {
  const startedAt = Date.now();
  const result = await settleWithin(new Promise(() => {}), 10);

  assert.equal(result, null);
  assert.ok(Date.now() - startedAt < 100);
});
