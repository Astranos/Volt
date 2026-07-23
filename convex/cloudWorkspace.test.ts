import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { FREE_CLOUD_RESULT_LIMIT } from "./cloudWorkspace";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type DeviceCredential = { deviceId: string; deviceSecret: string };
type GuestCredential = { guestCloudGrant: string };

const ensureWorkspace = makeFunctionReference<"mutation", Record<string, never>, { _id: string }>(
  "cloudWorkspace:ensureWorkspace",
);
const createEnrollment = makeFunctionReference<
  "mutation",
  { kind: "ios" | "chrome"; label: string },
  { enrollmentCode: string; expiresAt: number }
>("cloudWorkspace:createEnrollment");
const getAccessStatus = makeFunctionReference<
  "mutation",
  { anonymousId?: string; anonymousSecret?: string },
  { statusCode: number; body: { access: string } }
>("access:getStatus");
const exchangeEnrollment = makeFunctionReference<
  "mutation",
  { enrollmentCode: string; label?: string },
  DeviceCredential & { workspaceId: string }
>("cloudWorkspace:exchangeEnrollment");
const revokeDevice = makeFunctionReference<"mutation", { deviceId: string }, { revoked: boolean }>(
  "cloudWorkspace:revokeDevice",
);
const putBatch = makeFunctionReference<
  "mutation",
  DeviceCredential & {
    batchId: string;
    clientCreatedAt: number;
    results: Array<{
      resultId: string;
      kind: "text" | "barcode" | "photo" | "dictation";
      text?: string;
      format?: string;
      contentType?: string;
      byteCount: number;
      checksum?: string;
      clientCreatedAt: number;
    }>;
  },
  { batchId: string; idempotent: boolean; status: string }
>("cloudWorkspace:putBatch");
const markBatchReady = makeFunctionReference<
  "mutation",
  DeviceCredential & { batchId: string },
  { idempotent: boolean }
>("cloudWorkspace:markBatchReady");
const listBatches = makeFunctionReference<"query", Record<string, never>, Array<{ batchId: string }>>(
  "cloudWorkspace:listBatches",
);
const authorizePhotoAccess = makeFunctionReference<
  "query",
  DeviceCredential & { batchId: string; resultId: string; operation: "put" | "get" },
  { objectKey: string; contentType?: string }
>("cloudWorkspace:authorizePhotoAccess");
const createPhotoUploadUrl = makeFunctionReference<
  "action",
  DeviceCredential & { batchId: string; resultId: string },
  { url: string; method: string; expiresAt: number; headers: Record<string, string> }
>("cloudWorkspace:createPhotoUploadUrl");
const createPhotoDownloadUrl = makeFunctionReference<
  "action",
  { deviceId?: string; deviceSecret?: string; batchId: string; resultId: string },
  { url: string; method: string; expiresAt: number; headers: Record<string, string> }
>("cloudWorkspace:createPhotoDownloadUrl");
const registerComputer = makeFunctionReference<
  "mutation",
  { installationId: string; label: string; capabilities?: string[] },
  { deviceId: string; workspaceId: string; registrationId: string; expiresAt: number }
>("cloudWorkspace:registerComputer");
const deleteWorkspaceResults = makeFunctionReference<
  "mutation",
  { resultIds: string[] },
  { deletedIds: string[]; newlyDeletedIds: string[]; deleted: number; idempotent: number }
>("cloudWorkspace:deleteWorkspaceResults");
const restoreWorkspaceResults = makeFunctionReference<
  "mutation",
  { resultIds: string[] },
  { restoredIds: string[]; newlyRestoredIds: string[]; restored: number; idempotent: number }
>("cloudWorkspace:restoreWorkspaceResults");
const workspaceSnapshot = makeFunctionReference<
  "query",
  Record<string, never>,
  { batches: Array<{ results: Array<{ id: string; deliveryState: "available" | "deleted" }> }> }
>("cloudWorkspace:workspaceSnapshot");
const createGuestGrant = makeFunctionReference<
  "mutation",
  { clerkUserId: string; joinToken: string; usageSessionId: string },
  GuestCredential & { expiresAt: number }
>("cloudWorkspace:createGuestGrant");
const putGuestBatch = makeFunctionReference<
  "mutation",
  GuestCredential & {
    batchId: string;
    clientCreatedAt: number;
    results: Array<ReturnType<typeof result>>;
  },
  { batchId: string; idempotent: boolean; status: string }
>("cloudWorkspace:putGuestBatch");
const markGuestBatchReady = makeFunctionReference<
  "mutation",
  GuestCredential & { batchId: string },
  { idempotent: boolean }
>("cloudWorkspace:markGuestBatchReady");
const authorizeGuestPhotoAccess = makeFunctionReference<
  "query",
  GuestCredential & { batchId: string; resultId: string; operation: "put" | "get" },
  { objectKey: string; contentType?: string }
