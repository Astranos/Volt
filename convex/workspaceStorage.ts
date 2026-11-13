import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  internalAction,
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";
import { accountPolicy, workspaceLifecycleEnabled } from "./monetization";
import { workspaceForUser } from "./cloudWorkspace/identity";
import { presignR2 } from "./cloudWorkspace/photos";

const DAY = 24 * 60 * 60 * 1000;
export const WORKSPACE_UNDO_MS = 30 * DAY;
const PURGE_DELAY_MS = 10 * 60 * 1000;
const PURGE_RETRY_MS = 15 * 60 * 1000;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
type ReaderCtx = Pick<QueryCtx, "db">;
type WorkspacePolicy = ReturnType<typeof accountPolicy>["workspace"];

export function retentionDeadline(
  result: Pick<
    Doc<"scanResults">,
    "storageManaged" | "createdAt" | "deletedAt" | "expiresAt"
  >,
  policy: WorkspacePolicy,
): number | null {
  if (!result.storageManaged) return null;
  // A retention tombstone is irreversible.
  if (result.deletedAt !== undefined && result.expiresAt !== undefined)
    return result.expiresAt;
  return result.createdAt + policy.retentionDays * DAY;
}

export function resultExpiredForPolicy(
  result: Doc<"scanResults">,
  policy: WorkspacePolicy,
  now = Date.now(),
) {
  const deadline = retentionDeadline(result, policy);
  return deadline !== null && deadline <= now;
}

/**
 * The captures of a batch that still count. Rolling retention expires the older captures of a
 * session the phone can keep adding to, so those are skipped instead of stranding new uploads.
 * A capture the user deleted, or a batch with nothing left, is still rejected.
 */
export function liveBatchResults(
  results: Array<Doc<"scanResults">>,
  policy: WorkspacePolicy,
) {
  const live = results.filter((result) => !resultExpiredForPolicy(result, policy));
  if (live.length === 0 || live.some((result) => result.deletedAt !== undefined)) {
    throw new ConvexError("Batch contains deleted or expired results");
  }
  return live;
}

export async function resultIsExpired(
  ctx: ReaderCtx,
  result: Doc<"scanResults">,
  workspace?: Doc<"workspaces">,
  now = Date.now(),
): Promise<boolean> {
  if (!result.storageManaged) return false;
  const owner = workspace ?? (await ctx.db.get(result.workspaceId));
  if (!owner) return true;
  const policy = accountPolicy().workspace;
  return resultExpiredForPolicy(result, policy, now);
}

export function managedResultByteCount(result: {
  kind: string;
  byteCount: number;
  text?: string;
  format?: string;
  contentType?: string;
  checksum?: string;
}) {
  if (result.kind === "photo") {
    if (
      !Number.isSafeInteger(result.byteCount) ||
      result.byteCount <= 0 ||
      result.byteCount > MAX_PHOTO_BYTES
    ) {
      throw new ConvexError(
        "Photo size must be a positive integer of at most 10 MiB",
      );
    }
    return result.byteCount;
  }
  return new TextEncoder().encode(result.text ?? "").byteLength;
}

export async function reserveWorkspaceStorage(
  ctx: MutationCtx,
  workspace: Doc<"workspaces">,
  records: number,
  bytes: number,
) {
  if (!workspaceLifecycleEnabled()) return false;
  const policy = accountPolicy().workspace;
  // Read the row again so a caller performing multiple adjustments cannot use stale counters.
  const current = await ctx.db.get(workspace._id);
  if (!current) throw new ConvexError("Workspace no longer exists");
  const usage = await storageUsage(ctx, current);
  const recordsUsed = usage.records + records;
  const bytesUsed = usage.bytes + bytes;
  if (recordsUsed > policy.recordsLimit)
    throw new ConvexError("Workspace record quota exceeded");
  if (bytesUsed > policy.bytesLimit)
    throw new ConvexError("Workspace storage quota exceeded");
  await writeStorageUsage(ctx, current._id, usage.row, recordsUsed, bytesUsed);
  return true;
}

export async function adjustWorkspaceStorage(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  records: number,
  bytes: number,
) {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace) return;
  const usage = await storageUsage(ctx, workspace);
  await writeStorageUsage(
    ctx,
    workspaceId,
    usage.row,
    Math.max(0, usage.records + records),
    Math.max(0, usage.bytes + bytes),
  );
}

/**
 * Counters live beside the workspace, not on it: every snapshot page reads the
 * workspace row, so patching it on each capture re-ran every subscribed page.
 * Workspaces without a usage row fall back to the legacy fields.
 */
