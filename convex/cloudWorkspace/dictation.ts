import { credentialArgs, requireDevicePrincipal, type Principal, requireAuthenticatedWorkspace } from "./identity";
import { v, ConvexError, type ObjectType } from "convex/values";
import { type MutationCtx, type QueryCtx } from "../_generated/server";

export const DICTATION_DRAFT_TTL_MS = 5 * 60 * 1000;

export const updateDictationDraftArgs = {
    ...credentialArgs,
    draftId: v.string(),
    targetDeviceId: v.string(),
    text: v.string(),
  };
export const updateDictationDraftReturns = v.object({ draftId: v.string(), updatedAt: v.number() });
export const updateDictationDraftHandler = async (ctx: MutationCtx, args: ObjectType<typeof updateDictationDraftArgs>) => {
    return upsertDictationDraft(ctx, await requireDevicePrincipal(ctx, args), args);
  };

export const clearDictationDraftArgs = { ...credentialArgs, draftId: v.string() };
export const clearDictationDraftReturns = v.object({ cleared: v.boolean() });
export const clearDictationDraftHandler = async (ctx: MutationCtx, args: ObjectType<typeof clearDictationDraftArgs>) => {
    return clearDictationDraftForPrincipal(
      ctx,
      await requireDevicePrincipal(ctx, args),
      args.draftId,
    );
  };

async function upsertDictationDraft(
  ctx: MutationCtx,
  principal: Principal,
  args: { draftId: string; targetDeviceId: string; text: string },
): Promise<{ draftId: string; updatedAt: number }> {
  if (!args.draftId.trim() || args.text.length > 100_000) {
    throw new ConvexError("Invalid dictation draft");
  }
  const target = await ctx.db
    .query("workspaceDevices")
    .withIndex("by_deviceId", (q) => q.eq("deviceId", args.targetDeviceId))
    .unique();
  if (
    !target
    || target.workspaceId !== principal.workspace._id
    || target.kind !== "chrome"
    || target.revokedAt !== undefined
  ) {
    throw new ConvexError("Target computer not found");
  }
  const existing = await ctx.db
    .query("dictationDrafts")
    .withIndex("by_workspaceId_and_draftId", (q) =>
      q.eq("workspaceId", principal.workspace._id).eq("draftId", args.draftId),
    )
    .unique();
  const now = Date.now();
  const value = {
    targetDeviceId: target.deviceId,
    targetRegistrationId: target._id,
    text: args.text,
    updatedAt: now,
    expiresAt: now + DICTATION_DRAFT_TTL_MS,
  };
  if (existing) {
    if (existing.sourceDeviceId !== principal.sourceDeviceId) {
      throw new ConvexError("Dictation draft id conflicts with another source");
    }
    await ctx.db.patch(existing._id, value);
  } else {
    await ctx.db.insert("dictationDrafts", {
      workspaceId: principal.workspace._id,
      draftId: args.draftId,
      sourceDeviceId: principal.sourceDeviceId,
      ...value,
    });
  }
  return { draftId: args.draftId, updatedAt: now };
}

async function clearDictationDraftForPrincipal(
  ctx: MutationCtx,
  principal: Principal,
  draftId: string,
): Promise<{ cleared: boolean }> {
  const existing = await ctx.db
    .query("dictationDrafts")
    .withIndex("by_workspaceId_and_draftId", (q) =>
      q.eq("workspaceId", principal.workspace._id).eq("draftId", draftId),
    )
    .unique();
  if (!existing) return { cleared: false };
  if (existing.sourceDeviceId !== principal.sourceDeviceId) {
    throw new ConvexError("Dictation draft does not belong to this device");
  }
  await ctx.db.delete(existing._id);
  return { cleared: true };
}

export const liveDictationDraftsForComputerArgs = { installationId: v.string() };
export const liveDictationDraftsForComputerReturns = v.array(v.object({
    draftId: v.string(),
    text: v.string(),
    updatedAt: v.number(),
  }));
export const liveDictationDraftsForComputerHandler = async (ctx: QueryCtx, args: ObjectType<typeof liveDictationDraftsForComputerArgs>) => {
    const workspace = await requireAuthenticatedWorkspace(ctx);
    const computer = await ctx.db
      .query("workspaceDevices")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.installationId))
      .unique();
    if (
      !computer
      || computer.workspaceId !== workspace._id
      || computer.kind !== "chrome"
      || computer.revokedAt !== undefined
    ) {
      return [];
    }
    const now = Date.now();
    const draftsForRegistration = (registrationId: typeof computer._id | undefined) => ctx.db
      .query("dictationDrafts")
      .withIndex("by_workspaceId_targetDeviceId_targetRegistration_expires", q =>
        q.eq("workspaceId", workspace._id).eq("targetDeviceId", computer.deviceId)
          .eq("targetRegistrationId", registrationId).gt("expiresAt", now),
      ).order("desc").take(20);
    const bound = await draftsForRegistration(computer._id);
    // Pre-migration drafts remain visible on their original registration.
    // Rebound registrations accept only explicitly bound drafts.
    const legacy = computer.dictationBindingRequired ? [] : await draftsForRegistration(undefined);
    const drafts = [...bound, ...legacy]
      .sort((a, b) => b.expiresAt - a.expiresAt || b._creationTime - a._creationTime)
      .slice(0, 20);
    return drafts.map((draft) => ({
        draftId: draft.draftId,
        text: draft.text,
        updatedAt: draft.updatedAt,
      }));
  };
