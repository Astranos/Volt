import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { fetchWorkspaceSnapshot, type WorkspaceSnapshotPage } from "@volt/scanner-protocol";
import { api } from "./_generated/api";
import schema from "./schema";
import { modules, grantFullAppAccess } from "./cloudWorkspace.testSupport";
import { SNAPSHOT_PAGE_DOCUMENTS, SNAPSHOT_PAGE_READ_BYTES } from "./cloudWorkspace/snapshot";

async function seed(count: number, text = "value") {
  const t = convexTest(schema, modules);
  const user = t.withIdentity({ subject: "alice" });
  await grantFullAppAccess(t, "alice");
  await t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert("workspaces", { ownerClerkUserId: "alice", name: "Alice", createdAt: 1, updatedAt: 1 });
    for (let index = 0; index < count; index++) {
      const batchId = `batch-${index}`;
      await ctx.db.insert("resultBatches", { workspaceId, batchId, sourceDeviceId: "device", clientCreatedAt: index,
        status: "ready", resultCount: 1, byteCount: text.length, createdAt: index, updatedAt: index + 1 });
      await ctx.db.insert("scanResults", { workspaceId, batchId, resultId: `result-${index}`, sourceDeviceId: "device",
        kind: "text", text, byteCount: text.length, clientCreatedAt: index, createdAt: index,
        ...(index % 2 === 0 ? { deletedAt: index + 1 } : {}) });
      await ctx.db.insert("resultDeliveries", { workspaceId, batchId, targetDeviceId: "computer", state: "delivered", attempts: 1, updatedAt: index });
    }
  });
  return { t, user };
}

describe("bounded complete workspace snapshots", () => {
  test("retrieves all batches, results, deliveries and tombstones beyond the old 100-batch window", async () => {
    const { user } = await seed(215);
    let reads = 0;
    const snapshot = await fetchWorkspaceSnapshot(async (args) => {
      reads++;
      const page = await user.query(api.cloudWorkspace.workspaceSnapshotPage, args);
      expect(page?.items.length).toBeLessThanOrEqual(SNAPSHOT_PAGE_DOCUMENTS);
      return page;
    });
    expect(reads).toBeGreaterThanOrEqual(9);
    expect(snapshot?.batches).toHaveLength(215);
    expect(snapshot?.batches.flatMap(batch => batch.results)).toHaveLength(215);
    expect(snapshot?.batches.flatMap(batch => batch.deliveries)).toHaveLength(215);
    expect(snapshot?.batches.flatMap(batch => batch.results).filter(result => result.deliveryState === "deleted")).toHaveLength(108);
    await expect(user.query(api.cloudWorkspace.workspaceSnapshot, {})).rejects.toThrow(/requires pagination/);
  });

  test("byte budget paginates large text even below the document count limit", async () => {
    const text = "x".repeat(90_000);
    const { user } = await seed(12, text);
    const pages: Array<Extract<WorkspaceSnapshotPage, { kind: "results" }>> = [];
    let cursor: string | null = null;
    do {
      const page: WorkspaceSnapshotPage | null = await user.query(api.cloudWorkspace.workspaceSnapshotPage, { kind: "results", cursor });
      if (!page || page.kind !== "results") throw new Error("Expected workspace results");
      expect(page.items.length).toBeLessThanOrEqual(2);
      expect(new TextEncoder().encode(JSON.stringify(page)).byteLength).toBeLessThan(SNAPSHOT_PAGE_READ_BYTES + 100_000);
      pages.push(page);
      cursor = page.isDone ? null : page.continueCursor;
    } while (cursor !== null);
    expect(pages.flatMap(page => page.items)).toHaveLength(12);
    expect(pages.length).toBeGreaterThan(1);
    const snapshot = await fetchWorkspaceSnapshot(args => user.query(api.cloudWorkspace.workspaceSnapshotPage, args));
    expect(snapshot?.batches.flatMap(batch => batch.results).every(result => result.value === text)).toBe(true);
  });

  test("rejects continuation cursors across accounts or streams", async () => {
    const { t, user } = await seed(105);
    const page = await user.query(api.cloudWorkspace.workspaceSnapshotPage, { kind: "results", cursor: null });
    if (!page || page.isDone) throw new Error("Expected a continuation");
    const bob = t.withIdentity({ subject: "bob" });
    await grantFullAppAccess(t, "bob");
    await bob.mutation(api.cloudWorkspace.ensureWorkspace, {});
    await expect(bob.query(api.cloudWorkspace.workspaceSnapshotPage, { kind: "results", cursor: page.continueCursor })).rejects.toThrow(/another workspace/);
    await expect(user.query(api.cloudWorkspace.workspaceSnapshotPage, { kind: "batches", cursor: page.continueCursor })).rejects.toThrow(/another workspace or stream/);
    const empty = await fetchWorkspaceSnapshot(args => bob.query(api.cloudWorkspace.workspaceSnapshotPage, args));
    expect(empty).toMatchObject({ batches: [] });
    expect(empty?.workspaceId).not.toBe(page.workspaceId);
  });

  test("keeps no-workspace null distinct from an existing empty workspace", async () => {
    const t = convexTest(schema, modules);
    const user = t.withIdentity({ subject: "newcomer" });
    await grantFullAppAccess(t, "newcomer");
    expect(await fetchWorkspaceSnapshot(args => user.query(api.cloudWorkspace.workspaceSnapshotPage, args))).toBeNull();
    await user.mutation(api.cloudWorkspace.ensureWorkspace, {});
    expect(await fetchWorkspaceSnapshot(args => user.query(api.cloudWorkspace.workspaceSnapshotPage, args))).toMatchObject({ batches: [] });
    expect(await user.query(api.cloudWorkspace.workspaceSnapshot, {})).toMatchObject({ batches: [] });
  });

  test("HTTP page requests share the bounded query contract and reject malformed selectors", async () => {
    const { user } = await seed(105);
    const response = await user.fetch("/api/workspace/snapshot?kind=results");
    expect(response.status).toBe(200);
    const first = await response.json();
    expect(first.kind).toBe("results");
    expect(first.items).toHaveLength(100);
    expect(first.isDone).toBe(false);
    const continuation = await user.fetch(`/api/workspace/snapshot?kind=results&cursor=${encodeURIComponent(first.continueCursor)}`);
    expect(continuation.status).toBe(200);
    expect((await continuation.json()).items).toHaveLength(5);
    expect((await user.fetch("/api/workspace/snapshot?kind=unknown")).status).toBe(400);
    expect((await user.fetch("/api/workspace/snapshot?cursor=orphaned")).status).toBe(400);
  });
});
