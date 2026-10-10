import { v, ConvexError, type ObjectType } from "convex/values";
import { type MutationCtx, type QueryCtx } from "../_generated/server";
import { type Id, type Doc } from "../_generated/dataModel";
import {
  type Principal,
  credentialArgs,
  requireDevicePrincipal,
  guestCredentialArgs,
  requireGuestPrincipal,
  requireAuthenticatedWorkspace,
  requireOrCreateAuthenticatedWorkspace,
} from "./identity";
import { assertWorkspaceWritable, adjustWorkspaceStorage, managedResultByteCount, reserveWorkspaceStorage, resultExpiredForPolicy, WORKSPACE_UNDO_MS } from "../workspaceStorage";
import { accountPolicy, workspaceLifecycleEnabled } from "../monetization";

const resultInput = v.object({
  resultId: v.string(),
  kind: v.union(v.literal("text"), v.literal("barcode"), v.literal("photo"), v.literal("dictation")),
  text: v.optional(v.string()),
  format: v.optional(v.string()),
  contentType: v.optional(v.string()),
  byteCount: v.number(),
  checksum: v.optional(v.string()),
  clientCreatedAt: v.number(),
});

type CloudResultInput = {
  resultId: string;
  kind: "text" | "barcode" | "photo" | "dictation";
  text?: string;
  format?: string;
  contentType?: string;
  byteCount: number;
  checksum?: string;
  clientCreatedAt: number;
};

type CloudBatchInput = {
  batchId: string;
  clientCreatedAt: number;
  results: CloudResultInput[];
};

async function insertBatchResults(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  sourceDeviceId: string,
  batchId: string,
  results: CloudBatchInput["results"],
  now: number,
  tier: "free" | "workspace" | null,
) {
  for (const result of results) {
    const objectKey = result.kind === "photo"
      ? `workspaces/${workspaceId}/batches/${encodeURIComponent(batchId)}/${encodeURIComponent(result.resultId)}`
      : undefined;
    await ctx.db.insert("scanResults", {
      workspaceId,
      batchId,
      resultId: result.resultId,
      sourceDeviceId,
      kind: result.kind,
      ...(result.text !== undefined ? { text: result.text } : {}),
      ...(result.format !== undefined ? { format: result.format } : {}),
      ...(objectKey ? { objectKey } : {}),
      ...(result.contentType ? { contentType: result.contentType } : {}),
      byteCount: result.byteCount,
      ...(result.checksum ? { checksum: result.checksum } : {}),
      clientCreatedAt: result.clientCreatedAt,
      createdAt: now,
      ...(tier ? { storageManaged: true, retentionTier: tier, retentionCheckAt: now + 24 * 60 * 60 * 1000, ...(tier === "free" ? { expiresAt: now + 7 * 24 * 60 * 60 * 1000 } : {}) } : {}),
    });
  }
}

async function assertResultsAreBatchCompatible(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  results: CloudBatchInput["results"],
) {
  const seen = new Set<string>();
  for (const result of results) {
    if (seen.has(result.resultId)) throw new ConvexError("Duplicate result id in batch");
    seen.add(result.resultId);
    const conflicting = await ctx.db
      .query("scanResults")
      .withIndex("by_workspaceId_and_resultId", (q) =>
        q.eq("workspaceId", workspaceId).eq("resultId", result.resultId),
      )
      .first();
    if (conflicting) throw new ConvexError("Result id already belongs to another batch");
  }
}

