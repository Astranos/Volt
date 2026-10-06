import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { requireAdmin } from "./admin";
import { upsertCatalogProducts } from "./catalog/store";
import { catalogProductValidator } from "./catalog/validators";
import { internalMutation, mutation, query } from "./_generated/server";

const reasonValidator = v.union(
  v.literal("source_upc_changed"),
  v.literal("variant_conflict"),
  v.literal("possible_upc_alias"),
);
const verdictValidator = v.union(
  v.literal("match"), v.literal("mismatch"), v.literal("unsure"),
);

export const listPending = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(v.object({
      id: v.id("catalogObservations"),
      sourceUrl: v.string(),
      observedUpc: v.string(),
      title: v.string(),
      reason: reasonValidator,
      lastSeenAt: v.number(),
      active: v.boolean(),
      classification: v.union(v.object({
        model: v.string(), verdict: verdictValidator,
        reasons: v.array(v.string()), classifiedAt: v.number(),
      }), v.null()),
    })),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const requested = args.paginationOpts.numItems;
    const numItems = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), 50) : 25;
    const page = await ctx.db.query("catalogObservations")
      .withIndex("by_status_and_active_and_lastSeenAt", (q) =>
        q.eq("status", "review").eq("active", true))
      .paginate({ ...args.paginationOpts, numItems });
    return {
      page: page.page.map((row) => ({
        id: row._id,
        sourceUrl: row.sourceUrl,
        observedUpc: row.observedUpc,
        title: row.title,
        reason: row.reason ?? "variant_conflict",
        lastSeenAt: row.lastSeenAt,
        active: row.active,
        classification: row.classification ?? null,
      })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const getCandidate = query({
  args: { id: v.id("catalogObservations") },
  returns: v.union(v.object({
    sourceUrl: v.string(),
    observedUpc: v.string(),
    reason: reasonValidator,
    candidate: catalogProductValidator,
    active: v.boolean(),
    classification: v.union(v.object({
      model: v.string(), verdict: verdictValidator,
      reasons: v.array(v.string()), classifiedAt: v.number(),
    }), v.null()),
  }), v.null()),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.status !== "review") return null;
    return {
      sourceUrl: row.sourceUrl,
      observedUpc: row.observedUpc,
      reason: row.reason ?? "variant_conflict",
      candidate: row.candidate,
      active: row.active,
      classification: row.classification ?? null,
    };
  },
});

export const resolve = mutation({
  args: {
    id: v.id("catalogObservations"),
    decision: v.union(v.literal("accept"), v.literal("reject")),
  },
  returns: v.union(v.literal("accepted"), v.literal("rejected")),
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.status !== "review" || !row.active) {
      throw new Error("Active review candidate not found");
    }
    const now = Date.now();
    if (args.decision === "accept") {
      await upsertCatalogProducts(ctx, [row.candidate], now, {
        allowSourceCorrection: true, reviewed: true,
      });
    }
    const status = args.decision === "accept" ? "accepted" : "rejected";
    await ctx.db.patch(row._id, { status, reviewedAt: now, reviewedBy: admin.email });
    return status;
  },
});

// A later LLM worker can record an assessment without altering the catalog.
export const recordClassification = internalMutation({
  args: {
    id: v.id("catalogObservations"),
    model: v.string(),
    verdict: verdictValidator,
    reasons: v.array(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.status !== "review" || !row.active) return false;
    if (!args.model.trim() || args.reasons.length > 8 || args.reasons.some((reason) => reason.length > 240)) {
      throw new Error("Invalid classification assessment");
    }
    await ctx.db.patch(row._id, {
      classification: {
        model: args.model,
        verdict: args.verdict,
        reasons: args.reasons,
        classifiedAt: Date.now(),
      },
    });
    return true;
  },
});
