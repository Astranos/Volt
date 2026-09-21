import assert from "node:assert/strict";
import test from "node:test";
import { testPlan } from "./run-tests.mjs";

test("discovers nested tests and sends each file to exactly one runner", () => {
  const files = [
    "packages/extension/src/components/tool.test.mjs",
    "packages/extension/src/agent/decision.test.ts",
    "apps/web/src/routes/-demo.test.ts",
    "apps/kiosk/server/catalog.test.ts",
    "apps/mobile/tests/capture.test.mjs",
    "scripts/run-tests.test.mjs",
    "packages/new-package/deep/feature.spec.tsx",
    "packages/extension/src/components/tool.test.mjs",
    ".agents/skills/example.test.ts",
    "apps/web/src/example.ts",
  ];
  const plan = testPlan(files);
  assert.equal(plan.node.length, 3);
  assert.equal(plan.vitest.length, 4);
  assert.ok(plan.node.every((file) => file.endsWith(".mjs")));
  assert.ok(plan.vitest.every((file) => !file.endsWith(".mjs")));
  assert.equal(new Set([...plan.node, ...plan.vitest]).size, 7);
});

test("focused scopes include new directories without widening to other apps", () => {
  assert.deepEqual(testPlan([
    "apps/web/src/routes/-demo.test.ts", "scripts/pwa.test.mjs",
    "apps/kiosk/src/browse.test.ts",
  ], "web"), {
    node: ["scripts/pwa.test.mjs"], vitest: ["apps/web/src/routes/-demo.test.ts"],
  });
});

test("unknown scopes and unsupported test formats fail instead of silently skipping", () => {
  assert.throws(() => testPlan([], "typo"), /Unknown test scope/);
  assert.throws(() => testPlan(["apps/web/new.test.cts"]), /No test runner/);
});
