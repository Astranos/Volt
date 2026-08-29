import { ConvexError, v } from "convex/values";

import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";

export const AI_SCANNER_SAFETY_LIMIT = 10;
export const AI_SCANNER_SAFETY_WINDOW_MS = 60_000;
export const DEFAULT_AI_SCANNER_FREE_MONTHLY_LIMIT = 10;

export type AIScannerQuota =
  | { kind: "unlimited" }
  | { kind: "metered"; limit: number; used: number; remaining: number; resetsAt: number };

export type AIScannerPlan = "free" | "pro";
export type AIScannerQuotaError = "quota-exhausted" | "rate-limited" | "request-in-progress" | "invalid-device"
  | "upstream-failed" | "upstream-timeout" | "invalid-input" | "upstream-rate-limited";
export type AIScannerReservation = {
  status: "reserved" | "succeeded" | "refunded" | "rejected";
  errorCode?: AIScannerQuotaError;
  quota: AIScannerQuota;
  value?: string | null;
  format?: string;
};

const quotaValidator = v.union(
  v.object({ kind: v.literal("unlimited") }),
  v.object({
    kind: v.literal("metered"),
    limit: v.number(),
    used: v.number(),
    remaining: v.number(),
    resetsAt: v.number(),
  }),
);

const resultValidator = v.object({
  status: v.union(v.literal("reserved"), v.literal("succeeded"), v.literal("refunded"), v.literal("rejected")),
  errorCode: v.optional(v.union(
    v.literal("quota-exhausted"),
    v.literal("rate-limited"),
    v.literal("request-in-progress"),
    v.literal("invalid-device"),
    v.literal("upstream-failed"),
    v.literal("upstream-timeout"),
    v.literal("invalid-input"),
    v.literal("upstream-rate-limited"),
  )),
  quota: quotaValidator,
  value: v.optional(v.union(v.string(), v.null())),
  format: v.optional(v.string()),
});

function isDevelopmentUnlimited() {
  return process.env.AI_SCANNER_QUOTA_MODE === "unlimited";
}

export function aiScannerFreeMonthlyLimit() {
  const configured = Number(process.env.AI_SCANNER_FREE_MONTHLY_LIMIT);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, 10_000)
    : DEFAULT_AI_SCANNER_FREE_MONTHLY_LIMIT;
}

export function utcPeriodKey(now: number) {
  return new Date(now).toISOString().slice(0, 7);
}

export function utcPeriodReset(now: number) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function quotaSnapshot(plan: AIScannerPlan, used: number, now: number): AIScannerQuota {
  if (plan === "pro" || isDevelopmentUnlimited()) return { kind: "unlimited" };
  const limit = aiScannerFreeMonthlyLimit();
  return { kind: "metered", limit, used, remaining: Math.max(0, limit - used), resetsAt: utcPeriodReset(now) };
}

export async function aiScannerQuotaForAccess(
  ctx: Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">,
  clerkUserId: string | undefined,
  plan: AIScannerPlan,
  now = Date.now(),
): Promise<AIScannerQuota> {
  if (plan === "pro" || isDevelopmentUnlimited() || !clerkUserId) return quotaSnapshot(plan, 0, now);
  const rows = await ctx.db
    .query("aiScannerRequests")
    .withIndex("by_clerkUserId_and_periodKey_and_plan_and_countsTowardQuota", (q) => q
      .eq("clerkUserId", clerkUserId)
      .eq("periodKey", utcPeriodKey(now))
      .eq("plan", "free")
      .eq("countsTowardQuota", true))
    .take(aiScannerFreeMonthlyLimit() + 1);
  const used = rows.length;
  return quotaSnapshot(plan, used, now);
}

async function deviceAndPlan(ctx: MutationCtx, deviceId: string, deviceSecret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(deviceSecret));
  const credentialHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const device = await ctx.db.query("workspaceDevices").withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId)).unique();
  if (!device || device.revokedAt !== undefined || device.credentialHash !== credentialHash) return null;
  const workspace = await ctx.db.get(device.workspaceId);
  if (!workspace) return null;
  const now = Date.now();
  const entitlements = await ctx.db.query("entitlements")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", workspace.ownerClerkUserId)).take(100);
  const pro = entitlements.some((entitlement) =>
    entitlement.status === "active"
    && entitlement.validFrom <= now
    && (entitlement.expiresAt === undefined || entitlement.expiresAt > now));
  return { device, workspace, clerkUserId: workspace.ownerClerkUserId, plan: pro ? "pro" as const : "free" as const, now };
}

async function quotaUsed(ctx: MutationCtx, clerkUserId: string, now: number) {
  const rows = await ctx.db.query("aiScannerRequests")
    .withIndex("by_clerkUserId_and_periodKey_and_plan_and_countsTowardQuota", (q) => q
      .eq("clerkUserId", clerkUserId)
      .eq("periodKey", utcPeriodKey(now))
      .eq("plan", "free")
      .eq("countsTowardQuota", true))
    .take(aiScannerFreeMonthlyLimit() + 1);
  return rows.length;
}

function quotaResult(status: "reserved" | "succeeded" | "refunded" | "rejected", quota: AIScannerQuota, errorCode?: AIScannerQuotaError, value?: string | null, format?: string) {
  return { status, quota, ...(errorCode ? { errorCode } : {}), ...(value !== undefined ? { value } : {}), ...(format ? { format } : {}) };
}

