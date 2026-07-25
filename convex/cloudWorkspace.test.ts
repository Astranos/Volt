import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { CURSOR_DELIVERY_TTL_MS, FREE_CLOUD_RESULT_LIMIT } from "./cloudWorkspace";
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
  { installationId: string; label: string; capabilities?: string[]; ttlMs?: number },
  { deviceId: string; workspaceId: string; registrationId: string; expiresAt: number }
>("cloudWorkspace:registerComputer");
const bootstrapMobileDevice = makeFunctionReference<
  "mutation",
  { installationId: string; label: string; existingDeviceId?: string },
  DeviceCredential & { workspaceId: string; clerkUserId: string }
>("cloudWorkspace:bootstrapMobileDevice");
const listComputersForDevice = makeFunctionReference<
  "query",
  DeviceCredential,
  {
    cursorTargetDeviceId: string | null;
    computers: Array<{ deviceId: string; label: string; capabilities: string[]; online: boolean }>;
  }
>("cloudWorkspace:listComputersForDevice");
const sweepExpiredPresence = makeFunctionReference<"mutation", Record<string, never>, null>(
  "cloudWorkspace:sweepExpiredPresence",
);
const sweepExpiredCursorDeliveries = makeFunctionReference<"mutation", Record<string, never>, null>(
  "cloudWorkspace:sweepExpiredCursorDeliveries",
);
const setCursorTarget = makeFunctionReference<
  "mutation",
  DeviceCredential & { cursorTargetDeviceId: string | null },
  { cursorTargetDeviceId: string | null }
>("cloudWorkspace:setCursorTarget");
type CursorDeliveryInput = DeviceCredential & {
  deliveryId: string;
  resultId: string;
  targetDeviceId: string;
  kind: "barcode" | "text";
  text: string;
  format?: string;
  clientCreatedAt: number;
};
const queueCursorDelivery = makeFunctionReference<
  "mutation",
  CursorDeliveryInput,
  { deliveryId: string; idempotent: boolean; state: "pending" | "delivered" | "failed" }
>("cloudWorkspace:queueCursorDelivery");
const pendingCursorDeliveries = makeFunctionReference<
  "query",
  { installationId: string },
  Array<{ deliveryId: string; state: "pending"; expiresAt: number }>
>("cloudWorkspace:pendingCursorDeliveries");
const acknowledgeCursorDelivery = makeFunctionReference<
  "mutation",
  {
    installationId: string;
    deliveryId: string;
    state: "delivered" | "failed";
    errorCode?: string;
  },
  { state: "pending" | "delivered" | "failed"; idempotent: boolean; attempts: number }
>("cloudWorkspace:acknowledgeCursorDelivery");
const cursorDeliveryStatus = makeFunctionReference<
  "query",
  DeviceCredential & { deliveryIds: string[] },
  {
    statuses: Array<{
      deliveryId: string;
      state: "pending" | "delivered" | "failed";
      errorCode?: string;
      deliveredAt?: number;
    }>;
  }
