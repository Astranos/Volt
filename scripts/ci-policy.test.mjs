import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Ruby setup is pinned to an immutable commit", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const actions = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*ruby\/setup-ruby@(\S+)/gm)];
  assert.ok(actions.length > 0, "Expected Ruby setup for native CI");
  for (const [, revision] of actions) assert.match(revision, /^[a-f0-9]{40}$/);
});