async function storageUsage(ctx: ReaderCtx, workspace: Doc<"workspaces">) {
  const row = await ctx.db
    .query("workspaceStorageUsage")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspace._id))
    .unique();
  return {
    row,
    records: row?.recordCount ?? workspace.managedRecordCount ?? 0,
    bytes: row?.byteCount ?? workspace.managedByteCount ?? 0,
  };
}

async function writeStorageUsage(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  row: Doc<"workspaceStorageUsage"> | null,
  recordCount: number,
  byteCount: number,
) {
  if (row) await ctx.db.patch(row._id, { recordCount, byteCount });
  else await ctx.db.insert("workspaceStorageUsage", { workspaceId, recordCount, byteCount });
}

export const getUsage = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    retentionDays: v.number(),
    recordsUsed: v.number(),
    recordsLimit: v.number(),
    bytesUsed: v.number(),
    bytesLimit: v.number(),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Authentication required");
    const workspace = await workspaceForUser(ctx, identity.subject);
    const policy = accountPolicy().workspace;
    const usage = workspace ? await storageUsage(ctx, workspace) : null;
    return {
      enabled: workspaceLifecycleEnabled(),
      ...policy,
      recordsUsed: usage?.records ?? 0,
      bytesUsed: usage?.bytes ?? 0,
    };
  },
});

export const sweepRetention = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    if (!workspaceLifecycleEnabled()) return 0;
    const now = Date.now();
    const results = await ctx.db
      .query("scanResults")
      .withIndex("by_retentionCheckAt", (q) =>
        q.gt("retentionCheckAt", 0).lte("retentionCheckAt", now),
      )
      .take(100);
    const policy = accountPolicy().workspace;
    let expired = 0;
    for (const result of results) {
      if (!result.storageManaged || result.deletedAt !== undefined) {
        await ctx.db.patch(result._id, { retentionCheckAt: undefined });
        continue;
      }
      const workspace = await ctx.db.get(result.workspaceId);
      if (!workspace) {
        await ctx.db.patch(result._id, {
          deletedAt: now,
          expiresAt: now,
          retentionCheckAt: undefined,
          purgeAfter: now + PURGE_DELAY_MS,
        });
        expired++;
        continue;
      }
      const deadline = retentionDeadline(result, policy);
      if (deadline === null || deadline > now) {
        await ctx.db.patch(result._id, {
          expiresAt: deadline ?? undefined,
          retentionCheckAt: Math.min(deadline ?? Infinity, now + DAY),
        });
        continue;
      }
      await ctx.db.patch(result._id, {
        deletedAt: now,
        expiresAt: deadline,
        retentionCheckAt: undefined,
        purgeAfter: now + PURGE_DELAY_MS,
      });
      await adjustWorkspaceStorage(ctx, workspace._id, -1, 0);
      const batch = await ctx.db
        .query("resultBatches")
        .withIndex("by_workspaceId_and_batchId", (q) =>
          q.eq("workspaceId", workspace._id).eq("batchId", result.batchId),
        )
        .unique();
      if (batch)
        await ctx.db.patch(batch._id, {
          resultCount: Math.max(0, batch.resultCount - 1),
          byteCount: Math.max(0, batch.byteCount - result.byteCount),
          updatedAt: now,
        });
      expired++;
    }
    return expired;
  },
});

/**
 * One-time move of captures saved before retention was enabled onto the 7-day window. It only
 * marks rows; sweepRetention and purgeExpiredObjects still do all the deleting. Those rows never
 * reserved usage, so run recountWorkspaceStorage afterwards to make the counters match.
 */
export const enrollLegacyHistory = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    dryRun: v.boolean(),
    workspaceId: v.optional(v.id("workspaces")),
  },
  returns: v.object({
    cursor: v.string(),
    isDone: v.boolean(),
    enrolled: v.number(),
    pastWindow: v.number(),
    photos: v.number(),
    userDeleted: v.number(),
  }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const query = args.workspaceId
      ? ctx.db
          .query("scanResults")
          .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId!))
      : ctx.db.query("scanResults");
    const page = await query.paginate({ cursor: args.cursor, numItems: 200 });
    let enrolled = 0;
    let pastWindow = 0;
    let photos = 0;
    let userDeleted = 0;
    for (const result of page.page) {
      if (result.storageManaged || result.objectPurgedAt !== undefined) continue;
      const deadline = result.createdAt + 7 * DAY;
      enrolled++;
      if (deadline <= now) pastWindow++;
      if (result.objectKey) photos++;
      if (result.deletedAt !== undefined) userDeleted++;
      if (args.dryRun) continue;
      await ctx.db.patch(result._id, {
        storageManaged: true,
        retentionTier: "free",
        expiresAt: deadline,
        ...(result.deletedAt === undefined
          ? { retentionCheckAt: Math.max(deadline, now) }
          : { purgeAfter: Math.max(deadline, now + PURGE_DELAY_MS) }),
      });
    }
    return {
      cursor: page.continueCursor,
      isDone: page.isDone,
      enrolled,
      pastWindow,
      photos,
      userDeleted,
    };
  },
});

