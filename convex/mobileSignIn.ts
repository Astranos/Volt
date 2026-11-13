import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { randomOpaqueSecret, sha256Hex } from "./cloudWorkspace/identity";

// QR sign-in for the iPhone app: the phone enters an email, every signed-in
// Chrome for that account shows a notification, and the phone scans the QR the
// clicked computer displays. The QR only works together with the secret held
// by the phone that made the request, so a photo of the screen is useless to
// anyone else.
export const MOBILE_SIGN_IN_REQUEST_TTL_MS = 5 * 60 * 1000;
export const MOBILE_SIGN_IN_RATE_WINDOW_MS = 10 * 60 * 1000;
export const MOBILE_SIGN_IN_MAX_REQUESTS_PER_WINDOW = 3;
const RETAIN_CLOSED_REQUESTS_MS = 24 * 60 * 60 * 1000;
export const MOBILE_SIGN_IN_QR_BASE_URL = "https://voltresale.app/app-sign-in";

export function normalizedSignInEmail(value: string) {
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

async function requireSubject(ctx: { auth: MutationCtx["auth"] }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("AUTHENTICATION_REQUIRED");
  return identity.subject;
}

async function ownPendingRequest(ctx: MutationCtx, requestId: Id<"mobileSignInRequests">) {
  const subject = await requireSubject(ctx);
  const request = await ctx.db.get(requestId);
  if (
    !request
    || request.clerkUserId !== subject
    || request.status !== "pending"
    || request.expiresAt <= Date.now()
  ) {
    throw new ConvexError("SIGN_IN_REQUEST_CLOSED");
  }
  return request;
}

export const createRequest = internalMutation({
  args: { emailHash: v.string(), requestSecretHash: v.string() },
  returns: v.union(
    v.object({ limited: v.literal(false), requestId: v.id("mobileSignInRequests"), expiresAt: v.number() }),
    v.object({ limited: v.literal(true) }),
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const recent = await ctx.db
      .query("mobileSignInRequests")
      .withIndex("by_emailHash_and_createdAt", (q) =>
        q.eq("emailHash", args.emailHash).gt("createdAt", now - MOBILE_SIGN_IN_RATE_WINDOW_MS),
      )
      .take(MOBILE_SIGN_IN_MAX_REQUESTS_PER_WINDOW);
    if (recent.length >= MOBILE_SIGN_IN_MAX_REQUESTS_PER_WINDOW) return { limited: true as const };
    const expiresAt = now + MOBILE_SIGN_IN_REQUEST_TTL_MS;
    const requestId = await ctx.db.insert("mobileSignInRequests", {
      requestSecretHash: args.requestSecretHash,
      emailHash: args.emailHash,
      status: "pending",
      createdAt: now,
      expiresAt,
    });
    return { limited: false as const, requestId, expiresAt };
  },
});

export const attachAccount = internalMutation({
  args: { requestId: v.id("mobileSignInRequests"), clerkUserId: v.string(), mfaRequired: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.status !== "pending" || request.clerkUserId !== undefined) return null;
    await ctx.db.patch(args.requestId, { clerkUserId: args.clerkUserId, mfaRequired: args.mfaRequired });
    return null;
  },
});

// Every signed-in Chrome for the account subscribes to this and shows a
// notification per request.
export const pendingForComputer = query({
  args: {},
  returns: v.array(v.object({
    requestId: v.id("mobileSignInRequests"),
    createdAt: v.number(),
    expiresAt: v.number(),
    mfaRequired: v.boolean(),
  })),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const requests = await ctx.db
      .query("mobileSignInRequests")
      .withIndex("by_clerkUserId_and_status", (q) =>
        q.eq("clerkUserId", identity.subject).eq("status", "pending"),
      )
      .take(MOBILE_SIGN_IN_MAX_REQUESTS_PER_WINDOW * 2);
    return requests.map((request) => ({
      requestId: request._id,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      mfaRequired: request.mfaRequired === true,
    }));
  },
});

// Issues (or replaces) the one-time code shown in Chrome's QR. Reopening the
// QR window invalidates the previous code.
export const issueQr = mutation({
  args: { requestId: v.id("mobileSignInRequests") },
  returns: v.object({ qrCodeUrl: v.string(), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    const request = await ownPendingRequest(ctx, args.requestId);
    if (request.mfaRequired) throw new ConvexError("SIGN_IN_MFA_REQUIRED");
    const code = randomOpaqueSecret();
    await ctx.db.patch(request._id, { qrCodeHash: await sha256Hex(code) });
    // The code travels in the fragment so it never reaches a web server log
    // if the link is opened in a browser.
    return { qrCodeUrl: `${MOBILE_SIGN_IN_QR_BASE_URL}#code=${code}`, expiresAt: request.expiresAt };
  },
});

export const dismiss = mutation({
  args: { requestId: v.id("mobileSignInRequests") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const request = await ownPendingRequest(ctx, args.requestId).catch(() => null);
    if (!request) return null;
    await ctx.db.patch(request._id, { status: "cancelled", closedAt: Date.now() });
    return null;
  },
});

export const consume = internalMutation({
  args: { requestSecretHash: v.string(), codeHash: v.string() },
  returns: v.union(
    v.object({ ok: v.literal(true), clerkUserId: v.string() }),
    v.object({ ok: v.literal(false), error: v.union(v.literal("request_expired"), v.literal("invalid_code")) }),
  ),
  handler: async (ctx, args) => {
    const now = Date.now();
    const request = await ctx.db
      .query("mobileSignInRequests")
      .withIndex("by_requestSecretHash", (q) => q.eq("requestSecretHash", args.requestSecretHash))
      .unique();
    if (!request || request.status !== "pending" || request.expiresAt <= now) {
      return { ok: false as const, error: "request_expired" as const };
    }
    if (!request.clerkUserId || request.mfaRequired || request.qrCodeHash !== args.codeHash) {
      return { ok: false as const, error: "invalid_code" as const };
    }
    await ctx.db.patch(request._id, { status: "completed", closedAt: now });
    return { ok: true as const, clerkUserId: request.clerkUserId };
  },
});

export const sweep = internalMutation({
  args: {},
  returns: v.object({ expired: v.number(), deleted: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const expiring = await ctx.db
      .query("mobileSignInRequests")
      .withIndex("by_status_and_expiresAt", (q) => q.eq("status", "pending").lte("expiresAt", now))
      .take(200);
    for (const request of expiring) {
      await ctx.db.patch(request._id, { status: "expired", closedAt: now });
    }
    const stale = await ctx.db
      .query("mobileSignInRequests")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", now - RETAIN_CLOSED_REQUESTS_MS))
      .take(200);
    let deleted = 0;
    for (const request of stale) {
      if (request.status === "pending") continue;
      await ctx.db.delete(request._id);
      deleted += 1;
    }
    return { expired: expiring.length, deleted };
  },
});