async function putBatchForPrincipal(
  ctx: MutationCtx,
  principal: Principal,
  args: CloudBatchInput,
) {
    const { workspace, sourceDeviceId } = principal;
    const normalizedResults = workspaceLifecycleEnabled()
      ? args.results.map(result => ({ ...result, byteCount: managedResultByteCount(result) }))
      : args.results;
    if (args.results.length === 0) throw new ConvexError("A batch must contain at least one result");
    if (args.results.length > 500) throw new ConvexError("A batch may contain at most 500 results");
    const existing = await ctx.db
      .query("resultBatches")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
      )
      .unique();
    if (existing) {
      if (existing.sourceDeviceId !== sourceDeviceId) {
        throw new ConvexError("Batch id belongs to another source");
      }
      if (existing.status === "deleted") {
        throw new ConvexError("Batch was deleted");
      }

      const existingResults = await ctx.db
        .query("scanResults")
        .withIndex("by_workspaceId_and_batchId", (q) =>
          q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
        )
        .take(500);
      const existingIds = new Set(existingResults.map((item) => item.resultId));
      const appendedResults = normalizedResults.filter((result) => !existingIds.has(result.resultId));
      if (appendedResults.length === 0) {
        return { batchId: existing.batchId, idempotent: true, status: existing.status };
      }
      const policyForExisting = (await accountPolicy(ctx, workspace.ownerClerkUserId)).workspace;
      for (const result of existingResults) {
        if (result.deletedAt !== undefined || resultExpiredForPolicy(result, policyForExisting)) throw new ConvexError("Cannot append to a batch with deleted or expired results");
      }
      if (existingResults.length + appendedResults.length > 500) {
        throw new ConvexError("A batch may contain at most 500 results");
      }

      await assertResultsAreBatchCompatible(ctx, workspace._id, appendedResults);
      const addedBytes = appendedResults.reduce((sum, result) => sum + result.byteCount, 0);
      const now = Date.now();
      const policy = await reserveWorkspaceStorage(ctx, workspace, appendedResults.length, addedBytes, now);
      await insertBatchResults(
        ctx,
        workspace._id,
        sourceDeviceId,
        args.batchId,
        appendedResults,
        now,
        policy?.tier ?? null,
      );
      await ctx.db.patch(existing._id, {
        status: "uploading",
        resultCount: existing.resultCount + appendedResults.length,
        byteCount: existing.byteCount + addedBytes,
        updatedAt: now,
      });
      return { batchId: args.batchId, idempotent: false, status: "uploading" as const };
    }

    await assertResultsAreBatchCompatible(ctx, workspace._id, normalizedResults);
    const byteCount = normalizedResults.reduce((sum, result) => sum + result.byteCount, 0);
    const now = Date.now();
    const policy = await reserveWorkspaceStorage(ctx, workspace, normalizedResults.length, byteCount, now);
    await ctx.db.insert("resultBatches", {
      workspaceId: workspace._id,
      batchId: args.batchId,
      sourceDeviceId,
      clientCreatedAt: args.clientCreatedAt,
      status: "uploading",
      resultCount: args.results.length,
      byteCount,
      createdAt: now,
      updatedAt: now,
    });
    await insertBatchResults(
      ctx,
      workspace._id,
      sourceDeviceId,
      args.batchId,
      normalizedResults,
      now,
      policy?.tier ?? null,
    );
    return { batchId: args.batchId, idempotent: false, status: "uploading" as const };
}

export const putBatchArgs = {
    ...credentialArgs,
    batchId: v.string(),
    clientCreatedAt: v.number(),
    results: v.array(resultInput),
  };
export const putBatchHandler = async (ctx: MutationCtx, args: ObjectType<typeof putBatchArgs>) => {
    const principal = await requireDevicePrincipal(ctx, args);
    return putBatchForPrincipal(ctx, principal, args);
  };

export const putGuestBatchArgs = {
    ...guestCredentialArgs,
    batchId: v.string(),
    clientCreatedAt: v.number(),
    results: v.array(resultInput),
  };
export const putGuestBatchHandler = async (ctx: MutationCtx, args: ObjectType<typeof putGuestBatchArgs>) => {
    const principal = await requireGuestPrincipal(ctx, args);
    if (principal.guestGrant) {
      await ctx.db.patch(principal.guestGrant._id, { lastUsedAt: Date.now() });
    }
    return putBatchForPrincipal(ctx, principal, args);
  };

