import { v, type Infer } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { apiPolicyForOwner } from "./monetization";

const RESERVATION_TTL_MS = 60_000;
const CLEANUP_BATCH_SIZE = 500;

export const productApiUsageStatusValidator = v.object({
  tier: v.union(v.literal("evaluation"), v.literal("api")),
  limit: v.number(),
  used: v.number(),
  reserved: v.number(),
  remaining: v.number(),
  resetsAt: v.union(v.number(), v.null()),
  enforcementEnabled: v.boolean(),
});
export type ProductApiUsageStatus = Infer<
  typeof productApiUsageStatusValidator
>;

const reservationResultValidator = v.union(
  v.object({ kind: v.literal("invalid_key") }),
  v.object({
    kind: v.literal("request_expired"),
    usage: productApiUsageStatusValidator,
  }),
  v.object({
    kind: v.literal("quota_exceeded"),
    usage: productApiUsageStatusValidator,
  }),
  v.object({
    kind: v.literal("reserved"),
    usage: productApiUsageStatusValidator,
  }),
);
export type ProductApiReservationResult = Infer<
  typeof reservationResultValidator
>;

const settlementResultValidator = v.object({
  status: v.union(v.literal("succeeded"), v.literal("refunded")),
  usage: productApiUsageStatusValidator,
});
export type ProductApiSettlementResult = Infer<
  typeof settlementResultValidator
>;

async function usageForPeriod(
  ctx: QueryCtx | MutationCtx,
  ownerTokenIdentifier: string,
  periodKey: string,
) {
  return ctx.db
    .query("productApiUsage")
    .withIndex("by_ownerTokenIdentifier_and_periodKey", (q) =>
      q
        .eq("ownerTokenIdentifier", ownerTokenIdentifier)
        .eq("periodKey", periodKey),
    )
    .unique();
}

async function statusForOwner(
  ctx: QueryCtx | MutationCtx,
  ownerTokenIdentifier: string,
  now: number,
) {
  const policy = await apiPolicyForOwner(ctx, ownerTokenIdentifier, now);
  const usage = await usageForPeriod(
    ctx,
    ownerTokenIdentifier,
    policy.periodKey,
  );
  const used = usage?.used ?? 0;
  const reserved = usage?.reserved ?? 0;
  return {
    tier: policy.tier,
    limit: policy.limit,
    used,
    reserved,
    remaining: Math.max(0, policy.limit - used - reserved),
    resetsAt: policy.resetsAt,
    enforcementEnabled: process.env.PRODUCT_API_METERING_ENABLED === "true",
  };
}

async function completeReservation(
  ctx: MutationCtx,
  request: Doc<"productApiRequests">,
  succeeded: boolean,
  now: number,
) {
  if (request.status !== "reserved") return request.status;
  // An expired slot must never be resurrected after another request takes it.
  const status =
    succeeded && request.expiresAt > now ? "succeeded" : "refunded";
  const usage = await usageForPeriod(
    ctx,
    request.ownerTokenIdentifier,
    request.periodKey,
  );
  if (!usage || usage.reserved < 1)
    throw new Error("API reservation counter is inconsistent");
  await ctx.db.patch(usage._id, {
    reserved: usage.reserved - 1,
    used: usage.used + (status === "succeeded" ? 1 : 0),
    updatedAt: now,
  });
  await ctx.db.patch(request._id, { status, completedAt: now });
  return status;
}

export const getStatus = query({
  args: {},
  returns: productApiUsageStatusValidator,
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    return statusForOwner(ctx, identity.tokenIdentifier, Date.now());
  },
});

export const reserve = internalMutation({
  args: { keyHash: v.string(), requestId: v.string(), now: v.number() },
  returns: reservationResultValidator,
  handler: async (ctx, args): Promise<ProductApiReservationResult> => {
    const key = await ctx.db
      .query("productApiKeys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", args.keyHash))
      .unique();
    if (!key || key.status !== "active") return { kind: "invalid_key" };

    const existing = await ctx.db
      .query("productApiRequests")
      .withIndex("by_requestId", (q) => q.eq("requestId", args.requestId))
      .unique();
    if (existing) {
      if (existing.apiKeyId !== key._id)
        throw new Error("API request belongs to a different key");
      const status =
        existing.status === "reserved" && existing.expiresAt <= args.now
          ? await completeReservation(ctx, existing, false, args.now)
          : existing.status;
      return {
        kind: status === "refunded" ? "request_expired" : "reserved",
        usage: await statusForOwner(ctx, key.ownerTokenIdentifier, args.now),
      };
    }

    const policy = await apiPolicyForOwner(
      ctx,
      key.ownerTokenIdentifier,
      args.now,
    );
    const usage = await usageForPeriod(
      ctx,
      key.ownerTokenIdentifier,
      policy.periodKey,
    );
    const status = await statusForOwner(
      ctx,
      key.ownerTokenIdentifier,
      args.now,
    );
    if (status.enforcementEnabled && status.remaining === 0) {
      return { kind: "quota_exceeded", usage: status };
    }
    const reserved = (usage?.reserved ?? 0) + 1;
    if (usage) {
      await ctx.db.patch(usage._id, { reserved, updatedAt: args.now });
    } else {
      await ctx.db.insert("productApiUsage", {
        ownerTokenIdentifier: key.ownerTokenIdentifier,
        periodKey: policy.periodKey,
        used: 0,
        reserved,
        updatedAt: args.now,
      });
    }
    await ctx.db.insert("productApiRequests", {
      requestId: args.requestId,
      ownerTokenIdentifier: key.ownerTokenIdentifier,
      apiKeyId: key._id,
      periodKey: policy.periodKey,
      status: "reserved",
      createdAt: args.now,
      expiresAt: args.now + RESERVATION_TTL_MS,
    });
    return {
      kind: "reserved",
      usage: {
        ...status,
        reserved,
        remaining: Math.max(0, status.remaining - 1),
      },
    };
  },
});

export const settle = internalMutation({
  args: { requestId: v.string(), succeeded: v.boolean(), now: v.number() },
  returns: v.union(settlementResultValidator, v.null()),
  handler: async (ctx, args): Promise<ProductApiSettlementResult | null> => {
    const request = await ctx.db
      .query("productApiRequests")
      .withIndex("by_requestId", (q) => q.eq("requestId", args.requestId))
      .unique();
    if (!request) return null;
    const status = await completeReservation(
      ctx,
      request,
      args.succeeded,
      args.now,
    );
    return {
      status,
      usage: await statusForOwner(ctx, request.ownerTokenIdentifier, args.now),
    };
  },
});

export const cleanupExpiredReservations = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.object({ refunded: v.number() }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const expired = await ctx.db
      .query("productApiRequests")
      .withIndex("by_status_and_expiresAt", (q) =>
        q.eq("status", "reserved").lte("expiresAt", now),
      )
      .take(CLEANUP_BATCH_SIZE);
    for (const request of expired)
      await completeReservation(ctx, request, false, now);
    return { refunded: expired.length };
  },
});
