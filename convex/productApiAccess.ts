import { v } from "convex/values";

import { requireAdmin } from "./admin";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

export function apiEntitlementEnforced(): boolean {
  return process.env.PRODUCT_API_REQUIRE_ENTITLEMENT === "true";
}

export async function activeApiAccess(
  ctx: MutationCtx | QueryCtx,
  ownerTokenIdentifier: string,
  now: number,
) {
  const access = await ctx.db.query("productApiAccess")
    .withIndex("by_ownerTokenIdentifier", (q) => q.eq("ownerTokenIdentifier", ownerTokenIdentifier))
    .unique();
  return access && access.status === "active" &&
    (access.expiresAt === undefined || access.expiresAt > now) ? access : null;
}

export const mine = query({
  args: {},
  returns: v.object({
    enforced: v.boolean(),
    active: v.boolean(),
    plan: v.union(v.string(), v.null()),
    expiresAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    const access = await activeApiAccess(ctx, identity.tokenIdentifier, Date.now());
    return {
      enforced: apiEntitlementEnforced(),
      active: access !== null,
      plan: access?.plan ?? null,
      expiresAt: access?.expiresAt ?? null,
    };
  },
});

export const grantManual = mutation({
  args: {
    ownerTokenIdentifier: v.string(),
    plan: v.string(),
    expiresAt: v.optional(v.number()),
  },
  returns: v.id("productApiAccess"),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const owner = args.ownerTokenIdentifier.trim();
    const plan = args.plan.trim();
    if (!owner || owner.length > 200 || !plan || plan.length > 64 ||
      (args.expiresAt !== undefined && args.expiresAt <= Date.now())) {
      throw new Error("Invalid API access grant");
    }
    const existing = await ctx.db.query("productApiAccess")
      .withIndex("by_ownerTokenIdentifier", (q) => q.eq("ownerTokenIdentifier", owner))
      .unique();
    if (existing?.source === "billing") throw new Error("Billing access must be changed by billing");
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "active", plan, expiresAt: args.expiresAt, updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("productApiAccess", {
      ownerTokenIdentifier: owner, status: "active", source: "manual",
      plan, expiresAt: args.expiresAt, createdAt: now, updatedAt: now,
    });
  },
});

export const revokeManual = mutation({
  args: { id: v.id("productApiAccess") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const access = await ctx.db.get(args.id);
    if (!access || access.source !== "manual") return false;
    if (access.status === "active") {
      await ctx.db.patch(access._id, { status: "revoked", updatedAt: Date.now() });
    }
    return true;
  },
});
