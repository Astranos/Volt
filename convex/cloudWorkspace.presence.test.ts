import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { enroll, listComputersForDevice, modules, registerComputer, restoreWorkspaceTestEnvironment, sweepExpiredPresence } from "./cloudWorkspace.testSupport";

afterEach(restoreWorkspaceTestEnvironment);

test("presence sweeping chains bounded pages until all expired online leases are processed", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  await enroll(t, "presence-owner");
  await t.run(async ctx => {
    const workspace = await ctx.db.query("workspaces").unique();
    if (!workspace) throw new Error("Missing workspace");
    for (let index = 0; index < 1200; index++) await ctx.db.insert("workspacePresence", {
      workspaceId: workspace._id, deviceId: `already-offline-${index}`, state: "offline", capabilities: [], lastSeenAt: 1, expiresAt: 1,
    });
    for (let index = 0; index < 501; index++) await ctx.db.insert("workspacePresence", {
      workspaceId: workspace._id, deviceId: `expired-${index}`, state: "online", capabilities: [], lastSeenAt: 1, expiresAt: 1,
    });
    await ctx.db.insert("workspacePresence", {
      workspaceId: workspace._id, deviceId: "fresh", state: "online", capabilities: [], lastSeenAt: Date.now(), expiresAt: Date.now() + 60_000,
    });
  });
  const onlineIds = () => t.run(async ctx => (await ctx.db.query("workspacePresence")
    .withIndex("by_state_and_expiresAt", q => q.eq("state", "online")).collect()).map(row => row.deviceId));
  await t.mutation(sweepExpiredPresence, {});
  expect(await onlineIds()).toEqual(["expired-500", "fresh"]);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await onlineIds()).toEqual(["fresh"]);
  await t.mutation(sweepExpiredPresence, {});
  expect(await onlineIds()).toEqual(["fresh"]);
});

test("shared computer listing preserves account timestamps and scanner response shape", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  const t = convexTest(schema, modules);
  const owner = await enroll(t, "listing-owner");
  await owner.signedIn.mutation(registerComputer, {
    installationId: "listing-desk", label: "Desk", capabilities: ["Cursor-Insertion"],
  });
  // Preserve the legacy account projection even for an old unnormalized row.
  await t.run(async ctx => {
    const presence = await ctx.db.query("workspacePresence").unique();
    if (!presence) throw new Error("Missing presence");
    await ctx.db.patch(presence._id, { capabilities: ["Cursor-Insertion"] });
  });
  expect(await owner.signedIn.query(api.cloudWorkspace.listComputers, {})).toEqual([{
    deviceId: "listing-desk", label: "Desk", online: true, capabilities: ["Cursor-Insertion"], lastSeenAt: 100_000,
  }]);
  expect(await t.query(listComputersForDevice, owner.credential)).toEqual({
    cursorTargetDeviceId: null,
    computers: [{ deviceId: "listing-desk", label: "Desk", online: true, capabilities: ["cursor-insertion"] }],
  });
});