async function markBatchReadyForPrincipal(
  ctx: MutationCtx,
  principal: Principal,
  batchId: string,
) {
  const batch = await ctx.db
    .query("resultBatches")
    .withIndex("by_workspaceId_and_batchId", (q) =>
      q.eq("workspaceId", principal.workspace._id).eq("batchId", batchId),
    )
    .unique();
  if (!batch || batch.sourceDeviceId !== principal.sourceDeviceId) {
    throw new ConvexError("Batch not found");
  }
  if (batch.status === "deleted") throw new ConvexError("Batch was deleted");
  // A retry of a finished batch succeeds even after the workspace became read-only.
  if (batch.status === "ready") return { idempotent: true };
  await assertWorkspaceWritable(ctx, principal.workspace);
  const results = await ctx.db.query("scanResults").withIndex("by_workspaceId_and_batchId", q => q.eq("workspaceId", principal.workspace._id).eq("batchId", batchId)).take(500);
  const policy = (await accountPolicy(ctx, principal.workspace.ownerClerkUserId)).workspace;
  for (const result of results) {
    if (result.deletedAt !== undefined || resultExpiredForPolicy(result, policy)) throw new ConvexError("Batch contains deleted or expired results");
  }
  await ctx.db.patch(batch._id, { status: "ready", updatedAt: Date.now() });
  return { idempotent: false };
}

export const markBatchReadyArgs = { ...credentialArgs, batchId: v.string() };
export const markBatchReadyHandler = async (ctx: MutationCtx, args: ObjectType<typeof markBatchReadyArgs>) => {
    return markBatchReadyForPrincipal(ctx, await requireDevicePrincipal(ctx, args), args.batchId);
  };

export const markGuestBatchReadyArgs = { ...guestCredentialArgs, batchId: v.string() };
export const markGuestBatchReadyHandler = async (ctx: MutationCtx, args: ObjectType<typeof markGuestBatchReadyArgs>) => {
    return markBatchReadyForPrincipal(ctx, await requireGuestPrincipal(ctx, args), args.batchId);
  };

export const listBatchesArgs = {};
export const listBatchesHandler = async (ctx: QueryCtx) => {
    const workspace = await requireAuthenticatedWorkspace(ctx);
    return ctx.db
      .query("resultBatches")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(100);
  };

export const listBatchResultsArgs = { batchId: v.string() };
export const listBatchResultsHandler = async (ctx: QueryCtx, args: ObjectType<typeof listBatchResultsArgs>) => {
    const workspace = await requireAuthenticatedWorkspace(ctx);
    const results = await ctx.db
      .query("scanResults")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
      )
      .take(500);
    const visible = [];
    const policy = (await accountPolicy(ctx, workspace.ownerClerkUserId)).workspace;
    for (const result of results) {
      if (result.deletedAt !== undefined || resultExpiredForPolicy(result, policy)) {
        const { text: _text, objectKey: _objectKey, ...tombstone } = result;
        visible.push({ ...tombstone, deletedAt: result.deletedAt ?? Date.now() });
      } else visible.push(result);
    }
    return visible;
  };

export const deleteWorkspaceResultsArgs = { resultIds: v.array(v.string()) };
export const deleteWorkspaceResultsHandler = async (ctx: MutationCtx, args: ObjectType<typeof deleteWorkspaceResultsArgs>) => {
    const workspace = await requireOrCreateAuthenticatedWorkspace(ctx);
    const requestedIds = [...new Set(args.resultIds)].slice(0, 500);
    const now = Date.now();
    const policy = (await accountPolicy(ctx, workspace.ownerClerkUserId, now)).workspace;
    const affectedBatches = new Map<string, { resultCount: number; byteCount: number }>();
    const deletedIds: string[] = [];
    const newlyDeletedIds: string[] = [];
    let deleted = 0;
    let idempotent = 0;
    for (const resultId of requestedIds) {
      const result = await ctx.db
        .query("scanResults")
        .withIndex("by_workspaceId_and_resultId", (q) =>
          q.eq("workspaceId", workspace._id).eq("resultId", resultId),
        )
        .first();
      if (!result) continue;
      deletedIds.push(resultId);
      if (result.deletedAt !== undefined) {
        idempotent += 1;
        continue;
      }
      await ctx.db.patch(result._id, { deletedAt: now, ...(result.storageManaged ? { purgeAfter: now + WORKSPACE_UNDO_MS, retentionCheckAt: undefined, ...(resultExpiredForPolicy(result, policy, now) ? { expiresAt: now } : { expiresAt: undefined }) } : {}) });
      if (result.storageManaged) await adjustWorkspaceStorage(ctx, workspace._id, -1, 0);
      newlyDeletedIds.push(resultId);
      deleted += 1;
      const adjustment = affectedBatches.get(result.batchId) ?? { resultCount: 0, byteCount: 0 };
      adjustment.resultCount += 1;
      adjustment.byteCount += result.byteCount;
      affectedBatches.set(result.batchId, adjustment);
    }
    for (const [batchId, adjustment] of affectedBatches) {
      const batch = await ctx.db
        .query("resultBatches")
        .withIndex("by_workspaceId_and_batchId", (q) =>
          q.eq("workspaceId", workspace._id).eq("batchId", batchId),
        )
        .unique();
      if (!batch) continue;
      await ctx.db.patch(batch._id, {
        resultCount: Math.max(0, batch.resultCount - adjustment.resultCount),
        byteCount: Math.max(0, batch.byteCount - adjustment.byteCount),
        updatedAt: now,
      });
    }
    return {
      deletedIds,
      newlyDeletedIds,
      deleted,
      idempotent,
      requested: requestedIds.length,
      revision: now,
    };
  };

