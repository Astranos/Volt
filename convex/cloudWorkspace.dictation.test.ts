import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import {
  enroll,
  liveDictationDraftsForComputer,
  modules,
  registerComputer,
  restoreWorkspaceTestEnvironment,
  updateDictationDraft,
} from "./cloudWorkspace.testSupport";

afterEach(restoreWorkspaceTestEnvironment);

test("rebound computers cannot read the previous account's live dictation", async () => {
  const t = convexTest(schema, modules);
  const alice = await enroll(t, "dictation-alice");
  const bob = await enroll(t, "dictation-bob");
  await alice.signedIn.mutation(registerComputer, { installationId: "shared-computer", label: "Desk" });
  await t.mutation(updateDictationDraft, {
    ...alice.credential,
    draftId: "private-alice-draft",
    targetDeviceId: "shared-computer",
    text: "Alice's private transcript",
  });
  expect(await alice.signedIn.query(liveDictationDraftsForComputer, { installationId: "shared-computer" }))
    .toEqual([expect.objectContaining({ text: "Alice's private transcript" })]);

  await bob.signedIn.mutation(registerComputer, { installationId: "shared-computer", label: "Bob's desk" });
  expect(await bob.signedIn.query(liveDictationDraftsForComputer, { installationId: "shared-computer" })).toEqual([]);
  expect(await alice.signedIn.query(liveDictationDraftsForComputer, { installationId: "shared-computer" })).toEqual([]);
  expect(await t.run(ctx => ctx.db.query("dictationDrafts").collect())).toEqual([]);

  await expect(t.mutation(updateDictationDraft, {
    ...alice.credential, draftId: "late-alice-draft", targetDeviceId: "shared-computer", text: "No longer Alice's computer",
  })).rejects.toThrow(/Target computer not found/);
  await t.mutation(updateDictationDraft, {
    ...bob.credential, draftId: "bob-draft", targetDeviceId: "shared-computer", text: "Bob's transcript",
  });
  expect(await bob.signedIn.query(liveDictationDraftsForComputer, { installationId: "shared-computer" }))
    .toEqual([expect.objectContaining({ draftId: "bob-draft", text: "Bob's transcript" })]);
});

test("foreign stale drafts cannot crowd the current account's twenty-draft window", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-22T12:00:00Z"));
  const t = convexTest(schema, modules);
  const alice = await enroll(t, "old-dictation-owner");
  const bob = await enroll(t, "current-dictation-owner");
  await bob.signedIn.mutation(registerComputer, { installationId: "same-id", label: "Desk" });
  await t.mutation(updateDictationDraft, {
    ...bob.credential, draftId: "current-draft", targetDeviceId: "same-id", text: "Visible current transcript",
  });
  await t.run(async ctx => {
    const workspace = await ctx.db.query("workspaces")
      .withIndex("by_ownerClerkUserId", q => q.eq("ownerClerkUserId", "old-dictation-owner")).unique();
    if (!workspace) throw new Error("Missing test workspace");
    for (let index = 0; index < 25; index++) {
      await ctx.db.insert("dictationDrafts", {
        workspaceId: workspace._id, draftId: `old-${index}`, sourceDeviceId: alice.credential.deviceId,
        targetDeviceId: "same-id", text: "Previous tenant", updatedAt: Date.now(), expiresAt: Date.now() + 400_000,
      });
    }
  });
  expect(await bob.signedIn.query(liveDictationDraftsForComputer, { installationId: "same-id" }))
    .toEqual([expect.objectContaining({ draftId: "current-draft" })]);
});

test("rebind cleanup drains more than one bounded batch without touching other targets", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const alice = await enroll(t, "cleanup-alice");
  const bob = await enroll(t, "cleanup-bob");
  await alice.signedIn.mutation(registerComputer, { installationId: "cleanup-target", label: "Desk" });
  await t.run(async ctx => {
    const workspace = await ctx.db.query("workspaces")
      .withIndex("by_ownerClerkUserId", q => q.eq("ownerClerkUserId", "cleanup-alice")).unique();
    const target = await ctx.db.query("workspaceDevices")
      .withIndex("by_deviceId", q => q.eq("deviceId", "cleanup-target")).unique();
    if (!workspace || !target) throw new Error("Missing test workspace or target");
    for (let index = 0; index < 251; index++) {
      await ctx.db.insert("dictationDrafts", {
        workspaceId: workspace._id, draftId: `old-${index}`, sourceDeviceId: alice.credential.deviceId,
        targetDeviceId: index === 250 ? "another-target" : "cleanup-target",
        targetRegistrationId: target._id,
        text: "Old transcript", updatedAt: Date.now(), expiresAt: Date.now() + 300_000,
      });
    }
  });
  await bob.signedIn.mutation(registerComputer, { installationId: "cleanup-target", label: "Bob's desk" });
  expect((await t.run(ctx => ctx.db.query("dictationDrafts").collect())).length).toBe(151);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run(ctx => ctx.db.query("dictationDrafts").collect()))
    .toEqual([expect.objectContaining({ targetDeviceId: "another-target" })]);
});

