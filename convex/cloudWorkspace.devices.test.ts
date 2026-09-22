import { convexTest } from "convex-test";

import { afterEach, describe, expect, test, vi } from "vitest";

import schema from "./schema";
import {
  bootstrapMobileDevice,
  createEnrollment,
  enroll,
  ensureWorkspace,
  exchangeEnrollment,
  getAccessStatus,
  grantFullAppAccess,
  listComputersForDevice,
  modules,
  pendingCursorDeliveries,
  putBatch,
  queueCursorDelivery,
  registerComputer,
  restoreWorkspaceTestEnvironment,
  result,
  revokeDevice,
  setCursorTarget,
  sweepExpiredPresence,
} from "./cloudWorkspace.testSupport";

afterEach(restoreWorkspaceTestEnvironment);

describe("cloud scanner workspace devices", () => {

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

  test("requires a full-app entitlement before creating a durable workspace device", async () => {
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({ subject: "locked-user" });

    await expect(signedIn.mutation(createEnrollment, {
      kind: "ios",
      label: "Locked iPhone",
    })).rejects.toThrow(/subscription or complimentary access required/);
  });

  test("treats a non-entitled computer heartbeat as a successful no-op", async () => {
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({ subject: "locked-computer-user" });

    await expect(signedIn.mutation(registerComputer, {
      installationId: "locked-computer",
      label: "Locked Chrome",
      capabilities: ["cursor-insertion"],
    })).resolves.toBeNull();

    expect(await t.run((ctx) => ctx.db.query("workspaceDevices").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("workspacePresence").collect())).toEqual([]);
  });

  test("grants full cloud access to complimentary email accounts", async () => {
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
    const results = Array.from({ length: 101 }, (_, index) =>
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

  test("requires Clerk authentication to create account workspaces", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(ensureWorkspace, {})).rejects.toThrow(/Authentication required/);
  });

  test("rebinds a signed-in Chrome installation across accounts without leaking pending deliveries", async () => {
    const t = convexTest(schema, modules);
    await grantFullAppAccess(t, "computer-owner");
    await grantFullAppAccess(t, "different-owner");
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

  test("bootstraps only iOS credentials, rotates them, and rejects cross-workspace rotation", async () => {
    const t = convexTest(schema, modules);
    await grantFullAppAccess(t, "bootstrap-alice");
    await grantFullAppAccess(t, "bootstrap-bob");
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
    await grantFullAppAccess(t, "computer-list-owner");
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
    await grantFullAppAccess(t, "cursor-target-alice");
    await grantFullAppAccess(t, "cursor-target-bob");
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

  test("sweeps an expired online presence lease to offline", async () => {
    const t = convexTest(schema, modules);
    await grantFullAppAccess(t, "sweep-owner");
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
    await grantFullAppAccess(t, "sweep-owner-2");
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
});
