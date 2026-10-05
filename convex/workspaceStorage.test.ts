import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import { api } from "./_generated/api";
import schema from "./schema";
import {
  modules,
  result,
  grantFullAppAccess,
  markBatchReady,
  authorizePhotoAccess,
} from "./cloudWorkspace.testSupport";

const DAY = 24 * 60 * 60 * 1000;
const sweep = makeFunctionReference<"mutation", Record<string, never>, number>(
  "workspaceStorage:sweepRetention",
);
const purge = makeFunctionReference<
  "action",
  Record<string, never>,
  { purged: number; failed: number }
>("workspaceStorage:purgeExpiredObjects");
const usage = makeFunctionReference<
  "query",
  Record<string, never>,
  {
    enabled: boolean;
    tier: string;
    access: string;
    recordsUsed: number;
    bytesUsed: number;
    recordsLimit: number;
    bytesLimit: number;
  }
>("workspaceStorage:getUsage");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  vi.stubEnv("WORKSPACE_STORAGE_POLICY_ENABLED", "true");
  vi.stubEnv("R2_ACCOUNT_ID", "test-account");
  vi.stubEnv("R2_BUCKET", "test-bucket");
  vi.stubEnv("R2_ACCESS_KEY_ID", "test-key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "test-secret");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function owner(t: ReturnType<typeof convexTest>, user = "owner") {
  const signedIn = t.withIdentity({ subject: user });
  const issued = await signedIn.mutation(
    api.cloudWorkspace.bootstrapMobileDevice,
    { installationId: `${user}-phone`, label: "Phone" },
  );
  return {
    signedIn,
    credential: {
      deviceId: issued.deviceId,
      deviceSecret: issued.deviceSecret,
    },
    workspaceId: issued.workspaceId,
  };
}
async function capture(
  t: ReturnType<typeof convexTest>,
  credential: { deviceId: string; deviceSecret: string },
  id = "one",
  kind: "text" | "photo" = "text",
) {
  return t.mutation(api.cloudWorkspace.putBatch, {
    ...credential,
    batchId: id,
    clientCreatedAt: 1,
    results: [result(id, kind)],
  });
}

test("free writes use server UTF-8 bytes and retries do not reserve twice", async () => {
  const t = convexTest(schema, modules);
  const { signedIn, credential } = await owner(t);
  const args = {
    ...credential,
    batchId: "unicode",
    clientCreatedAt: 1,
    results: [{ ...result("unicode"), text: "é🙂", byteCount: -500 }],
  };
  await t.mutation(api.cloudWorkspace.putBatch, args);
  expect(await t.mutation(api.cloudWorkspace.putBatch, args)).toMatchObject({
    idempotent: true,
  });
  expect(await signedIn.query(usage, {})).toMatchObject({
    enabled: true,
    tier: "free",
    recordsUsed: 1,
    bytesUsed: 6,
  });
  expect(
    await t.run((ctx) => ctx.db.query("scanResults").unique()),
  ).toMatchObject({
    storageManaged: true,
    retentionTier: "free",
    byteCount: 6,
    expiresAt: Date.now() + 7 * DAY,
  });
});

test("free records expire after seven days; expired rows cannot restore or finalize", async () => {
  const t = convexTest(schema, modules);
  const { signedIn, credential } = await owner(t);
  await capture(t, credential);
  vi.setSystemTime(Date.now() + 7 * DAY);
  await expect(
    signedIn.mutation(api.cloudWorkspace.restoreWorkspaceResults, {
      resultIds: ["one"],
    }),
  ).rejects.toThrow(/Expired/);
  await expect(
    t.mutation(markBatchReady, { ...credential, batchId: "one" }),
  ).rejects.toThrow(/expired/);
  expect(await t.mutation(sweep, {})).toBe(1);
  expect(await signedIn.query(usage, {})).toMatchObject({
    recordsUsed: 0,
    bytesUsed: 3,
  });
  await grantFullAppAccess(t, "owner");
  await expect(
    signedIn.mutation(api.cloudWorkspace.restoreWorkspaceResults, {
      resultIds: ["one"],
    }),
  ).rejects.toThrow(/Expired/);
});

test("legacy results stay protected and disabling rollout keeps new results unmanaged", async () => {
  const t = convexTest(schema, modules);
  const { credential } = await owner(t);
  vi.stubEnv("WORKSPACE_STORAGE_POLICY_ENABLED", "false");
  await capture(t, credential, "legacy");
  vi.stubEnv("WORKSPACE_STORAGE_POLICY_ENABLED", "true");
  vi.setSystemTime(Date.now() + 60 * DAY);
  expect(await t.mutation(sweep, {})).toBe(0);
  expect(
    await t.run((ctx) => ctx.db.query("scanResults").unique()),
  ).not.toHaveProperty("deletedAt");
});

