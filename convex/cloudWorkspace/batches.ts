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
  authenticatedWorkspaceOrNull,
} from "./identity";

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
      const appendedResults = args.results.filter((result) => !existingIds.has(result.resultId));
      if (appendedResults.length === 0) {
        return { batchId: existing.batchId, idempotent: true, status: existing.status };
      }
      if (existingResults.length + appendedResults.length > 500) {
        throw new ConvexError("A batch may contain at most 500 results");
      }

      await assertResultsAreBatchCompatible(ctx, workspace._id, appendedResults);
      const addedBytes = appendedResults.reduce((sum, result) => sum + result.byteCount, 0);
      const now = Date.now();
      await insertBatchResults(
        ctx,
        workspace._id,
        sourceDeviceId,
        args.batchId,
        appendedResults,
        now,
      );
      await ctx.db.patch(existing._id, {
        status: "uploading",
        resultCount: existingResults.length + appendedResults.length,
        byteCount: existing.byteCount + addedBytes,
        updatedAt: now,
      });
      return { batchId: args.batchId, idempotent: false, status: "uploading" as const };
    }

    await assertResultsAreBatchCompatible(ctx, workspace._id, args.results);
    const byteCount = args.results.reduce((sum, result) => sum + result.byteCount, 0);
    const now = Date.now();
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
      args.results,
      now,
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
  if (batch.status === "ready") return { idempotent: true };
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
    return ctx.db
      .query("scanResults")
      .withIndex("by_workspaceId_and_batchId", (q) =>
        q.eq("workspaceId", workspace._id).eq("batchId", args.batchId),
      )
      .collect();
  };

export const deleteWorkspaceResultsArgs = { resultIds: v.array(v.string()) };
export const deleteWorkspaceResultsHandler = async (ctx: MutationCtx, args: ObjectType<typeof deleteWorkspaceResultsArgs>) => {
    const workspace = await requireOrCreateAuthenticatedWorkspace(ctx);
    const requestedIds = [...new Set(args.resultIds)].slice(0, 500);
    const now = Date.now();
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
      await ctx.db.patch(result._id, { deletedAt: now });
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
      restoredIds.push(resultId);
      if (result.deletedAt !== undefined) matches.push(result);
    }
    const now = Date.now();
    const affectedBatches = new Map<string, { resultCount: number; byteCount: number }>();
    for (const result of matches) {
      await ctx.db.patch(result._id, { deletedAt: undefined });
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

export const workspaceSnapshotArgs = {};
export const workspaceSnapshotHandler = async (ctx: QueryCtx) => {
    const workspace = await authenticatedWorkspaceOrNull(ctx);
    if (!workspace) return null;
    const batches = await ctx.db
      .query("resultBatches")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
      .order("desc")
      .take(100);
    const deliveries = await Promise.all(batches.map((batch) =>
      ctx.db
        .query("resultDeliveries")
        .withIndex("by_workspaceId_and_batchId", (q) =>
          q.eq("workspaceId", workspace._id).eq("batchId", batch.batchId),
        )
        .collect(),
    ));
    const results = await Promise.all(batches.map((batch) =>
      ctx.db
        .query("scanResults")
        .withIndex("by_workspaceId_and_batchId", (q) =>
          q.eq("workspaceId", workspace._id).eq("batchId", batch.batchId),
        )
        .collect(),
    ));
    const revision = batches.reduce(
      (latest, batch) => Math.max(latest, batch.updatedAt),
      workspace.updatedAt,
    );
    return {
      workspaceId: workspace._id,
      revision,
      batches: batches.map((batch, index) => ({
        id: batch.batchId,
        createdAt: new Date(batch.clientCreatedAt).toISOString(),
        updatedAt: new Date(batch.updatedAt).toISOString(),
        deliveryState: batch.status === "ready" ? "available" as const : batch.status,
        deliveries: deliveries[index].map((delivery) => ({
          targetDeviceId: delivery.targetDeviceId,
          state: delivery.state,
          attempts: delivery.attempts,
        })),
        results: results[index].map((result) => ({
          id: result.resultId,
          type: result.kind,
          deliveryState: result.deletedAt === undefined ? "available" as const : "deleted" as const,
          ...(result.text !== undefined ? { value: result.text } : {}),
          ...(result.format !== undefined ? { format: result.format } : {}),
          ...(result.objectKey !== undefined ? { photoObjectKey: result.objectKey } : {}),
          ...(result.contentType !== undefined ? { contentType: result.contentType } : {}),
          byteCount: result.byteCount,
          createdAt: new Date(result.clientCreatedAt).toISOString(),
        })),
      })),
    };
  };
