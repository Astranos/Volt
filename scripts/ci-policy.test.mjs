import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

test("Third-party actions are pinned to immutable commits", () => {
  const actions = [...workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([\w.-]+\/[\w.-]+)@(\S+)/gm)]
    .filter(([, name]) => !name.startsWith("actions/"));
  assert.ok(actions.some(([, name]) => name === "ruby/setup-ruby"), "Expected Ruby setup for native CI");
  for (const [, name, revision] of actions) assert.match(revision, /^[a-f0-9]{40}$/, name);
});