test("paid persistence and free-to-paid upgrade preserve managed records", async () => {
  const t = convexTest(schema, modules);
  const { signedIn, credential } = await owner(t);
  await capture(t, credential, "before-upgrade");
  await grantFullAppAccess(t, "owner");
  await capture(t, credential, "after-upgrade");
  vi.setSystemTime(Date.now() + 90 * DAY);
  expect(await t.mutation(sweep, {})).toBe(0);
  expect(await signedIn.query(usage, {})).toMatchObject({
    tier: "workspace",
    recordsUsed: 2,
  });
  expect(
    (await t.run((ctx) => ctx.db.query("scanResults").collect())).every(
      (row) => row.deletedAt === undefined,
    ),
  ).toBe(true);
});

test("record/byte caps, append, invalid photo sizes and restore are transactional", async () => {
  const t = convexTest(schema, modules);
  const { signedIn, credential, workspaceId } = await owner(t);
  const policy = await signedIn.query(usage, {});
  await capture(t, credential);
  await t.run((ctx) =>
    ctx.db.patch(workspaceId, {
      managedRecordCount: policy.recordsLimit,
      managedByteCount: 3,
    }),
  );
  await expect(capture(t, credential, "extra")).rejects.toThrow(/record quota/);
  await expect(
    t.mutation(api.cloudWorkspace.putBatch, {
      ...credential,
      batchId: "one",
      clientCreatedAt: 1,
      results: [result("one"), result("appended")],
    }),
  ).rejects.toThrow(/record quota/);
  await t.run((ctx) =>
    ctx.db.patch(workspaceId, {
      managedRecordCount: 1,
      managedByteCount: policy.bytesLimit,
    }),
  );
  await expect(capture(t, credential, "extra")).rejects.toThrow(
    /storage quota/,
  );
  for (const byteCount of [-1, 0, 1.5, 10 * 1024 * 1024 + 1]) {
    await expect(
      t.mutation(api.cloudWorkspace.putBatch, {
        ...credential,
        batchId: "bad-photo",
        clientCreatedAt: 1,
        results: [{ ...result("bad-photo", "photo"), byteCount }],
      }),
    ).rejects.toThrow(/Photo size/);
  }
  await signedIn.mutation(api.cloudWorkspace.deleteWorkspaceResults, {
    resultIds: ["one"],
  });
  await t.run((ctx) =>
    ctx.db.patch(workspaceId, { managedRecordCount: policy.recordsLimit }),
  );
  await expect(
    signedIn.mutation(api.cloudWorkspace.restoreWorkspaceResults, {
      resultIds: ["one"],
    }),
  ).rejects.toThrow(/record quota/);
  expect(
    await t.run((ctx) => ctx.db.query("scanResults").unique()),
  ).toHaveProperty("deletedAt");
});

test("user-deleted photos deny access and cleanup retries keep bytes reserved", async () => {
  const t = convexTest(schema, modules);
  const { signedIn, credential } = await owner(t);
  await grantFullAppAccess(t, "owner");
  await capture(t, credential, "photo", "photo");
  await signedIn.mutation(api.cloudWorkspace.deleteWorkspaceResults, {
    resultIds: ["photo"],
  });
  await expect(
    t.query(authorizePhotoAccess, {
      ...credential,
      batchId: "photo",
      resultId: "photo",
      operation: "put",
    }),
  ).rejects.toThrow(/deleted/);
  expect(await signedIn.query(usage, {})).toMatchObject({
    recordsUsed: 0,
    bytesUsed: 10,
  });
  await signedIn.mutation(api.cloudWorkspace.restoreWorkspaceResults, {
    resultIds: ["photo"],
  });
  expect(await signedIn.query(usage, {})).toMatchObject({
    recordsUsed: 1,
    bytesUsed: 10,
  });
  await signedIn.mutation(api.cloudWorkspace.deleteWorkspaceResults, {
    resultIds: ["photo"],
  });
  vi.setSystemTime(Date.now() + 30 * DAY);
  await expect(
    signedIn.mutation(api.cloudWorkspace.restoreWorkspaceResults, {
      resultIds: ["photo"],
    }),
  ).rejects.toThrow(/Expired/);
  const fetch = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  expect(await t.action(purge, {})).toEqual({ purged: 0, failed: 1 });
  expect(await signedIn.query(usage, {})).toMatchObject({ bytesUsed: 10 });
  expect(await t.action(purge, {})).toEqual({ purged: 0, failed: 0 });
  vi.setSystemTime(Date.now() + 15 * 60 * 1000);
  fetch.mockImplementation(async () => new Response(null, { status: 404 }));
  expect(await t.action(purge, {})).toEqual({ purged: 1, failed: 0 });
  expect(await signedIn.query(usage, {})).toMatchObject({ bytesUsed: 0 });
  expect(fetch).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(await t.action(purge, {})).toEqual({ purged: 0, failed: 0 });
  expect(
    await t.run((ctx) => ctx.db.query("scanResults").unique()),
  ).not.toHaveProperty("objectKey");
});

