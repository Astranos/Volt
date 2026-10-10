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
type WorkspacePolicy = Awaited<ReturnType<typeof accountPolicy>>["workspace"];

export function retentionDeadline(
  result: Pick<
    Doc<"scanResults">,
    "storageManaged" | "retentionTier" | "createdAt" | "deletedAt" | "expiresAt"
  >,
  policy: WorkspacePolicy,
): number | null {
  if (!result.storageManaged) return null;
  // A retention tombstone is irreversible, including after a later upgrade.
  if (result.deletedAt !== undefined && result.expiresAt !== undefined)
    return result.expiresAt;
  if (policy.tier === "workspace" && policy.access === "write") return null;
  const freeDeadline = result.createdAt + 7 * DAY;
  if (result.retentionTier === "workspace") {
    return (
      policy.graceEndsAt ??
      (policy.paidThrough === null
        ? freeDeadline
        : policy.paidThrough + 7 * DAY)
    );
  }
  return Math.max(freeDeadline, policy.graceEndsAt ?? 0);
}

export function resultExpiredForPolicy(
  result: Doc<"scanResults">,
  policy: WorkspacePolicy,
  now = Date.now(),
) {
  const deadline = retentionDeadline(result, policy);
  return deadline !== null && deadline <= now;
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
  const policy = (await accountPolicy(ctx, owner.ownerClerkUserId, now))
    .workspace;
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

export async function assertWorkspaceWritable(
  ctx: ReaderCtx,
  workspace: Doc<"workspaces">,
  now = Date.now(),
) {
  if (
    workspaceLifecycleEnabled() &&
    (await accountPolicy(ctx, workspace.ownerClerkUserId, now)).workspace
      .access !== "write"
  ) {
    throw new ConvexError("Workspace is read-only during billing grace");
  }
}

export async function reserveWorkspaceStorage(
  ctx: MutationCtx,
  workspace: Doc<"workspaces">,
  records: number,
  bytes: number,
  now = Date.now(),
) {
  if (!workspaceLifecycleEnabled()) return null;
  const policy = (await accountPolicy(ctx, workspace.ownerClerkUserId, now))
    .workspace;
  if (policy.access !== "write")
    throw new ConvexError("Workspace is read-only during billing grace");
  // Read the row again so a caller performing multiple adjustments cannot use stale counters.
  const current = await ctx.db.get(workspace._id);
  if (!current) throw new ConvexError("Workspace no longer exists");
  const recordsUsed = (current.managedRecordCount ?? 0) + records;
  const bytesUsed = (current.managedByteCount ?? 0) + bytes;
  if (recordsUsed > policy.recordsLimit)
    throw new ConvexError("Workspace record quota exceeded");
  if (bytesUsed > policy.bytesLimit)
    throw new ConvexError("Workspace storage quota exceeded");
  await ctx.db.patch(workspace._id, {
    managedRecordCount: recordsUsed,
    managedByteCount: bytesUsed,
  });
  return policy;
}

export async function adjustWorkspaceStorage(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  records: number,
  bytes: number,
) {
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace) return;
  await ctx.db.patch(workspaceId, {
    managedRecordCount: Math.max(
      0,
      (workspace.managedRecordCount ?? 0) + records,
    ),
    managedByteCount: Math.max(0, (workspace.managedByteCount ?? 0) + bytes),
  });
}

export const getUsage = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    tier: v.union(v.literal("free"), v.literal("workspace")),
    access: v.union(v.literal("write"), v.literal("read_only")),
    retentionDays: v.union(v.number(), v.null()),
    recordsUsed: v.number(),
    recordsLimit: v.number(),
    bytesUsed: v.number(),
    bytesLimit: v.number(),
    paidThrough: v.union(v.number(), v.null()),
    graceEndsAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Authentication required");
    const workspace = await workspaceForUser(ctx, identity.subject);
    const policy = (await accountPolicy(ctx, identity.subject)).workspace;
    return {
      enabled: workspaceLifecycleEnabled(),
      ...policy,
      recordsUsed: workspace?.managedRecordCount ?? 0,
      bytesUsed: workspace?.managedByteCount ?? 0,
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
    const policies = new Map<string, WorkspacePolicy>();
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
      let policy = policies.get(workspace.ownerClerkUserId);
      if (!policy) {
        policy = (await accountPolicy(ctx, workspace.ownerClerkUserId, now))
          .workspace;
        policies.set(workspace.ownerClerkUserId, policy);
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
