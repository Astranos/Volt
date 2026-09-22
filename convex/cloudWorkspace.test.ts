import { convexTest } from "convex-test";

import { afterEach, describe, expect, test, vi } from "vitest";

import schema from "./schema";
import {
  authorizeGuestPhotoAccess,
  bootstrapMobileDevice,
  clearDictationDraft,
  grantFullAppAccess,
  guestGrant,
  listComputersForGuest,
  liveDictationDraftsForComputer,
  markGuestBatchReady,
  modules,
  pendingCursorDeliveries,
  putBatch,
  putGuestBatch,
  queueCursorDelivery,
  queueGuestCursorDelivery,
  registerComputer,
  restoreWorkspaceTestEnvironment,
  result,
  startGuestUsageSession,
  updateDictationDraft,
} from "./cloudWorkspace.testSupport";

afterEach(restoreWorkspaceTestEnvironment);

describe("cloud scanner workspace guests", () => {

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

  test("lets an App Clip guest list workspace computers and queue typing to its selected computer", async () => {
    const t = convexTest(schema, modules);
    const ownerId = "guest-target-owner";
    const grant = await guestGrant(t, ownerId);
    await startGuestUsageSession(t, ownerId);
    await grantFullAppAccess(t, ownerId);
    const signedIn = t.withIdentity({ subject: ownerId });
    await signedIn.mutation(registerComputer, {
      installationId: "guest-target-chrome",
      label: "Front Counter",
      capabilities: ["cursor-insertion"],
      ttlMs: 120_000,
    });

    const guestCredential = { guestCloudGrant: grant.guestCloudGrant };
    expect(await t.query(listComputersForGuest, guestCredential)).toEqual({
      computers: [{
        deviceId: "guest-target-chrome",
        label: "Front Counter",
        capabilities: ["cursor-insertion"],
        online: true,
      }],
    });

    await t.mutation(putGuestBatch, {
      ...guestCredential,
      batchId: "guest-target-batch",
      clientCreatedAt: 1,
      results: [result("guest-target-result")],
    });
    await expect(t.mutation(queueGuestCursorDelivery, {
      ...guestCredential,
      deliveryId: "guest-target-delivery",
      resultId: "guest-target-result",
      targetDeviceId: "guest-target-chrome",
      kind: "text",
      text: "guest-target-result",
      clientCreatedAt: Date.now(),
    })).resolves.toMatchObject({ state: "pending" });

    expect(await signedIn.query(pendingCursorDeliveries, {
      installationId: "guest-target-chrome",
    })).toEqual([expect.objectContaining({
      deliveryId: "guest-target-delivery",
      sourceDeviceId: expect.stringMatching(/^appclip:/),
      targetDeviceId: "guest-target-chrome",
    })]);
  });

  test("streams an authenticated iPhone dictation draft and delivers the final transcript as text", async () => {
    const t = convexTest(schema, modules);
    const ownerId = "iphone-dictation-owner";
    await grantFullAppAccess(t, ownerId);
    const signedIn = t.withIdentity({ subject: ownerId });
    const phone = await signedIn.mutation(bootstrapMobileDevice, {
      installationId: "iphone-dictation",
      label: "Warehouse iPhone",
    });
    await signedIn.mutation(registerComputer, {
      installationId: "iphone-dictation-chrome",
      label: "Shipping Desk",
      capabilities: ["cursor-insertion"],
      ttlMs: 120_000,
    });

    const phoneCredential = { deviceId: phone.deviceId, deviceSecret: phone.deviceSecret };
    await t.mutation(updateDictationDraft, {
      ...phoneCredential,
      draftId: "iphone-live-draft",
      targetDeviceId: "iphone-dictation-chrome",
      text: "Provisional transcript from Speech",
    });
    expect(await signedIn.query(liveDictationDraftsForComputer, {
      installationId: "iphone-dictation-chrome",
    })).toEqual([expect.objectContaining({
      draftId: "iphone-live-draft",
      text: "Provisional transcript from Speech",
    })]);

    await t.mutation(putBatch, {
      ...phoneCredential,
      batchId: "iphone-dictation-batch",
      clientCreatedAt: 1,
      results: [{
        resultId: "iphone-live-draft",
        kind: "dictation",
        text: "Final Speech transcript",
        format: "dictation",
        byteCount: 10,
        clientCreatedAt: 1,
      }],
    });
    await expect(t.mutation(queueCursorDelivery, {
      ...phoneCredential,
      deliveryId: "iphone-dictation-delivery",
      resultId: "iphone-live-draft",
      targetDeviceId: "iphone-dictation-chrome",
      kind: "text",
      text: "Final Speech transcript",
      format: "dictation",
      clientCreatedAt: Date.now(),
    })).resolves.toMatchObject({ state: "pending" });
    expect(await t.mutation(clearDictationDraft, {
      ...phoneCredential,
      draftId: "iphone-live-draft",
    })).toEqual({ cleared: true });
    expect(await signedIn.query(liveDictationDraftsForComputer, {
      installationId: "iphone-dictation-chrome",
    })).toEqual([]);
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
});