test("quotas and restore never cross account boundaries", async () => {
  const t = convexTest(schema, modules);
  const alice = await owner(t, "alice");
  const bob = await owner(t, "bob");
  await capture(t, alice.credential, "alice-result");
  await alice.signedIn.mutation(api.cloudWorkspace.deleteWorkspaceResults, {
    resultIds: ["alice-result"],
  });
  expect(
    await bob.signedIn.mutation(api.cloudWorkspace.restoreWorkspaceResults, {
      resultIds: ["alice-result"],
    }),
  ).toMatchObject({ restored: 0 });
  expect(await bob.signedIn.query(usage, {})).toMatchObject({
    recordsUsed: 0,
    bytesUsed: 0,
  });
});

test("cancellation preserves read-only access for thirty days and then expires paid rows", async () => {
  const t = convexTest(schema, modules);
  const { signedIn, credential } = await owner(t);
  const startedAt = Date.now();
  const subscriptionId = await t.run((ctx) =>
    ctx.db.insert("webSubscriptions", {
      ownerClerkUserId: "owner",
      ownerTokenIdentifier: "test|owner",
      product: "workspace",
      stripeCustomerId: "customer",
      stripeSubscriptionId: "subscription",
      status: "active",
      currentPeriodEnd: startedAt + 60 * DAY,
      paidThrough: startedAt + 60 * DAY,
      cancelAtPeriodEnd: false,
      updatedAt: startedAt,
      lastEventCreated: startedAt,
    }),
  );
  await capture(t, credential, "paid-photo", "photo");
  await t.mutation(markBatchReady, { ...credential, batchId: "paid-photo" });
  await t.run((ctx) =>
    ctx.db.patch(subscriptionId, {
      status: "canceled",
      endedAt: startedAt + DAY,
    }),
  );
  vi.setSystemTime(startedAt + 2 * DAY);
  expect(await signedIn.query(usage, {})).toMatchObject({
    tier: "free",
    access: "read_only",
    recordsUsed: 1,
  });
  await expect(capture(t, credential, "during-grace")).rejects.toThrow(
    /read-only/,
  );
  expect(
    await t.query(authorizePhotoAccess, {
      ...credential,
      batchId: "paid-photo",
      resultId: "paid-photo",
      operation: "get",
    }),
  ).toHaveProperty("objectKey");
  expect(await t.mutation(sweep, {})).toBe(0);
  vi.setSystemTime(startedAt + 31 * DAY);
  await expect(
    t.query(authorizePhotoAccess, {
      ...credential,
      batchId: "paid-photo",
      resultId: "paid-photo",
      operation: "get",
    }),
  ).rejects.toThrow(/expired/);
  expect(await t.mutation(sweep, {})).toBe(1);
  expect(await signedIn.query(usage, {})).toMatchObject({
    access: "write",
    recordsUsed: 0,
    bytesUsed: 10,
  });
});

test("snapshot and batch reads redact expired payloads before the sweep runs", async () => {
  const t = convexTest(schema, modules);
  const { signedIn, credential } = await owner(t);
  await capture(t, credential, "private-text");
  vi.setSystemTime(Date.now() + 7 * DAY);
  const page = await signedIn.query(api.cloudWorkspace.workspaceSnapshotPage, {
    kind: "results",
    cursor: null,
  });
  expect(page).toMatchObject({
    kind: "results",
    items: [{ id: "private-text", deliveryState: "deleted" }],
  });
  if (!page || page.kind !== "results")
    throw new Error("Expected a results page");
  expect(page.items[0]).not.toHaveProperty("value");
  const snapshot = await signedIn.query(
    api.cloudWorkspace.workspaceSnapshot,
    {},
  );
  expect(snapshot?.batches[0].results[0]).toMatchObject({
    deliveryState: "deleted",
  });
  expect(snapshot?.batches[0].results[0]).not.toHaveProperty("value");
  const rows = await signedIn.query(api.cloudWorkspace.listBatchResults, {
    batchId: "private-text",
  });
  expect(rows[0]).not.toHaveProperty("text");
  expect(
    await t.run((ctx) => ctx.db.query("scanResults").unique()),
  ).not.toHaveProperty("deletedAt");
});
