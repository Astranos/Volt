import assert from "node:assert/strict";
import test from "node:test";
import { mergeWorkspaceReplica } from "../cloud-scanner/workspace-results.ts";
import { createWorkspaceStore } from "../cloud-scanner/workspace-store.ts";
import { selectedComputerForIntent } from "../cloud-scanner/live-routing.ts";
import { normalizeWorkspaceSnapshot } from "../cloud-scanner/workspace-snapshot.ts";
import { planWorkspaceHydration, removeAppliedTombstoneOrigins } from "../cloud-scanner/workspace-hydration.ts";

function batch({ revision = 1, state = "available", results = [] } = {}) {
  return {
    id: "batch-1",
    workspaceId: "workspace-1",
    createdAt: "2026-07-12T12:00:00.000Z",
    updatedAt: `2026-07-12T12:00:0${revision}.000Z`,
    revision,
    deliveryState: state,
    results,
  };
}

function result(id, revision, value) {
  return {
    id,
    batchId: "batch-1",
    workspaceId: "workspace-1",
    kind: "barcode",
    capturedAt: "2026-07-12T12:00:00.000Z",
    revision,
    deliveryState: "available",
    value,
  };
}

test("workspace replica merges revisions and dedupes results account-wide", () => {
  const first = mergeWorkspaceReplica(null, {
    workspaceId: "workspace-1",
    batches: [batch({ results: [result("result-1", 1, "old")] })],
    cursor: "cursor-1",
  });
  const merged = mergeWorkspaceReplica(first, {
    workspaceId: "workspace-1",
    batches: [batch({ revision: 2, results: [result("result-1", 2, "new"), result("result-2", 1, "two")] })],
    cursor: "cursor-2",
  });

  assert.equal(merged.batches.length, 1);
  assert.deepEqual(merged.batches[0].results.map(({ id, value }) => [id, value]), [
    ["result-1", "new"],
    ["result-2", "two"],
  ]);
  assert.equal(merged.cursor, "cursor-2");
  assert.equal("computerId" in merged.batches[0], false);
  assert.equal("selectedComputerId" in merged.batches[0], false);
});

test("selected computer is stored separately and cannot change batch ownership", async () => {
  const memory = new Map();
  const store = createWorkspaceStore({
    async get(key) { return memory.get(key); },
    async set(key, value) { memory.set(key, value); },
  });
  await store.mergePage({ workspaceId: "workspace-1", batches: [batch()] });
  await store.setLiveTarget({ workspaceId: "workspace-1", selectedComputerId: "computer-a" });
  await store.setLiveTarget({ workspaceId: "workspace-1", selectedComputerId: "computer-b" });

  assert.equal((await store.getLiveTarget("workspace-1")).selectedComputerId, "computer-b");
  const selection = await store.getLiveTarget("workspace-1");
  assert.equal(selectedComputerForIntent(selection, { kind: "workspaceBatch" }), null);
  assert.equal(selectedComputerForIntent(selection, { kind: "cursorInsertion" }), "computer-b");
  assert.equal(selectedComputerForIntent(selection, { kind: "dictation" }), "computer-b");
  const replica = await store.getReplica("workspace-1");
  assert.equal(replica.batches[0].workspaceId, "workspace-1");
  assert.equal("selectedComputerId" in replica.batches[0], false);
});

test("workspace merge rejects cross-tenant pages", () => {
  assert.throws(
    () => mergeWorkspaceReplica(
      { workspaceId: "workspace-1", batches: [], tombstones: { batches: {}, results: {} } },
      { workspaceId: "workspace-2", batches: [] },
    ),
    /workspace_mismatch/,
  );
});

test("tombstone revisions prevent stale results and batches from resurrecting", () => {
  const initial = mergeWorkspaceReplica(null, {
    workspaceId: "workspace-1",
    batches: [batch({ revision: 1, results: [result("result-1", 1, "original")] })],
  });
  const resultDeleted = mergeWorkspaceReplica(initial, {
    workspaceId: "workspace-1",
    batches: [batch({
      revision: 2,
      results: [{ ...result("result-1", 2, "deleted"), deliveryState: "deleted" }],
    })],
  });
  const staleResultReplay = mergeWorkspaceReplica(resultDeleted, {
    workspaceId: "workspace-1",
    batches: [batch({ revision: 2, results: [result("result-1", 1, "stale")] })],
  });
  assert.deepEqual(staleResultReplay.batches[0].results, []);
  assert.equal(staleResultReplay.tombstones.results["result-1"], 2);

  const batchDeleted = mergeWorkspaceReplica(staleResultReplay, {
    workspaceId: "workspace-1",
    batches: [batch({ revision: 3, state: "deleted" })],
  });
  const staleBatchReplay = mergeWorkspaceReplica(batchDeleted, {
    workspaceId: "workspace-1",
    batches: [batch({ revision: 2, results: [result("result-1", 3, "stale batch")] })],
  });
  assert.deepEqual(staleBatchReplay.batches, []);
  assert.equal(staleBatchReplay.tombstones.batches["batch-1"], 3);
});

test("Convex workspace snapshots normalize into the account-wide replica shape", () => {
  const snapshot = normalizeWorkspaceSnapshot({
    workspaceId: "workspace-1",
    revision: 42,
    batches: [{
      id: "batch-1",
      createdAt: "2026-07-12T12:00:00.000Z",
      updatedAt: "2026-07-12T12:00:01.000Z",
      deliveryState: "ready",
      deliveries: [{ targetDeviceId: "computer-a", state: "delivered", attempts: 1 }],
      results: [{
        id: "photo-1",
        type: "photo",
        photoObjectKey: "private/workspace-1/photo-1",
        contentType: "image/jpeg",
        byteCount: 120,
        createdAt: "2026-07-12T12:00:00.000Z",
      }],
    }],
  });

  assert.equal(snapshot.cursor, "42");
  assert.equal(snapshot.batches[0].workspaceId, "workspace-1");
  assert.equal(snapshot.batches[0].deliveryState, "available");
  assert.equal(snapshot.batches[0].results[0].objectKey, "private/workspace-1/photo-1");
  assert.equal("selectedComputerId" in snapshot.batches[0], false);
});

test("hydration dedupes visible results and applies tombstones only to same-workspace cloud origins", () => {
  const replica = mergeWorkspaceReplica(null, {
    workspaceId: "workspace-1",
    batches: [batch({ results: [result("existing", 1, "one"), result("new", 1, "two")] })],
  });
  replica.tombstones.results.deletedCloud = 3;
  replica.tombstones.results.localCollision = 4;

  const plan = planWorkspaceHydration(
    replica,
    new Set(["existing", "localCollision"]),
    new Set(["deletedCloud"]),
  );
  assert.deepEqual(plan.available.map(({ id }) => id), ["new"]);
  assert.deepEqual(plan.deletedIds, ["deletedCloud"]);
  assert.deepEqual(
    removeAppliedTombstoneOrigins(
      {
        deletedCloud: { workspaceId: "workspace-1", batchId: "batch-1" },
        retained: { workspaceId: "workspace-1", batchId: "batch-2" },
      },
      plan.deletedIds,
    ),
    { retained: { workspaceId: "workspace-1", batchId: "batch-2" } },
  );
});
