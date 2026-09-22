import { ConvexError, v, type ObjectType } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { authenticatedWorkspaceOrNull } from "./identity";
import { mergeWorkspaceSnapshotPages, type WorkspaceSnapshotPage } from "@volt/scanner-protocol";

export const SNAPSHOT_PAGE_DOCUMENTS = 100;
// Convex can cross this threshold by one document, whose platform maximum is 1 MiB.
// Even worst-case JSON escaping stays below the 8 MiB response ceiling.
export const SNAPSHOT_PAGE_READ_BYTES = 128 * 1024;
const PAGE_RESPONSE_BYTES = 7 * 1024 * 1024;
const kind = v.union(v.literal("batches"), v.literal("results"), v.literal("deliveries"));
const batch = {
  id: v.string(), createdAt: v.string(), updatedAt: v.string(),
  deliveryState: v.union(v.literal("available"), v.literal("uploading"), v.literal("deleted")),
};
const result = {
  id: v.string(), type: v.union(v.literal("text"), v.literal("barcode"), v.literal("photo"), v.literal("dictation")),
  deliveryState: v.union(v.literal("available"), v.literal("deleted")),
  value: v.optional(v.string()), format: v.optional(v.string()), photoObjectKey: v.optional(v.string()),
  contentType: v.optional(v.string()), byteCount: v.number(), createdAt: v.string(),
};
const delivery = {
  targetDeviceId: v.string(), state: v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")), attempts: v.number(),
};
const boundary = { workspaceId: v.string(), revision: v.number(), continueCursor: v.string(), isDone: v.boolean() };
export const workspaceSnapshotPageArgs = { kind, cursor: v.union(v.string(), v.null()) };
export const workspaceSnapshotPageReturns = v.union(v.null(),
  v.object({ ...boundary, kind: v.literal("batches"), items: v.array(v.object(batch)) }),
  v.object({ ...boundary, kind: v.literal("results"), items: v.array(v.object({ ...result, batchId: v.string() })) }),
  v.object({ ...boundary, kind: v.literal("deliveries"), items: v.array(v.object({ ...delivery, id: v.string(), batchId: v.string() })) }),
);
export const workspaceSnapshotReturns = v.union(v.null(), v.object({
  workspaceId: v.string(), revision: v.number(),
  batches: v.array(v.object({ ...batch, results: v.array(v.object(result)), deliveries: v.array(v.object(delivery)) })),
}));

