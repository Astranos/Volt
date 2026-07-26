import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import {
  COMPLIMENTARY_ADMIN_ENTITLEMENT_PREFIX,
  storeKitProductId,
} from "./access";

/** Owners of the admin dashboard. Extra addresses can be added via env. */
const ADMIN_EMAILS = new Set(["juanquenga@gmail.com"]);

function configuredAdminEmails() {
  return new Set(
    (process.env.VOLT_ADMIN_EMAILS ?? "")
      .split(/[\n,]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function normalizeEmail(email: string | undefined | null) {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

type AdminIdentity = { clerkUserId: string; email: string };

/**
 * Resolves the caller's admin identity, or null. The email claim is not
 * guaranteed to be in the token, so the stored user row is used as a fallback.
 */
async function adminIdentity(ctx: QueryCtx | MutationCtx): Promise<AdminIdentity | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const clerkUserId = identity.subject;
  let email = normalizeEmail(typeof identity.email === "string" ? identity.email : undefined);
  if (!email) {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();
    email = normalizeEmail(user?.email);
  }
  if (!email) return null;
  if (!ADMIN_EMAILS.has(email) && !configuredAdminEmails().has(email)) return null;
  return { clerkUserId, email };
}

async function requireAdmin(ctx: MutationCtx) {
  const admin = await adminIdentity(ctx);
  if (!admin) throw new Error("Admin access required");
  return admin;
}

function activeEntitlement(entitlement: Doc<"entitlements">, now: number) {
  return (
    entitlement.status === "active" &&
    (entitlement.expiresAt === undefined || entitlement.expiresAt > now)
  );
}

/**
 * Applies a grant change to the derived `entitlements` row straight away so the
 * phone sees it on its next status poll instead of on its next sign-in.
 */
async function applyGrantToEntitlements(
  ctx: MutationCtx,
  target: { clerkUserId?: string; email?: string },
  active: boolean,
  now: number,
) {
  const targetUserId = target.clerkUserId;
  const user = targetUserId
    ? await ctx.db
        .query("users")
        .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", targetUserId))
        .unique()
    : target.email
      ? (await ctx.db.query("users").take(1000)).find(
          (candidate) => normalizeEmail(candidate.email) === target.email,
        ) ?? null
      : null;
  if (!user) return;

  const sourceIdentifier = `${COMPLIMENTARY_ADMIN_ENTITLEMENT_PREFIX}${user.clerkUserId}`;
  const existing = await ctx.db
    .query("entitlements")
    .withIndex("by_clerkUserId_and_sourceIdentifier", (q) =>
      q.eq("clerkUserId", user.clerkUserId).eq("sourceIdentifier", sourceIdentifier),
    )
    .unique();

  if (!active) {
    if (existing && existing.status === "active") {
      await ctx.db.patch(existing._id, { status: "revoked", updatedAt: now });
    }
    return;
  }
  if (existing) {
    await ctx.db.patch(existing._id, {
      status: "active",
      expiresAt: undefined,
      productId: storeKitProductId(),
      updatedAt: now,
    });
    return;
  }
  await ctx.db.insert("entitlements", {
    clerkUserId: user.clerkUserId,
    kind: "manual",
    sourceIdentifier,
    productId: storeKitProductId(),
    status: "active",
    validFrom: now,
    updatedAt: now,
  });
}

/**
 * Everything the dashboard renders: who has signed into the app, what each
 * account's entitlement looks like, and the comped grants themselves.
 */
export const overview = query({
  args: {},
  handler: async (ctx) => {
    const admin = await adminIdentity(ctx);
    if (!admin) return { isAdmin: false as const, adminEmail: null, accounts: [], grants: [] };

    const now = Date.now();
    const grants = await ctx.db.query("compedGrants").take(500);
    const users = await ctx.db.query("users").take(500);
    const grantedUserIds = new Set(
      grants.filter((grant) => grant.status === "active" && grant.clerkUserId).map((grant) => grant.clerkUserId),
    );
    const grantedEmails = new Set(
      grants.filter((grant) => grant.status === "active" && grant.email).map((grant) => grant.email),
    );

    const accounts = await Promise.all(
      users.map(async (user) => {
        const entitlements = await ctx.db
          .query("entitlements")
          .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", user.clerkUserId))
          .take(100);
        const live = entitlements.filter((entitlement) => activeEntitlement(entitlement, now));
        const subscription = live.find((entitlement) => entitlement.kind === "storekit");
        const email = normalizeEmail(user.email);
        return {
          clerkUserId: user.clerkUserId,
          email: user.email ?? null,
          name: user.name ?? null,
          createdAt: user.createdAt,
          freeSessionsConsumed: user.freeSessionsConsumed,
          hasProAccess: live.length > 0,
          hasPaidSubscription: Boolean(subscription),
          isComped: grantedUserIds.has(user.clerkUserId) || (email ? grantedEmails.has(email) : false),
        };
      }),
    );
    accounts.sort((left, right) => right.createdAt - left.createdAt);

    return {
      isAdmin: true as const,
      adminEmail: admin.email,
      accounts,
      grants: grants
        .map((grant) => ({
          id: grant._id,
          email: grant.email ?? null,
          clerkUserId: grant.clerkUserId ?? null,
          note: grant.note ?? null,
          status: grant.status,
          grantedByEmail: grant.grantedByEmail ?? null,
          createdAt: grant.createdAt,
          updatedAt: grant.updatedAt,
        }))
        .sort((left, right) => right.updatedAt - left.updatedAt),
    };
  },
});

/** Comps an account by Clerk user id, by email, or both. */
export const grantPro = mutation({
  args: {
    clerkUserId: v.optional(v.string()),
    email: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const email = normalizeEmail(args.email);
    const clerkUserId = args.clerkUserId?.trim() || undefined;
    if (!email && !clerkUserId) throw new Error("An email or Clerk user id is required");

    const now = Date.now();
    const existing = clerkUserId
      ? await ctx.db
          .query("compedGrants")
          .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
          .unique()
      : await ctx.db
          .query("compedGrants")
          .withIndex("by_email", (q) => q.eq("email", email))
          .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "active",
        ...(args.note !== undefined ? { note: args.note } : {}),
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("compedGrants", {
        ...(email ? { email } : {}),
        ...(clerkUserId ? { clerkUserId } : {}),
        ...(args.note ? { note: args.note } : {}),
        status: "active",
        grantedByClerkUserId: admin.clerkUserId,
        grantedByEmail: admin.email,
        createdAt: now,
        updatedAt: now,
      });
    }

    await applyGrantToEntitlements(ctx, { clerkUserId, email }, true, now);
    return { ok: true as const };
  },
});

/** Takes a comp back. The paid-subscription path is untouched. */
export const revokePro = mutation({
  args: { grantId: v.id("compedGrants") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const grant = await ctx.db.get(args.grantId as Id<"compedGrants">);
    if (!grant) throw new Error("Grant not found");
    const now = Date.now();
    await ctx.db.patch(grant._id, { status: "revoked", updatedAt: now });
    await applyGrantToEntitlements(
      ctx,
      { ...(grant.clerkUserId ? { clerkUserId: grant.clerkUserId } : {}), ...(grant.email ? { email: grant.email } : {}) },
      false,
      now,
    );
    return { ok: true as const };
  },
});