>("cloudWorkspace:authorizePhotoAccess");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function enroll(
  t: ReturnType<typeof convexTest>,
  userId: string,
  kind: "ios" | "chrome" = "ios",
) {
  const signedIn = t.withIdentity({ subject: userId, name: userId });
  const enrollment = await signedIn.mutation(createEnrollment, { kind, label: `${userId} device` });
  const exchanged = await t.mutation(exchangeEnrollment, {
    enrollmentCode: enrollment.enrollmentCode,
  });
  return {
    signedIn,
    credential: { deviceId: exchanged.deviceId, deviceSecret: exchanged.deviceSecret },
    workspaceId: exchanged.workspaceId,
    enrollment,
  };
}

function result(resultId: string, kind: "text" | "photo" = "text") {
  return {
    resultId,
    kind,
    ...(kind === "text" ? { text: resultId } : { contentType: "image/jpeg" }),
    byteCount: 10,
    clientCreatedAt: 1,
  };
}

async function guestGrant(
  t: ReturnType<typeof convexTest>,
  clerkUserId: string,
  usageSessionId = `usage-${clerkUserId}`,
) {
  const joinToken = `join-token-${clerkUserId}-abcdefghijklmnopqrstuvwxyz`;
  const now = Date.now();
  await t.run((ctx) => ctx.db.insert("scannerJoinTokens", {
    token: joinToken,
    sessionId: `session-${clerkUserId}`,
    createdAt: now,
    expiresAt: now + 60_000,
    graceExpiresAt: now + 90_000,
    usageSessionId,
    clerkUserId,
  }));
  return t.mutation(createGuestGrant, { clerkUserId, joinToken, usageSessionId });
}

async function startGuestUsageSession(
  t: ReturnType<typeof convexTest>,
  clerkUserId: string,
  usageSessionId = `usage-${clerkUserId}`,
) {
  const now = Date.now();
  await t.run((ctx) => ctx.db.insert("usageSessions", {
    usageSessionId,
    browserSessionId: `session-${clerkUserId}`,
    ownerType: "user",
    clerkUserId,
    accessSource: "subscription",
    startedAt: now,
    lastConnectedAt: now,
    consumedAt: now,
  }));
}