function snapshotBatch(row: Doc<"resultBatches">) {
  return { id: row.batchId, createdAt: new Date(row.clientCreatedAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
    deliveryState: row.status === "ready" ? "available" as const : row.status };
}
function snapshotResult(row: Doc<"scanResults">) {
  return { batchId: row.batchId, id: row.resultId, type: row.kind,
    deliveryState: row.deletedAt === undefined ? "available" as const : "deleted" as const,
    ...(row.text !== undefined ? { value: row.text } : {}), ...(row.format !== undefined ? { format: row.format } : {}),
    ...(row.objectKey !== undefined ? { photoObjectKey: row.objectKey } : {}), ...(row.contentType !== undefined ? { contentType: row.contentType } : {}),
    byteCount: row.byteCount, createdAt: new Date(row.clientCreatedAt).toISOString() };
}
function snapshotDelivery(row: Doc<"resultDeliveries">) {
  return { id: row._id, batchId: row.batchId, targetDeviceId: row.targetDeviceId, state: row.state, attempts: row.attempts };
}
function decodeCursor(cursor: string | null, workspaceId: string, pageKind: string): string | null {
  if (cursor === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(cursor); } catch { throw new ConvexError("Invalid snapshot cursor"); }
  if (!parsed || typeof parsed !== "object" || !("workspaceId" in parsed) || !("kind" in parsed) || !("cursor" in parsed)
    || parsed.workspaceId !== workspaceId || parsed.kind !== pageKind || typeof parsed.cursor !== "string") {
    throw new ConvexError("Snapshot cursor belongs to another workspace or stream");
  }
  return parsed.cursor;
}

export async function workspaceSnapshotPageHandler(ctx: QueryCtx, args: ObjectType<typeof workspaceSnapshotPageArgs>): Promise<WorkspaceSnapshotPage | null> {
  const workspace = await authenticatedWorkspaceOrNull(ctx);
  if (!workspace) {
    if (args.cursor !== null) throw new ConvexError("Workspace changed during pagination");
    return null;
  }
  const options = { cursor: decodeCursor(args.cursor, workspace._id, args.kind), numItems: SNAPSHOT_PAGE_DOCUMENTS,
    maximumRowsRead: SNAPSHOT_PAGE_DOCUMENTS, maximumBytesRead: SNAPSHOT_PAGE_READ_BYTES };
  const meta = { workspaceId: workspace._id, revision: workspace.updatedAt };
  function withBoundary(page: { continueCursor: string; isDone: boolean }) {
    return { ...meta, isDone: page.isDone, continueCursor: JSON.stringify({ workspaceId: meta.workspaceId, kind: args.kind, cursor: page.continueCursor }) };
  }
  let response: WorkspaceSnapshotPage;
  if (args.kind === "batches") {
    const page = await ctx.db.query("resultBatches").withIndex("by_workspaceId", q => q.eq("workspaceId", workspace._id)).order("desc").paginate(options);
    response = { ...withBoundary(page), kind: "batches", items: page.page.map(snapshotBatch) };
  } else if (args.kind === "results") {
    const page = await ctx.db.query("scanResults").withIndex("by_workspaceId", q => q.eq("workspaceId", workspace._id)).order("desc").paginate(options);
    response = { ...withBoundary(page), kind: "results", items: page.page.map(snapshotResult) };
  } else {
    const page = await ctx.db.query("resultDeliveries").withIndex("by_workspaceId", q => q.eq("workspaceId", workspace._id)).order("desc").paginate(options);
    response = { ...withBoundary(page), kind: "deliveries", items: page.page.map(snapshotDelivery) };
  }
  if (new TextEncoder().encode(JSON.stringify(response)).byteLength > PAGE_RESPONSE_BYTES) throw new ConvexError("Snapshot document exceeds the response budget");
  return response;
}

export const workspaceSnapshotArgs = {};
/** Legacy clients receive a complete small snapshot or an explicit upgrade error. */
export async function workspaceSnapshotHandler(ctx: QueryCtx) {
  const workspace = await authenticatedWorkspaceOrNull(ctx);
  if (!workspace) return null;
  let count = 0;
  let bytes = 0;
  async function bounded<T>(query: AsyncIterable<T>): Promise<T[]> {
    const rows: T[] = [];
    for await (const row of query) {
      count += 1;
      bytes += new TextEncoder().encode(JSON.stringify(row)).byteLength;
      if (count > SNAPSHOT_PAGE_DOCUMENTS || bytes > SNAPSHOT_PAGE_READ_BYTES) {
        throw new ConvexError("Workspace requires pagination. Update Volt or use workspaceSnapshotPage.");
      }
      rows.push(row);
    }
    return rows;
  }
  const batches = await bounded(ctx.db.query("resultBatches").withIndex("by_workspaceId", q => q.eq("workspaceId", workspace._id)).order("desc"));
  const results = await bounded(ctx.db.query("scanResults").withIndex("by_workspaceId", q => q.eq("workspaceId", workspace._id)).order("desc"));
  const deliveries = await bounded(ctx.db.query("resultDeliveries").withIndex("by_workspaceId", q => q.eq("workspaceId", workspace._id)).order("desc"));
  const meta = { workspaceId: workspace._id, revision: workspace.updatedAt, continueCursor: "", isDone: true };
  return mergeWorkspaceSnapshotPages([
    { ...meta, kind: "batches", items: batches.map(snapshotBatch) },
    { ...meta, kind: "results", items: results.map(snapshotResult) },
    { ...meta, kind: "deliveries", items: deliveries.map(snapshotDelivery) },
  ]);
}