/** Rebuilds a workspace's usage from its rows, on the same terms the sweep and purge decrement. */
export const recountWorkspaceStorage = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  returns: v.object({ records: v.number(), bytes: v.number() }),
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new ConvexError("Workspace no longer exists");
    const results = await ctx.db
      .query("scanResults")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
      .collect();
    const managed = results.filter((result) => result.storageManaged);
    const records = managed.filter((result) => result.deletedAt === undefined).length;
    const bytes = managed
      .filter((result) => result.objectPurgedAt === undefined)
      .reduce((sum, result) => sum + result.byteCount, 0);
    const usage = await storageUsage(ctx, workspace);
    await writeStorageUsage(ctx, args.workspaceId, usage.row, records, bytes);
    return { records, bytes };
  },
});

const purgeItem = v.object({
  resultId: v.id("scanResults"),
  objectKey: v.union(v.string(), v.null()),
});
export const claimPurges = internalMutation({
  args: {},
  returns: v.array(purgeItem),
  handler: async (ctx) => {
    if (!workspaceLifecycleEnabled()) return [];
    const now = Date.now();
    const results = await ctx.db
      .query("scanResults")
      .withIndex("by_purgeAfter", (q) =>
        q.gt("purgeAfter", 0).lte("purgeAfter", now),
      )
      .take(25);
    const items: Array<{
      resultId: Id<"scanResults">;
      objectKey: string | null;
    }> = [];
    for (const result of results) {
      if (
        !result.storageManaged ||
        result.deletedAt === undefined ||
        result.objectPurgedAt !== undefined
      ) {
        await ctx.db.patch(result._id, { purgeAfter: undefined });
        continue;
      }
      await ctx.db.patch(result._id, { purgeAfter: now + PURGE_RETRY_MS });
      items.push({ resultId: result._id, objectKey: result.objectKey ?? null });
    }
    return items;
  },
});

export const completePurge = internalMutation({
  args: { resultId: v.id("scanResults") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = await ctx.db.get(args.resultId);
    if (
      !result?.storageManaged ||
      result.deletedAt === undefined ||
      result.objectPurgedAt !== undefined
    )
      return null;
    await adjustWorkspaceStorage(ctx, result.workspaceId, 0, -result.byteCount);
    await ctx.db.patch(result._id, {
      objectPurgedAt: Date.now(),
      purgeAfter: undefined,
      text: undefined,
      objectKey: undefined,
      format: undefined,
      contentType: undefined,
      checksum: undefined,
    });
    return null;
  },
});

const claimPurgesRef = makeFunctionReference<
  "mutation",
  Record<string, never>,
  Array<{ resultId: Id<"scanResults">; objectKey: string | null }>
>("workspaceStorage:claimPurges");
const completePurgeRef = makeFunctionReference<
  "mutation",
  { resultId: Id<"scanResults"> },
  null
>("workspaceStorage:completePurge");
export const purgeExpiredObjects = internalAction({
  args: {},
  returns: v.object({ purged: v.number(), failed: v.number() }),
  handler: async (ctx) => {
    const items = await ctx.runMutation(claimPurgesRef, {});
    let purged = 0;
    let failed = 0;
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const item = items[next++];
        try {
          if (item.objectKey) {
            const signed = await presignR2("DELETE", item.objectKey);
            const response = await fetch(signed.url, {
              method: "DELETE",
              signal: AbortSignal.timeout(10_000),
            });
            if (!response.ok && response.status !== 404)
              throw new Error("R2 delete failed");
          }
          await ctx.runMutation(completePurgeRef, { resultId: item.resultId });
          purged++;
        } catch {
          // The claim has a retry deadline; counters stay reserved until DELETE succeeds.
          failed++;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, items.length) }, worker),
    );
    return { purged, failed };
  },
});