describe("cloud scanner workspace", () => {
  test("uses a hashed session-bound guest grant without creating a durable App Clip device", async () => {
    const t = convexTest(schema, modules);
    const grant = await guestGrant(t, "guest-owner");
    await startGuestUsageSession(t, "guest-owner");

    const first = await t.mutation(putGuestBatch, {
      guestCloudGrant: grant.guestCloudGrant,
      batchId: "guest-batch",
      clientCreatedAt: 1,
      results: [result("guest-result")],
    });
    expect(first.idempotent).toBe(false);
    expect((await t.mutation(putGuestBatch, {
      guestCloudGrant: grant.guestCloudGrant,
      batchId: "guest-batch",
      clientCreatedAt: 1,
      results: [result("guest-result")],
    })).idempotent).toBe(true);
    expect(await t.mutation(markGuestBatchReady, {
      guestCloudGrant: grant.guestCloudGrant,
      batchId: "guest-batch",
    })).toEqual({ idempotent: false });

    const storedGrant = await t.run((ctx) => ctx.db.query("workspaceGuestGrants").unique());
    expect(storedGrant?.grantHash).not.toBe(grant.guestCloudGrant);
    expect(storedGrant?.lastUsedAt).toBeTypeOf("number");
    expect(await t.run((ctx) => ctx.db.query("workspaceDevices").collect())).toEqual([]);
  });

  test("expires guest access when its usage session ends", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T12:00:00Z"));
    const t = convexTest(schema, modules);
    const grant = await guestGrant(t, "ended-guest");
    await startGuestUsageSession(t, "ended-guest");
    await t.run(async (ctx) => {
      const session = await ctx.db.query("usageSessions").unique();
      if (session) await ctx.db.patch(session._id, { endedAt: Date.now(), endedReason: "explicit_disconnect" });
    });

    await expect(t.mutation(putGuestBatch, {
      guestCloudGrant: grant.guestCloudGrant,
      batchId: "late-batch",
      clientCreatedAt: 1,
      results: [result("late-result")],
    })).rejects.toThrow(/session has ended/);
  });

  test("keeps guest photo access isolated to the Chrome account workspace", async () => {
    const t = convexTest(schema, modules);
    const alice = await guestGrant(t, "guest-alice");
    const bob = await guestGrant(t, "guest-bob");
    await startGuestUsageSession(t, "guest-alice");
    await startGuestUsageSession(t, "guest-bob");
    await t.mutation(putGuestBatch, {
      guestCloudGrant: alice.guestCloudGrant,
      batchId: "alice-photo-batch",
      clientCreatedAt: 1,
      results: [result("alice-photo", "photo")],
    });

    await expect(t.query(authorizeGuestPhotoAccess, {
      guestCloudGrant: bob.guestCloudGrant,
      batchId: "alice-photo-batch",
      resultId: "alice-photo",
      operation: "put",
    })).rejects.toThrow(/Photo not found/);
  });

  test("exchanges a one-time enrollment code and rejects revoked device credentials", async () => {
    const t = convexTest(schema, modules);
    const { signedIn, credential, enrollment } = await enroll(t, "user-enrollment");

    await expect(
      t.mutation(exchangeEnrollment, { enrollmentCode: enrollment.enrollmentCode }),
    ).rejects.toThrow(/already used/);
    const storedEnrollment = await t.run((ctx) => ctx.db.query("workspaceEnrollments").unique());
    const storedDevice = await t.run((ctx) => ctx.db.query("workspaceDevices").unique());
    expect(storedEnrollment?.codeHash).not.toBe(enrollment.enrollmentCode);
    expect(storedDevice?.credentialHash).not.toBe(credential.deviceSecret);

    expect(await signedIn.mutation(revokeDevice, { deviceId: credential.deviceId })).toEqual({
      revoked: true,
    });
    await expect(
      t.mutation(putBatch, {
        ...credential,
        batchId: "revoked-batch",
        clientCreatedAt: 1,
        results: [result("result-1")],
      }),
    ).rejects.toThrow(/revoked device credential/);
  });

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

  test("deduplicates batch retries without charging quota twice and enforces the free allowance", async () => {
    const t = convexTest(schema, modules);
    const { credential } = await enroll(t, "free-user");
    const results = Array.from({ length: FREE_CLOUD_RESULT_LIMIT }, (_, index) =>
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
    await expect(
      t.mutation(putBatch, {
        ...credential,
        batchId: "over-limit",
        clientCreatedAt: 2,
        results: [result("one-too-many")],
      }),
    ).rejects.toThrow(/allowance exceeded/);
    expect(await t.run((ctx) => ctx.db.query("scanResults").collect())).toHaveLength(
      FREE_CLOUD_RESULT_LIMIT,
    );
  });

  test("does not apply the free cloud quota to complimentary email accounts", async () => {
    const t = convexTest(schema, modules);
    const clerkUserId = "complimentary-paymore-user";
    const signedIn = t.withIdentity({
      subject: clerkUserId,
      tokenIdentifier: `clerk|${clerkUserId}`,
      email: "scanner@paymore.com",
      email_verified: true,
    });
    expect((await signedIn.mutation(getAccessStatus, {})).body.access).toBe("complimentary");

    const enrollment = await signedIn.mutation(createEnrollment, {
      kind: "ios",
      label: "PayMore iPhone",
    });
    const credential = await t.mutation(exchangeEnrollment, {
      enrollmentCode: enrollment.enrollmentCode,
    });
    const results = Array.from({ length: FREE_CLOUD_RESULT_LIMIT + 1 }, (_, index) =>
      result(`complimentary-result-${index}`),
    );

    await expect(t.mutation(putBatch, {
      deviceId: credential.deviceId,
      deviceSecret: credential.deviceSecret,
      batchId: "complimentary-over-free-limit",
      clientCreatedAt: 1,
      results,
    })).resolves.toMatchObject({ idempotent: false });
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

  test("requires Clerk authentication to create account workspaces", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(ensureWorkspace, {})).rejects.toThrow(/Authentication required/);
  });

  test("registers a signed-in Chrome installation idempotently within its tenant", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "computer-owner" });
    const bob = t.withIdentity({ subject: "different-owner" });
    const first = await alice.mutation(registerComputer, {
      installationId: "stable-extension-installation",
      label: "Desk Chrome",
      capabilities: ["cursor-insertion"],
    });
    const heartbeat = await alice.mutation(registerComputer, {
      installationId: "stable-extension-installation",
      label: "Desk Chrome renamed",
      capabilities: ["cursor-insertion", "dictation"],
    });
    expect(heartbeat.registrationId).toBe(first.registrationId);
    await expect(
      bob.mutation(registerComputer, {
        installationId: "stable-extension-installation",
        label: "Not Bob's computer",
      }),
    ).rejects.toThrow(/already registered/);
    expect(await t.run((ctx) => ctx.db.query("workspaceDevices").collect())).toHaveLength(1);
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
    expect((await alice.signedIn.query(workspaceSnapshot, {})).batches[0].results[0]).toMatchObject({
      id: "alice-delete-result",
      deliveryState: "deleted",
    });
    expect((await bob.signedIn.query(workspaceSnapshot, {})).batches[0].results[0]).toMatchObject({
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
    expect((await alice.signedIn.query(workspaceSnapshot, {})).batches[0].results[0]).toMatchObject({
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
});
