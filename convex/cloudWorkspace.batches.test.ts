import { convexTest } from "convex-test";

import { afterEach, describe, expect, test, vi } from "vitest";

import schema from "./schema";
import {
  authorizePhotoAccess,
  createPhotoDownloadUrl,
  createPhotoUploadUrl,
  deleteWorkspaceResults,
  enroll,
  grantFullAppAccess,
  listBatches,
  markBatchReady,
  modules,
  putBatch,
  restoreWorkspaceResults,
  restoreWorkspaceTestEnvironment,
  result,
  workspaceSnapshot,
} from "./cloudWorkspace.testSupport";

afterEach(restoreWorkspaceTestEnvironment);

describe("cloud scanner workspace batches", () => {

  test("isolates account batches even when ids collide", async () => {
    const t = convexTest(schema, modules);
    const alice = await enroll(t, "alice");
    const bob = await enroll(t, "bob");
    await t.mutation(putBatch, {
      ...alice.credential,
      batchId: "same-client-id",
      clientCreatedAt: 1,
      results: [result("alice-result")],
    });
    await t.mutation(putBatch, {
      ...bob.credential,
      batchId: "same-client-id",
      clientCreatedAt: 1,
      results: [result("bob-result")],
    });

    expect((await alice.signedIn.query(listBatches, {})).map((batch) => batch.batchId)).toEqual([
      "same-client-id",
    ]);
    expect((await bob.signedIn.query(listBatches, {})).map((batch) => batch.batchId)).toEqual([
      "same-client-id",
    ]);
    const batches = await t.run((ctx) => ctx.db.query("resultBatches").collect());
    expect(new Set(batches.map((batch) => batch.workspaceId)).size).toBe(2);
  });

  test("appends new results to an existing uploading photo batch", async () => {
    const t = convexTest(schema, modules);
    const { credential } = await enroll(t, "photo-session-user");
    const first = await t.mutation(putBatch, {
      ...credential,
      batchId: "photo-session",
      clientCreatedAt: 1,
      results: [result("photo-1", "photo")],
    });
    expect(first).toMatchObject({ idempotent: false, status: "uploading" });

    const appended = await t.mutation(putBatch, {
      ...credential,
      batchId: "photo-session",
      clientCreatedAt: 2,
      results: [result("photo-1", "photo"), result("photo-2", "photo")],
    });
    expect(appended).toMatchObject({ idempotent: false, status: "uploading" });

    const stored = await t.run(async (ctx) => {
      const batch = await ctx.db.query("resultBatches").unique();
      const results = await ctx.db.query("scanResults").collect();
      return { batch, resultIds: results.map((item) => item.resultId).sort() };
    });
    expect(stored.batch).toMatchObject({
      batchId: "photo-session",
      status: "uploading",
      resultCount: 2,
      byteCount: 20,
    });
    expect(stored.resultIds).toEqual(["photo-1", "photo-2"]);
  });

  test("deduplicates entitled batch retries without a free result cap", async () => {
    const t = convexTest(schema, modules);
    const { credential } = await enroll(t, "subscribed-user");
    const results = Array.from({ length: 101 }, (_, index) =>
      result(`result-${index}`),
    );
    const first = await t.mutation(putBatch, {
      ...credential,
      batchId: "full-free-allowance",
      clientCreatedAt: 1,
      results,
    });
    expect(first.idempotent).toBe(false);
    const retry = await t.mutation(putBatch, {
      ...credential,
      batchId: "full-free-allowance",
      clientCreatedAt: 1,
      results,
    });
    expect(retry.idempotent).toBe(true);
    expect(await t.run((ctx) => ctx.db.query("scanResults").collect())).toHaveLength(101);
  });

  test("authorizes presigns only for the owning workspace and correct batch state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T12:00:00Z"));
    vi.stubEnv("R2_ACCOUNT_ID", "account-id");
    vi.stubEnv("R2_BUCKET", "private-photos");
    vi.stubEnv("R2_ACCESS_KEY_ID", "access-key");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret-key");
    const t = convexTest(schema, modules);
    const alice = await enroll(t, "photo-owner");
    const bob = await enroll(t, "photo-intruder");
    await t.mutation(putBatch, {
      ...alice.credential,
      batchId: "photo-batch",
      clientCreatedAt: 1,
      results: [result("photo-result", "photo")],
    });

    await expect(
      t.query(authorizePhotoAccess, {
        ...bob.credential,
        batchId: "photo-batch",
        resultId: "photo-result",
        operation: "put",
      }),
    ).rejects.toThrow(/Photo not found/);

    const upload = await t.action(createPhotoUploadUrl, {
      ...alice.credential,
      batchId: "photo-batch",
      resultId: "photo-result",
    });
    expect(upload).toMatchObject({ method: "PUT", headers: { "Content-Type": "image/jpeg" } });
    expect(upload.url).toContain("private-photos");
    expect(upload.url).toContain("X-Amz-Signature=");

    await expect(
      t.query(authorizePhotoAccess, {
        ...alice.credential,
        batchId: "photo-batch",
        resultId: "photo-result",
        operation: "get",
      }),
    ).rejects.toThrow(/not ready/);
    await t.mutation(markBatchReady, { ...alice.credential, batchId: "photo-batch" });
    await expect(
      t.query(authorizePhotoAccess, {
        ...alice.credential,
        batchId: "photo-batch",
        resultId: "photo-result",
        operation: "put",
      }),
    ).rejects.toThrow(/no longer allowed/);
    const download = await alice.signedIn.action(createPhotoDownloadUrl, {
      batchId: "photo-batch",
      resultId: "photo-result",
    });
    expect(download.method).toBe("GET");
    await expect(
      bob.signedIn.action(createPhotoDownloadUrl, {
        batchId: "photo-batch",
        resultId: "photo-result",
      }),
    ).rejects.toThrow(/Photo not found/);
  });

  test("tombstones workspace results idempotently without crossing tenants", async () => {
    const t = convexTest(schema, modules);
    const alice = await enroll(t, "delete-alice");
    const bob = await enroll(t, "delete-bob");
    await t.mutation(putBatch, {
      ...alice.credential,
      batchId: "alice-delete-batch",
      clientCreatedAt: 1,
      results: [result("alice-delete-result")],
    });
    await t.mutation(putBatch, {
      ...bob.credential,
      batchId: "bob-delete-batch",
      clientCreatedAt: 1,
      results: [result("bob-delete-result")],
    });

    const first = await alice.signedIn.mutation(deleteWorkspaceResults, {
      resultIds: ["alice-delete-result", "bob-delete-result"],
    });
    expect(first).toMatchObject({
      deletedIds: ["alice-delete-result"],
      newlyDeletedIds: ["alice-delete-result"],
      deleted: 1,
      idempotent: 0,
    });
    const retry = await alice.signedIn.mutation(deleteWorkspaceResults, {
      resultIds: ["alice-delete-result"],
    });
    expect(retry).toMatchObject({
      deletedIds: ["alice-delete-result"],
      newlyDeletedIds: [],
      deleted: 0,
      idempotent: 1,
    });
    expect((await alice.signedIn.query(workspaceSnapshot, {}))!.batches[0].results[0]).toMatchObject({
      id: "alice-delete-result",
      deliveryState: "deleted",
    });
    expect((await bob.signedIn.query(workspaceSnapshot, {}))!.batches[0].results[0]).toMatchObject({
      id: "bob-delete-result",
      deliveryState: "available",
    });

    const restored = await alice.signedIn.mutation(restoreWorkspaceResults, {
      resultIds: ["alice-delete-result", "bob-delete-result"],
    });
    expect(restored).toMatchObject({
      restoredIds: ["alice-delete-result"],
      newlyRestoredIds: ["alice-delete-result"],
      restored: 1,
      idempotent: 0,
    });
    expect((await alice.signedIn.query(workspaceSnapshot, {}))!.batches[0].results[0]).toMatchObject({
      id: "alice-delete-result",
      deliveryState: "available",
    });
    const restoreRetry = await alice.signedIn.mutation(restoreWorkspaceResults, {
      resultIds: ["alice-delete-result"],
    });
    expect(restoreRetry).toMatchObject({
      restoredIds: ["alice-delete-result"],
      newlyRestoredIds: [],
      restored: 0,
      idempotent: 1,
    });
  });

  test("reads an untouched account as an empty snapshot rather than an error", async () => {
    const t = convexTest(schema, modules);
    await grantFullAppAccess(t, "never-captured-anything");
    // Only mutations create the workspace row, so signing in is not enough to
    // make one exist. Throwing here surfaced as "Cloud sync failed" on every
    // account's very first open.
    const newcomer = t.withIdentity({ subject: "never-captured-anything" });

    expect(await newcomer.query(workspaceSnapshot, {})).toBeNull();
  });
});