export const reserveAIScannerRequest = internalMutation({
  args: {
    deviceId: v.string(), deviceSecret: v.string(), requestId: v.string(), mode: v.union(v.literal("upc"), v.literal("name")),
  },
  returns: resultValidator,
  handler: async (ctx, args) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args.requestId)) {
      throw new ConvexError("AI request id must be a UUID");
    }
    const principal = await deviceAndPlan(ctx, args.deviceId, args.deviceSecret);
    if (!principal) return quotaResult("rejected", { kind: "unlimited" }, "invalid-device");
    const existing = await ctx.db.query("aiScannerRequests")
      .withIndex("by_requestId", (q) => q.eq("requestId", args.requestId)).unique();
    if (existing) {
      if (existing.deviceId !== args.deviceId || existing.clerkUserId !== principal.clerkUserId) {
        return quotaResult("rejected", { kind: "unlimited" }, "invalid-device");
      }
      const quota = await aiScannerQuotaForAccess(ctx, principal.clerkUserId, principal.plan, principal.now);
      if (existing.status === "succeeded") return quotaResult("succeeded", quota, undefined, existing.value, existing.format);
      if (existing.status === "refunded") return quotaResult("refunded", quota, existing.errorCode, existing.value, existing.format);
      return quotaResult("rejected", quota, "request-in-progress");
    }
    const used = principal.plan === "free" ? await quotaUsed(ctx, principal.clerkUserId, principal.now) : 0;
    const quota = quotaSnapshot(principal.plan, used, principal.now);
    if (quota.kind === "metered" && quota.remaining <= 0) return quotaResult("rejected", quota, "quota-exhausted");
    const safetyRows = await ctx.db.query("aiScannerRequests")
      .withIndex("by_clerkUserId_and_createdAt", (q) => q.eq("clerkUserId", principal.clerkUserId).gt("createdAt", principal.now - AI_SCANNER_SAFETY_WINDOW_MS))
      .take(AI_SCANNER_SAFETY_LIMIT + 1);
    if (!isDevelopmentUnlimited() && safetyRows.length >= AI_SCANNER_SAFETY_LIMIT) return quotaResult("rejected", quota, "rate-limited");
    await ctx.db.insert("aiScannerRequests", {
      deviceId: args.deviceId,
      clerkUserId: principal.clerkUserId,
      requestId: args.requestId,
      mode: args.mode,
      periodKey: utcPeriodKey(principal.now),
      plan: principal.plan,
      status: "reserved",
      countsTowardQuota: true,
      createdAt: principal.now,
      updatedAt: principal.now,
    });
    return quotaResult("reserved", quotaSnapshot(principal.plan, used + 1, principal.now));
  },
});

const finishArgs = {
  deviceId: v.string(), deviceSecret: v.string(), requestId: v.string(),
};

export const completeAIScannerRequest = internalMutation({
  args: { ...finishArgs, mode: v.union(v.literal("upc"), v.literal("name")), value: v.union(v.string(), v.null()), format: v.string() },
  returns: v.object({ status: v.literal("succeeded"), quota: quotaValidator, value: v.union(v.string(), v.null()), format: v.string() }),
  handler: async (ctx, args) => {
    const principal = await deviceAndPlan(ctx, args.deviceId, args.deviceSecret);
    if (!principal) throw new ConvexError("Invalid or revoked device credential");
    const request = await ctx.db.query("aiScannerRequests").withIndex("by_requestId", (q) => q.eq("requestId", args.requestId)).unique();
    if (!request) throw new ConvexError("AI request reservation not found");
    if (request.deviceId !== args.deviceId || request.clerkUserId !== principal.clerkUserId || request.mode !== args.mode) {
      throw new ConvexError("Invalid AI request credential");
    }
    if (request.status === "succeeded") return { status: "succeeded" as const, quota: await aiScannerQuotaForAccess(ctx, principal.clerkUserId, principal.plan, principal.now), value: request.value ?? null, format: request.format ?? args.format };
    if (request.status !== "reserved") throw new ConvexError("AI request is no longer active");
    await ctx.db.patch(request._id, { status: "succeeded", value: args.value, format: args.format, updatedAt: principal.now });
    return { status: "succeeded" as const, quota: await aiScannerQuotaForAccess(ctx, principal.clerkUserId, principal.plan, principal.now), value: args.value, format: args.format };
  },
});

export const refundAIScannerRequest = internalMutation({
  args: { ...finishArgs, errorCode: v.union(v.literal("upstream-failed"), v.literal("upstream-timeout"), v.literal("invalid-input"), v.literal("upstream-rate-limited")) },
  returns: v.object({
    status: v.union(v.literal("refunded"), v.literal("succeeded")),
    quota: quotaValidator,
    value: v.optional(v.union(v.string(), v.null())),
    format: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const principal = await deviceAndPlan(ctx, args.deviceId, args.deviceSecret);
    if (!principal) throw new ConvexError("Invalid or revoked device credential");
    const request = await ctx.db.query("aiScannerRequests").withIndex("by_requestId", (q) => q.eq("requestId", args.requestId)).unique();
    if (!request) throw new ConvexError("AI request reservation not found");
    if (request.deviceId !== args.deviceId || request.clerkUserId !== principal.clerkUserId) throw new ConvexError("Invalid AI request credential");
    if (request.status === "succeeded") {
      return {
        status: "succeeded" as const,
        quota: await aiScannerQuotaForAccess(ctx, principal.clerkUserId, principal.plan, principal.now),
        value: request.value,
        ...(request.format ? { format: request.format } : {}),
      };
    }
    if (request.status === "reserved") {
      await ctx.db.patch(request._id, { status: "refunded", countsTowardQuota: false, errorCode: args.errorCode, updatedAt: principal.now });
    }
    return {
      status: "refunded" as const,
      quota: await aiScannerQuotaForAccess(ctx, principal.clerkUserId, principal.plan, principal.now),
      value: request.value,
      ...(request.format ? { format: request.format } : {}),
    };
  },
});