export const restoreWorkspaceResultsArgs = { resultIds: v.array(v.string()) };
export const restoreWorkspaceResultsHandler = async (ctx: MutationCtx, args: ObjectType<typeof restoreWorkspaceResultsArgs>) => {
    const workspace = await requireOrCreateAuthenticatedWorkspace(ctx);
    const requestedIds = [...new Set(args.resultIds)].slice(0, 500);
    const matches: Array<Doc<"scanResults">> = [];
    const now = Date.now();
    const policy = (await accountPolicy(ctx, workspace.ownerClerkUserId, now)).workspace;
    const restoredIds: string[] = [];
    const newlyRestoredIds: string[] = [];
    for (const resultId of requestedIds) {
      const result = await ctx.db
        .query("scanResults")
        .withIndex("by_workspaceId_and_resultId", (q) =>
          q.eq("workspaceId", workspace._id).eq("resultId", resultId),
        )
        .first();
      if (!result) continue;
      if (result.storageManaged && (result.objectPurgedAt !== undefined || (result.deletedAt !== undefined && result.deletedAt + WORKSPACE_UNDO_MS <= now) || resultExpiredForPolicy(result, policy, now))) {
        throw new ConvexError("Expired workspace results cannot be restored");
      }
      restoredIds.push(resultId);
      if (result.deletedAt !== undefined) matches.push(result);
    }
    if (matches.length) await assertWorkspaceWritable(ctx, workspace, now);
    const managedCount = matches.filter(result => result.storageManaged).length;
    if (managedCount) {
      if (workspaceLifecycleEnabled()) await reserveWorkspaceStorage(ctx, workspace, managedCount, 0, now);
      else await adjustWorkspaceStorage(ctx, workspace._id, managedCount, 0);
    }
    const affectedBatches = new Map<string, { resultCount: number; byteCount: number }>();
    for (const result of matches) {
      await ctx.db.patch(result._id, { deletedAt: undefined, ...(result.storageManaged ? { purgeAfter: undefined, retentionCheckAt: now + 24 * 60 * 60 * 1000 } : {}) });
      newlyRestoredIds.push(result.resultId);
      const adjustment = affectedBatches.get(result.batchId) ?? { resultCount: 0, byteCount: 0 };
      adjustment.resultCount += 1;
      adjustment.byteCount += result.byteCount;
      affectedBatches.set(result.batchId, adjustment);
    }
    for (const [batchId, adjustment] of affectedBatches) {
      const batch = await ctx.db
        .query("resultBatches")
        .withIndex("by_workspaceId_and_batchId", (q) =>
          q.eq("workspaceId", workspace._id).eq("batchId", batchId),
        )
        .unique();
      if (!batch) continue;
      await ctx.db.patch(batch._id, {
        resultCount: batch.resultCount + adjustment.resultCount,
        byteCount: batch.byteCount + adjustment.byteCount,
        updatedAt: now,
      });
    }
    return {
      restoredIds,
      newlyRestoredIds,
      restored: newlyRestoredIds.length,
      idempotent: restoredIds.length - newlyRestoredIds.length,
      requested: requestedIds.length,
      revision: now,
    };
  };