>("cloudWorkspace:cursorDeliveryStatus");
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
  { batches: Array<{ results: Array<{ id: string; deliveryState: "available" | "deleted" }> }> } | null
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

  test("rebinds a signed-in Chrome installation across accounts without leaking pending deliveries", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "computer-owner" });
    const bob = t.withIdentity({ subject: "different-owner" });
    const phone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "computer-owner-phone",
      label: "Alice phone",
    });
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

    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "pre-rebind-batch",
      clientCreatedAt: Date.now(),
      results: [result("pre-rebind-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "pre-rebind-delivery",
      resultId: "pre-rebind-result",
      targetDeviceId: "stable-extension-installation",
      kind: "text",
      text: "pre-rebind-result",
      clientCreatedAt: Date.now(),
    });

    const rebound = await bob.mutation(registerComputer, {
      installationId: "stable-extension-installation",
      label: "Bob's computer",
      capabilities: ["cursor-insertion"],
    });
    expect(rebound.workspaceId).not.toBe(first.workspaceId);
    expect(rebound.registrationId).not.toBe(first.registrationId);
    expect(await alice.query(pendingCursorDeliveries, {
      installationId: "stable-extension-installation",
    })).toEqual([]);
    expect(await bob.query(pendingCursorDeliveries, {
      installationId: "stable-extension-installation",
    })).toEqual([]);

    const devices = await t.run((ctx) => ctx.db.query("workspaceDevices").collect());
    expect(devices).toHaveLength(2);
    expect(devices.find((device) => device.deviceId === "stable-extension-installation")).toMatchObject({
      workspaceId: rebound.workspaceId,
      kind: "chrome",
      label: "Bob's computer",
    });
    const staleDelivery = await t.run((ctx) => ctx.db.query("cursorDeliveries").unique());
    expect(staleDelivery).toMatchObject({
      workspaceId: first.workspaceId,
      state: "failed",
      errorCode: "target-rebound",
    });
  });

  test("reports cursor delivery status only for the calling device's own workspace deliveries", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "status-owner" });
    const bob = t.withIdentity({ subject: "status-other-owner" });
    const phone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "status-phone",
      label: "Alice phone",
    });
    const otherPhone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "status-phone-2",
      label: "Alice second phone",
    });
    await alice.mutation(registerComputer, {
      installationId: "status-chrome",
      label: "Alice Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };

    await t.mutation(putBatch, {
      ...credential,
      batchId: "status-batch",
      clientCreatedAt: Date.now(),
      results: [result("delivered-result"), result("failed-result"), result("pending-result")],
    });
    for (const [deliveryId, resultId] of [
      ["delivered-delivery", "delivered-result"],
      ["failed-delivery", "failed-result"],
      ["pending-delivery", "pending-result"],
    ]) {
      await t.mutation(queueCursorDelivery, {
        ...credential,
        deliveryId,
        resultId,
        targetDeviceId: "status-chrome",
        kind: "text",
        text: resultId,
        clientCreatedAt: Date.now(),
      });
    }
    await alice.mutation(acknowledgeCursorDelivery, {
      installationId: "status-chrome",
      deliveryId: "delivered-delivery",
      state: "delivered",
    });
    await alice.mutation(acknowledgeCursorDelivery, {
      installationId: "status-chrome",
      deliveryId: "failed-delivery",
      state: "failed",
      errorCode: "no-editable-field",
    });

    // Another device in the same workspace queues its own delivery.
    const otherCredential = { deviceId: otherPhone.deviceId, deviceSecret: otherPhone.deviceSecret };
    await t.mutation(putBatch, {
      ...otherCredential,
      batchId: "status-other-device-batch",
      clientCreatedAt: Date.now(),
      results: [result("other-device-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...otherCredential,
      deliveryId: "other-device-delivery",
      resultId: "other-device-result",
      targetDeviceId: "status-chrome",
      kind: "text",
      text: "other-device-result",
      clientCreatedAt: Date.now(),
    });

    // Another workspace queues a delivery whose id collides by name only.
    const bobPhone = await bob.mutation(bootstrapMobileDevice, {
      installationId: "status-bob-phone",
      label: "Bob phone",
    });
    await bob.mutation(registerComputer, {
      installationId: "status-bob-chrome",
      label: "Bob Chrome",
      capabilities: ["cursor-insertion"],
    });
    const bobCredential = { deviceId: bobPhone.deviceId, deviceSecret: bobPhone.deviceSecret };
    await t.mutation(putBatch, {
      ...bobCredential,
      batchId: "status-bob-batch",
      clientCreatedAt: Date.now(),
      results: [result("delivered-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...bobCredential,
      deliveryId: "delivered-delivery",
      resultId: "delivered-result",
      targetDeviceId: "status-bob-chrome",
      kind: "text",
      text: "delivered-result",
      clientCreatedAt: Date.now(),
    });

    const { statuses } = await t.query(cursorDeliveryStatus, {
      ...credential,
      deliveryIds: [
        "delivered-delivery",
        "failed-delivery",
        "pending-delivery",
        "other-device-delivery",
        "unknown-delivery",
      ],
    });
    const byId = Object.fromEntries(statuses.map((status) => [status.deliveryId, status]));
    expect(statuses).toHaveLength(3);
    expect(byId["delivered-delivery"]).toMatchObject({ state: "delivered" });
    expect(byId["delivered-delivery"].deliveredAt).toBeTypeOf("number");
    expect(byId["delivered-delivery"].errorCode).toBeUndefined();
    expect(byId["failed-delivery"]).toMatchObject({ state: "failed", errorCode: "no-editable-field" });
    expect(byId["pending-delivery"]).toMatchObject({ state: "pending" });
    expect(byId["other-device-delivery"]).toBeUndefined();
    expect(byId["unknown-delivery"]).toBeUndefined();
  });

  test("marks an expired but still-pending cursor delivery as failed with an expired error code", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "expiry-owner" });
    const phone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "expiry-phone",
      label: "Alice phone",
    });
    await alice.mutation(registerComputer, {
      installationId: "expiry-chrome",
      label: "Alice Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "expiry-batch",
      clientCreatedAt: Date.now(),
      results: [result("expiry-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "expiry-delivery",
      resultId: "expiry-result",
      targetDeviceId: "expiry-chrome",
      kind: "text",
      text: "expiry-result",
      clientCreatedAt: Date.now(),
    });

    vi.advanceTimersByTime(CURSOR_DELIVERY_TTL_MS + 1);
    const { statuses } = await t.query(cursorDeliveryStatus, {
      ...credential,
      deliveryIds: ["expiry-delivery"],
    });
    expect(statuses).toEqual([{ deliveryId: "expiry-delivery", state: "failed", errorCode: "expired" }]);
  });

  test("records a delivered acknowledgement after expiry as failed/expired", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "ack-expiry-owner" });
    const phone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "ack-expiry-phone",
      label: "Alice phone",
    });
    await alice.mutation(registerComputer, {
      installationId: "ack-expiry-chrome",
      label: "Alice Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "ack-expiry-batch",
      clientCreatedAt: Date.now(),
      results: [result("ack-expiry-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "ack-expiry-delivery",
      resultId: "ack-expiry-result",
      targetDeviceId: "ack-expiry-chrome",
      kind: "text",
      text: "ack-expiry-result",
      clientCreatedAt: Date.now(),
    });

    // The extension delivers after the soft-expiry window has already passed.
    vi.advanceTimersByTime(CURSOR_DELIVERY_TTL_MS + 1);
    const ack = await alice.mutation(acknowledgeCursorDelivery, {
      installationId: "ack-expiry-chrome",
      deliveryId: "ack-expiry-delivery",
      state: "delivered",
    });
    expect(ack).toMatchObject({ state: "failed", idempotent: false });

    const stored = await t.run((ctx) => ctx.db.query("cursorDeliveries").unique());
    expect(stored).toMatchObject({ state: "failed", errorCode: "expired" });
    expect(stored?.deliveredAt).toBeUndefined();

    // The phone's status endpoint now agrees: the delivery can never be delivered.
    const { statuses } = await t.query(cursorDeliveryStatus, {
      ...credential,
      deliveryIds: ["ack-expiry-delivery"],
    });
    expect(statuses).toEqual([{ deliveryId: "ack-expiry-delivery", state: "failed", errorCode: "expired" }]);
  });

  test("bootstraps only iOS credentials, rotates them, and rejects cross-workspace rotation", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "bootstrap-alice", name: "Alice" });
    const bob = t.withIdentity({ subject: "bootstrap-bob", name: "Bob" });
    const issued = await alice.mutation(bootstrapMobileDevice, {
      installationId: "alice-installation",
      label: "Alice iPhone",
    });
    expect(issued).toMatchObject({ clerkUserId: "bootstrap-alice" });
    expect(issued.deviceSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await alice.query(listComputersForDevice, {
      deviceId: issued.deviceId,
      deviceSecret: issued.deviceSecret,
    })).toMatchObject({ cursorTargetDeviceId: null });

    const rotated = await alice.mutation(bootstrapMobileDevice, {
      installationId: "alice-installation",
      label: "Alice iPhone renamed",
      existingDeviceId: issued.deviceId,
    });
    expect(rotated.deviceId).toBe(issued.deviceId);
    expect(rotated.deviceSecret).not.toBe(issued.deviceSecret);
    await expect(alice.query(listComputersForDevice, {
      deviceId: issued.deviceId,
      deviceSecret: issued.deviceSecret,
    })).rejects.toThrow(/Invalid or revoked device credential/);
    expect(await t.run((ctx) => ctx.db.query("workspaceDevices").collect())).toHaveLength(1);

    await alice.mutation(registerComputer, {
      installationId: "bootstrap-alice-chrome",
      label: "Alice Chrome",
      capabilities: ["cursor-insertion"],
    });
    const chromeBefore = await t.run(async (ctx) => ctx.db
      .query("workspaceDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", "bootstrap-alice-chrome"))
      .unique());
    const issuedFromChromeId = await alice.mutation(bootstrapMobileDevice, {
      installationId: "alice-installation",
      label: "Alice replacement iPhone",
      existingDeviceId: "bootstrap-alice-chrome",
    });
    expect(issuedFromChromeId.deviceId).not.toBe("bootstrap-alice-chrome");
    const devicesAfterChromeReuseAttempt = await t.run((ctx) => ctx.db.query("workspaceDevices").collect());
    expect(devicesAfterChromeReuseAttempt.find((device) => device.deviceId === "bootstrap-alice-chrome"))
      .toMatchObject({ kind: "chrome", credentialHash: chromeBefore?.credentialHash });
    expect(devicesAfterChromeReuseAttempt.find((device) => device.deviceId === issuedFromChromeId.deviceId))
      .toMatchObject({ kind: "ios" });

    const bobDevice = await bob.mutation(bootstrapMobileDevice, {
      installationId: "bob-installation",
      label: "Bob iPhone",
    });
    await expect(alice.mutation(bootstrapMobileDevice, {
      installationId: "alice-installation",
      label: "Not Alice's device",
      existingDeviceId: bobDevice.deviceId,
    })).rejects.toThrow(/another workspace/);
  });

  test("lists device-authenticated computers with lease state, capabilities, and the phone cursor target", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({ subject: "computer-list-owner" });
    const phone = await signedIn.mutation(bootstrapMobileDevice, {
      installationId: "phone-installation",
      label: "Phone",
    });
    await signedIn.mutation(registerComputer, {
      installationId: "online-chrome",
      label: "Online Chrome",
      capabilities: ["Cursor-Insertion", "dictation", "cursor-insertion"],
      ttlMs: 120_000,
    });
    await signedIn.mutation(registerComputer, {
      installationId: "expired-chrome",
      label: "Expired Chrome",
      capabilities: ["workspace-results", "unknown-legacy"],
      ttlMs: 10_000,
    });
    await signedIn.mutation(setCursorTarget, {
      deviceId: phone.deviceId,
      deviceSecret: phone.deviceSecret,
      cursorTargetDeviceId: "online-chrome",
    });
    vi.advanceTimersByTime(10_001);

    const listed = await t.query(listComputersForDevice, {
      deviceId: phone.deviceId,
      deviceSecret: phone.deviceSecret,
    });
    expect(listed.cursorTargetDeviceId).toBe("online-chrome");
    expect(listed.computers).toEqual(expect.arrayContaining([
      {
        deviceId: "online-chrome",
        label: "Online Chrome",
        capabilities: ["cursor-insertion", "dictation"],
        online: true,
      },
      {
        deviceId: "expired-chrome",
        label: "Expired Chrome",
        capabilities: ["workspace-results", "unknown-legacy"],
        online: false,
      },
    ]));
  });

  test("sets and clears only same-workspace cursor-capable Chrome targets", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "cursor-target-alice" });
    const bob = t.withIdentity({ subject: "cursor-target-bob" });
    const phone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "cursor-phone",
      label: "Alice phone",
    });
    const otherPhone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "cursor-other-phone",
      label: "Alice second phone",
    });
    await alice.mutation(registerComputer, {
      installationId: "cursor-valid-chrome",
      label: "Valid Chrome",
      capabilities: ["cursor-insertion"],
    });
    await alice.mutation(registerComputer, {
      installationId: "cursor-no-capability",
      label: "No cursor capability",
      capabilities: ["workspace-results"],
    });
    await bob.mutation(registerComputer, {
      installationId: "cursor-bob-chrome",
      label: "Bob Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };

    await expect(t.mutation(setCursorTarget, {
      ...credential,
      cursorTargetDeviceId: "cursor-bob-chrome",
    })).rejects.toThrow(/Target computer not found/);
    await expect(t.mutation(setCursorTarget, {
      ...credential,
      cursorTargetDeviceId: otherPhone.deviceId,
    })).rejects.toThrow(/Target computer not found/);
    await expect(t.mutation(setCursorTarget, {
      ...credential,
      cursorTargetDeviceId: "cursor-no-capability",
    })).rejects.toThrow(/does not support cursor insertion/);
    await expect(t.mutation(setCursorTarget, {
      ...credential,
      cursorTargetDeviceId: "cursor-valid-chrome",
    })).resolves.toEqual({ cursorTargetDeviceId: "cursor-valid-chrome" });
    await expect(t.mutation(setCursorTarget, {
      ...credential,
      cursorTargetDeviceId: null,
    })).resolves.toEqual({ cursorTargetDeviceId: null });
  });

  test("queues cursor deliveries idempotently by workspace and client delivery id", async () => {
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({ subject: "delivery-queue-owner" });
    const phone = await signedIn.mutation(bootstrapMobileDevice, {
      installationId: "delivery-phone",
      label: "Delivery phone",
    });
    await signedIn.mutation(registerComputer, {
      installationId: "delivery-chrome",
      label: "Delivery Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "delivery-batch",
      clientCreatedAt: 1,
      results: [result("delivery-result")],
    });
    const input: CursorDeliveryInput = {
      ...credential,
      deliveryId: "cursor-delivery-id",
      resultId: "delivery-result",
      targetDeviceId: "delivery-chrome",
      kind: "text",
      text: "delivery-result",
      clientCreatedAt: 1_000,
    };

    expect(await t.mutation(queueCursorDelivery, input)).toEqual({
      deliveryId: "cursor-delivery-id",
      idempotent: false,
      state: "pending",
    });
    expect(await t.mutation(queueCursorDelivery, input)).toEqual({
      deliveryId: "cursor-delivery-id",
      idempotent: true,
      state: "pending",
    });
    const stored = await t.run((ctx) => ctx.db.query("cursorDeliveries").unique());
    expect(stored).toMatchObject({
      deliveryId: "cursor-delivery-id",
      resultId: "delivery-result",
      expiresAt: 1_000 + CURSOR_DELIVERY_TTL_MS,
      attempts: 0,
    });
  });

  test("caps future-dated cursor delivery expiry at one server-side TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({ subject: "future-delivery-owner" });
    const phone = await signedIn.mutation(bootstrapMobileDevice, {
      installationId: "future-delivery-phone",
      label: "Future delivery phone",
    });
    await signedIn.mutation(registerComputer, {
      installationId: "future-delivery-chrome",
      label: "Future delivery Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "future-delivery-batch",
      clientCreatedAt: Date.now(),
      results: [result("future-delivery-result")],
    });
    const serverNow = Date.now();
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "future-delivery",
      resultId: "future-delivery-result",
      targetDeviceId: "future-delivery-chrome",
      kind: "text",
      text: "future-delivery-result",
      clientCreatedAt: serverNow + 365 * 24 * 60 * 60 * 1000,
    });

    const stored = await t.run((ctx) => ctx.db.query("cursorDeliveries").unique());
    expect(stored?.expiresAt).toBe(serverNow + CURSOR_DELIVERY_TTL_MS);
  });

  test("scopes pending cursor deliveries to the authenticated registered computer", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "pending-alice" });
    const bob = t.withIdentity({ subject: "pending-bob" });
    const alicePhone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "pending-alice-phone",
      label: "Alice phone",
    });
    await alice.mutation(registerComputer, {
      installationId: "pending-alice-chrome",
      label: "Alice Chrome",
      capabilities: ["cursor-insertion"],
    });
    await bob.mutation(registerComputer, {
      installationId: "pending-bob-chrome",
      label: "Bob Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: alicePhone.deviceId, deviceSecret: alicePhone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "pending-batch",
      clientCreatedAt: Date.now(),
      results: [result("pending-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "pending-delivery",
      resultId: "pending-result",
      targetDeviceId: "pending-alice-chrome",
      kind: "text",
      text: "pending-result",
      clientCreatedAt: Date.now(),
    });

    expect(await alice.query(pendingCursorDeliveries, {
      installationId: "pending-alice-chrome",
    })).toHaveLength(1);
    expect(await bob.query(pendingCursorDeliveries, {
      installationId: "pending-bob-chrome",
    })).toEqual([]);
    expect(await bob.query(pendingCursorDeliveries, {
      installationId: "pending-alice-chrome",
    })).toEqual([]);
  });

  test("guards cursor delivery acknowledgement transitions and keeps terminal states immutable", async () => {
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({ subject: "cursor-ack-owner" });
    const phone = await signedIn.mutation(bootstrapMobileDevice, {
      installationId: "cursor-ack-phone",
      label: "Ack phone",
    });
    await signedIn.mutation(registerComputer, {
      installationId: "cursor-ack-chrome",
      label: "Ack Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "cursor-ack-batch",
      clientCreatedAt: Date.now(),
      results: [result("delivered-result"), result("failed-result")],
    });
    for (const [deliveryId, resultId] of [
      ["delivered-delivery", "delivered-result"],
      ["failed-delivery", "failed-result"],
    ] as const) {
      await t.mutation(queueCursorDelivery, {
        ...credential,
        deliveryId,
        resultId,
        targetDeviceId: "cursor-ack-chrome",
        kind: "text",
        text: resultId,
        clientCreatedAt: Date.now(),
      });
    }

    expect(await signedIn.mutation(acknowledgeCursorDelivery, {
      installationId: "cursor-ack-chrome",
      deliveryId: "delivered-delivery",
      state: "delivered",
    })).toMatchObject({ state: "delivered", idempotent: false, attempts: 1 });
    expect(await signedIn.mutation(acknowledgeCursorDelivery, {
      installationId: "cursor-ack-chrome",
      deliveryId: "delivered-delivery",
      state: "failed",
      errorCode: "no-editable-field",
    })).toMatchObject({ state: "delivered", idempotent: true, attempts: 1 });
    expect(await signedIn.mutation(acknowledgeCursorDelivery, {
      installationId: "cursor-ack-chrome",
      deliveryId: "failed-delivery",
      state: "failed",
      errorCode: "no-editable-field",
    })).toMatchObject({ state: "failed", idempotent: false, attempts: 1 });
    expect(await signedIn.mutation(acknowledgeCursorDelivery, {
      installationId: "cursor-ack-chrome",
      deliveryId: "failed-delivery",
      state: "delivered",
    })).toMatchObject({ state: "failed", idempotent: true, attempts: 1 });
    const deliveries = await t.run((ctx) => ctx.db.query("cursorDeliveries").collect());
    expect(deliveries.find((item) => item.deliveryId === "delivered-delivery")).toMatchObject({
      state: "delivered",
      attempts: 1,
    });
    expect(deliveries.find((item) => item.deliveryId === "failed-delivery")).toMatchObject({
      state: "failed",
      attempts: 1,
      errorCode: "no-editable-field",
    });
  });

  test("returns expired cursor deliveries so the extension can fail them", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({ subject: "cursor-expiry-owner" });
    const phone = await signedIn.mutation(bootstrapMobileDevice, {
      installationId: "cursor-expiry-phone",
      label: "Expiry phone",
    });
    await signedIn.mutation(registerComputer, {
      installationId: "cursor-expiry-chrome",
      label: "Expiry Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "cursor-expiry-batch",
      clientCreatedAt: Date.now(),
      results: [result("expired-result"), result("current-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "expired-delivery",
      resultId: "expired-result",
      targetDeviceId: "cursor-expiry-chrome",
      kind: "text",
      text: "expired-result",
      clientCreatedAt: Date.now() - CURSOR_DELIVERY_TTL_MS,
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "current-delivery",
      resultId: "current-result",
      targetDeviceId: "cursor-expiry-chrome",
      kind: "text",
      text: "current-result",
      clientCreatedAt: Date.now(),
    });

    expect((await signedIn.query(pendingCursorDeliveries, {
      installationId: "cursor-expiry-chrome",
    })).map((delivery) => delivery.deliveryId)).toEqual([
      "expired-delivery",
      "current-delivery",
    ]);
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
    // Only mutations create the workspace row, so signing in is not enough to
    // make one exist. Throwing here surfaced as "Cloud sync failed" on every
    // account's very first open.
    const newcomer = t.withIdentity({ subject: "never-captured-anything" });

    expect(await newcomer.query(workspaceSnapshot, {})).toBeNull();
  });

  test("sweeps an expired online presence lease to offline", async () => {
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({ subject: "sweep-owner" });
    await signedIn.mutation(registerComputer, {
      installationId: "sweep-expired-chrome",
      label: "Expired Chrome",
      ttlMs: 10_000,
    });
    const now = Date.now();
    await t.run(async (ctx) => {
      const presence = await ctx.db
        .query("workspacePresence")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", "sweep-expired-chrome"))
        .unique();
      if (presence) await ctx.db.patch(presence._id, { expiresAt: now - 1 });
    });

    await t.mutation(sweepExpiredPresence, {});

    const presence = await t.run((ctx) =>
      ctx.db
        .query("workspacePresence")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", "sweep-expired-chrome"))
        .unique(),
    );
    expect(presence).toMatchObject({ state: "offline" });
  });

  test("leaves a non-expired online presence lease untouched", async () => {
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({ subject: "sweep-owner-2" });
    await signedIn.mutation(registerComputer, {
      installationId: "sweep-live-chrome",
      label: "Live Chrome",
      ttlMs: 60_000,
    });

    await t.mutation(sweepExpiredPresence, {});

    const presence = await t.run((ctx) =>
      ctx.db
        .query("workspacePresence")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", "sweep-live-chrome"))
        .unique(),
    );
    expect(presence).toMatchObject({ state: "online" });
  });

  test("sweeps an expired pending cursor delivery to failed/expired identically to synthesized status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "sweep-delivery-owner" });
    const phone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "sweep-delivery-phone",
      label: "Alice phone",
    });
    await alice.mutation(registerComputer, {
      installationId: "sweep-delivery-chrome",
      label: "Alice Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "sweep-delivery-batch",
      clientCreatedAt: Date.now(),
      results: [result("sweep-delivery-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "sweep-delivery-delivery",
      resultId: "sweep-delivery-result",
      targetDeviceId: "sweep-delivery-chrome",
      kind: "text",
      text: "sweep-delivery-result",
      clientCreatedAt: Date.now(),
    });

    vi.advanceTimersByTime(CURSOR_DELIVERY_TTL_MS + 1);
    await t.mutation(sweepExpiredCursorDeliveries, {});

    const stored = await t.run((ctx) => ctx.db.query("cursorDeliveries").unique());
    expect(stored).toMatchObject({ state: "failed", errorCode: "expired" });
    expect(stored?.deliveredAt).toBeUndefined();
    expect(stored?.attempts).toBe(0);

    // cursorDeliveryStatus reports the swept row exactly as it would have
    // synthesized it on the fly before the sweep ran.
    const { statuses } = await t.query(cursorDeliveryStatus, {
      ...credential,
      deliveryIds: ["sweep-delivery-delivery"],
    });
    expect(statuses).toEqual([
      { deliveryId: "sweep-delivery-delivery", state: "failed", errorCode: "expired" },
    ]);

    // A swept delivery must not resurface as pending for the extension.
    expect(await alice.query(pendingCursorDeliveries, {
      installationId: "sweep-delivery-chrome",
    })).toEqual([]);
  });

  test("leaves a non-expired pending cursor delivery untouched by the sweep", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "sweep-delivery-owner-2" });
    const phone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "sweep-delivery-live-phone",
      label: "Alice phone",
    });
    await alice.mutation(registerComputer, {
      installationId: "sweep-delivery-live-chrome",
      label: "Alice Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "sweep-delivery-live-batch",
      clientCreatedAt: Date.now(),
      results: [result("sweep-delivery-live-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "sweep-delivery-live-delivery",
      resultId: "sweep-delivery-live-result",
      targetDeviceId: "sweep-delivery-live-chrome",
      kind: "text",
      text: "sweep-delivery-live-result",
      clientCreatedAt: Date.now(),
    });

    await t.mutation(sweepExpiredCursorDeliveries, {});

    const stored = await t.run((ctx) => ctx.db.query("cursorDeliveries").unique());
    expect(stored).toMatchObject({ state: "pending" });
    expect(await alice.query(pendingCursorDeliveries, {
      installationId: "sweep-delivery-live-chrome",
    })).toHaveLength(1);
  });

  test("acknowledging a delivery the sweeper already expired does not throw", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T12:00:00Z"));
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "sweep-ack-race-owner" });
    const phone = await alice.mutation(bootstrapMobileDevice, {
      installationId: "sweep-ack-race-phone",
      label: "Alice phone",
    });
    await alice.mutation(registerComputer, {
      installationId: "sweep-ack-race-chrome",
      label: "Alice Chrome",
      capabilities: ["cursor-insertion"],
    });
    const credential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(putBatch, {
      ...credential,
      batchId: "sweep-ack-race-batch",
      clientCreatedAt: Date.now(),
      results: [result("sweep-ack-race-result")],
    });
    await t.mutation(queueCursorDelivery, {
      ...credential,
      deliveryId: "sweep-ack-race-delivery",
      resultId: "sweep-ack-race-result",
      targetDeviceId: "sweep-ack-race-chrome",
      kind: "text",
      text: "sweep-ack-race-result",
      clientCreatedAt: Date.now(),
    });

    vi.advanceTimersByTime(CURSOR_DELIVERY_TTL_MS + 1);
    await t.mutation(sweepExpiredCursorDeliveries, {});

    // The extension was mid-flight delivering when the sweeper ran; its
    // acknowledgement lands on an already-swept row and must resolve
    // idempotently rather than throw.
    const ack = await alice.mutation(acknowledgeCursorDelivery, {
      installationId: "sweep-ack-race-chrome",
      deliveryId: "sweep-ack-race-delivery",
      state: "delivered",
    });
    expect(ack).toMatchObject({ state: "failed", idempotent: true });
  });
});
