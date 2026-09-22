import { makeFunctionReference } from "convex/server";
import { v, type ObjectType } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";

const reboundDraftArgs = {
  workspaceId: v.id("workspaces"),
  targetDeviceId: v.string(),
  targetRegistrationId: v.optional(v.id("workspaceDevices")),
};
const purgeReboundDrafts = makeFunctionReference<"mutation", ObjectType<typeof reboundDraftArgs>, null>(
  "workspaceMaintenance:purgeReboundDictationDrafts",
);
const DRAFT_CLEANUP_BATCH_SIZE = 100;

export async function purgeReboundDictationDraftsBatch(ctx: MutationCtx, args: ObjectType<typeof reboundDraftArgs>) {
  const drafts = await ctx.db.query("dictationDrafts")
    .withIndex("by_workspaceId_and_targetDeviceId_and_targetRegistrationId_and_expiresAt", q =>
      q.eq("workspaceId", args.workspaceId).eq("targetDeviceId", args.targetDeviceId)
        .eq("targetRegistrationId", args.targetRegistrationId),
    )
    .paginate({ numItems: DRAFT_CLEANUP_BATCH_SIZE, cursor: null, maximumBytesRead: 2_000_000 });
  for (const draft of drafts.page) await ctx.db.delete(draft._id);
  // Deleted rows leave the index, so the next bounded transaction starts at
  // its beginning rather than retaining a cursor across destructive updates.
  if (!drafts.isDone) await ctx.scheduler.runAfter(0, purgeReboundDrafts, args);
  else if (args.targetRegistrationId !== undefined) {
    await ctx.scheduler.runAfter(0, purgeReboundDrafts, {
      workspaceId: args.workspaceId, targetDeviceId: args.targetDeviceId,
    });
  }
}

export const purgeReboundDictationDrafts = internalMutation({
  args: reboundDraftArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    // The retired registration ID never matches fresh drafts after a reclaim.
    // A separate phase removes pre-migration rows without a registration ID.
    await purgeReboundDictationDraftsBatch(ctx, args);
    return null;
  },
});
