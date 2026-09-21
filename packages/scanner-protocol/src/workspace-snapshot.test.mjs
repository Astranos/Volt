import assert from "node:assert/strict";
import test from "node:test";
import { fetchWorkspaceSnapshot, mergeWorkspaceSnapshotPages, subscribeWorkspaceSnapshot } from "./workspace-snapshot.ts";

const batch = (id) => ({ id, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", deliveryState: "available" });
const result = (id, deliveryState = "available") => ({ id, batchId: "batch", type: "text", deliveryState, value: id, byteCount: 1, createdAt: "2026-01-01T00:00:00Z" });
const page = (kind, items = [], more = null, workspaceId = "alice") => ({ kind, items, workspaceId, revision: 1, isDone: more === null, continueCursor: more ?? "done" });

function harness() {
  const subscriptions = [];
  const snapshots = [];
  const errors = [];
  const stop = subscribeWorkspaceSnapshot({
    subscribe: (args, onValue, onError) => {
      const subscription = { args, onValue, onError, stopped: false };
      subscriptions.push(subscription);
      return () => { subscription.stopped = true; };
    },
    onSnapshot: value => snapshots.push(value),
    onError: error => errors.push(error),
  });
  const get = (kind, cursor = null) => subscriptions.findLast(s => s.args.kind === kind && s.args.cursor === cursor && !s.stopped);
  return { subscriptions, snapshots, errors, stop, get };
}

test("reactive controller waits for complete streams and retains tombstones and old history", () => {
  const h = harness();
  h.get("batches").onValue(page("batches", [batch("batch")], "older-batches"));
  h.get("results").onValue(page("results", [result("new")], "older-results"));
  h.get("deliveries").onValue(page("deliveries"));
  h.get("batches", "older-batches").onValue(page("batches", [batch("old-batch")]));
  assert.equal(h.snapshots.length, 0, "partial pages must not become a complete snapshot");
  const tail = h.get("results", "older-results");
  tail.onValue(page("results", [result("deleted", "deleted")]));
  assert.equal(h.snapshots.at(-1).batches.length, 2);
  assert.equal(h.snapshots.at(-1).batches[0].results[1].deliveryState, "deleted");
  tail.onValue(page("results", [result("deleted", "available")]));
  assert.equal(h.snapshots.at(-1).batches[0].results[1].deliveryState, "available", "old pages remain reactive for restores");
  h.stop();
  assert.ok(h.subscriptions.every(s => s.stopped));
});

test("changed page boundaries replace descendants and late callbacks cannot republish", () => {
  const h = harness();
  h.get("batches").onValue(page("batches", [batch("batch")]));
  h.get("deliveries").onValue(page("deliveries"));
  const root = h.get("results");
  root.onValue(page("results", [result("one")], "old-boundary"));
  const oldTail = h.get("results", "old-boundary");
  oldTail.onValue(page("results", [result("two")]));
  const count = h.snapshots.length;
  root.onValue(page("results", [result("zero")], "new-boundary"));
  assert.equal(oldTail.stopped, true);
  oldTail.onValue(page("results", [result("wrong-account")]));
  assert.equal(h.snapshots.length, count);
  h.get("results", "new-boundary").onValue(page("results", [result("one"), result("two")]));
  assert.deepEqual(h.snapshots.at(-1).batches[0].results.map(r => r.id), ["zero", "one", "two"]);
  h.stop();
  const finalCount = h.snapshots.length;
  root.onValue(page("results", [result("stale")]));
  root.onError(new Error("stale auth"));
  assert.equal(h.snapshots.length, finalCount);
  assert.equal(h.errors.length, 0);
});

test("account transitions never publish mixed-workspace streams", () => {
  const h = harness();
  h.get("batches").onValue(page("batches", [batch("batch")]));
  h.get("results").onValue(page("results", [result("alice-value")]));
  h.get("deliveries").onValue(page("deliveries"));
  const count = h.snapshots.length;
  h.get("batches").onValue(page("batches", [], null, "bob"));
  assert.equal(h.snapshots.length, count);
  h.get("results").onValue(page("results", [], null, "bob"));
  assert.equal(h.snapshots.length, count);
  h.get("deliveries").onValue(page("deliveries", [], null, "bob"));
  assert.deepEqual(h.snapshots.at(-1), { workspaceId: "bob", revision: 1, batches: [] });
  h.stop();
});

test("subscription errors are reported, not converted to an empty successful snapshot", () => {
  const h = harness();
  const error = new Error("auth expired");
  h.get("results").onError(error);
  h.get("batches").onValue(page("batches", [batch("batch")]));
  h.get("deliveries").onValue(page("deliveries"));
  assert.deepEqual(h.errors, [error]);
  assert.deepEqual(h.snapshots, []);
  h.get("results").onValue(page("results", [result("recovered")]));
  assert.equal(h.snapshots.at(-1).batches[0].results[0].id, "recovered");
  h.stop();
});

test("fetch drains every cursor and rejects loops or cross-account pages", async () => {
  const calls = [];
  const snapshot = await fetchWorkspaceSnapshot(async args => {
    calls.push(args);
    if (args.kind === "batches") return page("batches", [batch("batch")]);
    if (args.kind === "deliveries") return page("deliveries");
    return args.cursor === null ? page("results", [result("one")], "two") : page("results", [result("two", "deleted")]);
  });
  assert.equal(calls.length, 4);
  assert.equal(snapshot.batches[0].results.length, 2);
  await assert.rejects(fetchWorkspaceSnapshot(async args => page(args.kind, [], "loop")), /did not advance/);
  assert.throws(() => mergeWorkspaceSnapshotPages([page("batches"), page("results", [], null, "bob")]), /Workspace changed/);
});