test("delayed cleanup cannot delete fresh drafts after the original account reclaims a computer", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  const alice = await enroll(t, "reclaimed-alice");
  const bob = await enroll(t, "reclaimed-bob");
  await alice.signedIn.mutation(registerComputer, { installationId: "reclaimed-target", label: "Desk" });
  await t.run(async ctx => {
    const target = await ctx.db.query("workspaceDevices")
      .withIndex("by_deviceId", q => q.eq("deviceId", "reclaimed-target")).unique();
    if (!target) throw new Error("Missing target");
    for (let index = 0; index < 250; index++) await ctx.db.insert("dictationDrafts", {
      workspaceId: target.workspaceId, draftId: `retired-${index}`, sourceDeviceId: alice.credential.deviceId,
      targetDeviceId: target.deviceId, targetRegistrationId: target._id,
      text: "Retired transcript", updatedAt: Date.now(), expiresAt: Date.now() + 300_000,
    });
    await ctx.db.insert("dictationDrafts", {
      workspaceId: target.workspaceId, draftId: "legacy", sourceDeviceId: alice.credential.deviceId,
      targetDeviceId: target.deviceId,
      text: "Legacy unbound transcript", updatedAt: Date.now(), expiresAt: Date.now() + 300_000,
    });
  });
  await bob.signedIn.mutation(registerComputer, { installationId: "reclaimed-target", label: "Desk" });
  await alice.signedIn.mutation(registerComputer, { installationId: "reclaimed-target", label: "Desk" });
  await t.mutation(updateDictationDraft, {
    ...alice.credential, draftId: "fresh", targetDeviceId: "reclaimed-target", text: "Fresh transcript",
  });
  const workspaceId = await t.run(async ctx => {
    const workspace = await ctx.db.query("workspaces")
      .withIndex("by_ownerClerkUserId", q => q.eq("ownerClerkUserId", "reclaimed-alice")).unique();
    if (!workspace) throw new Error("Missing test workspace");
    return workspace._id;
  });
  await t.mutation(makeFunctionReference<"mutation", { workspaceId: Id<"workspaces">; targetDeviceId: string }, null>("workspaceMaintenance:purgeReboundDictationDrafts"), {
    workspaceId, targetDeviceId: "reclaimed-target",
  });
  expect(await alice.signedIn.query(liveDictationDraftsForComputer, { installationId: "reclaimed-target" }))
    .toEqual([expect.objectContaining({ draftId: "fresh" })]);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await t.run(ctx => ctx.db.query("dictationDrafts").collect()))
    .toEqual([expect.objectContaining({ draftId: "fresh" })]);
});

test("legacy drafts remain readable on the original device registration until updated", async () => {
  const t = convexTest(schema, modules);
  const owner = await enroll(t, "legacy-owner");
  await owner.signedIn.mutation(registerComputer, { installationId: "legacy-target", label: "Desk" });
  await t.run(async ctx => {
    const target = await ctx.db.query("workspaceDevices")
      .withIndex("by_deviceId", q => q.eq("deviceId", "legacy-target")).unique();
    if (!target) throw new Error("Missing target");
    await ctx.db.insert("dictationDrafts", {
      workspaceId: target.workspaceId, draftId: "legacy", sourceDeviceId: owner.credential.deviceId,
      targetDeviceId: target.deviceId, text: "Legacy transcript", updatedAt: Date.now(), expiresAt: Date.now() + 300_000,
    });
  });
  expect(await owner.signedIn.query(liveDictationDraftsForComputer, { installationId: "legacy-target" }))
    .toEqual([expect.objectContaining({ draftId: "legacy", text: "Legacy transcript" })]);
  await t.mutation(updateDictationDraft, {
    ...owner.credential, draftId: "legacy", targetDeviceId: "legacy-target", text: "Updated transcript",
  });
  expect(await t.run(ctx => ctx.db.query("dictationDrafts").unique()))
    .toMatchObject({ targetRegistrationId: expect.any(String), text: "Updated transcript" });
});
