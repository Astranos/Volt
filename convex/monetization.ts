import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

const DAY = 86_400_000;
export function workspaceLifecycleEnabled() {
  return process.env.WORKSPACE_STORAGE_POLICY_ENABLED === "true";
}
function limit(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 && value <= 1_000_000_000_000
    ? value
    : fallback;
}
export function monetizationOfferLimits() {
  return {
    workspace: {
      freeRecordsLimit: limit("WORKSPACE_FREE_RECORD_LIMIT", 1_000),
      paidRecordsLimit: limit("WORKSPACE_PAID_RECORD_LIMIT", 25_000),
      freeBytesLimit: limit("WORKSPACE_FREE_BYTE_LIMIT", 104_857_600),
      paidBytesLimit: limit("WORKSPACE_PAID_BYTE_LIMIT", 1_073_741_824),
      freeRetentionDays: 7,
      monthlyPriceUsd: 12,
    },
    api: {
      evaluationLimit: limit("PRODUCT_API_EVALUATION_LIMIT", 100),
      monthlyLimit: limit("PRODUCT_API_MONTHLY_LIMIT", 5_000),
      monthlyPriceUsd: 29,
    },
  };
}

function paidEnd(row: Doc<"webSubscriptions">): number {
  return Math.min(row.paidThrough ?? 0, row.endedAt ?? Infinity);
}
function hasPaidAccess(row: Doc<"webSubscriptions">, now: number) {
  return (
    paidEnd(row) > now &&
    ["active", "past_due", "canceled"].includes(row.status)
  );
}
export async function apiPolicyForOwner(
  ctx: Pick<QueryCtx, "db">,
  ownerTokenIdentifier: string,
  now = Date.now(),
) {
  const rows = await ctx.db
    .query("webSubscriptions")
    .withIndex("by_ownerTokenIdentifier_and_product", (q) =>
      q.eq("ownerTokenIdentifier", ownerTokenIdentifier).eq("product", "api"),
    )
    .take(100);
  const paid =
    process.env.PRODUCT_API_COMMERCIAL_ENABLED === "true" &&
    rows.some((row) => hasPaidAccess(row, now));
  const date = new Date(now);
  const offers = monetizationOfferLimits();
  return {
    tier: paid ? ("api" as const) : ("evaluation" as const),
    limit: paid ? offers.api.monthlyLimit : offers.api.evaluationLimit,
    periodKey: paid ? date.toISOString().slice(0, 7) : "evaluation",
    resetsAt: paid
      ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
      : null,
    paidThrough: paid
      ? Math.max(...rows.filter((row) => hasPaidAccess(row, now)).map(paidEnd))
      : null,
  };
}
export async function accountPolicy(
  ctx: Pick<QueryCtx, "db">,
  ownerClerkUserId: string,
  now = Date.now(),
) {
  const rows = await ctx.db
    .query("webSubscriptions")
    .withIndex("by_ownerClerkUserId_and_product", (q) =>
      q.eq("ownerClerkUserId", ownerClerkUserId).eq("product", "workspace"),
    )
    .take(100);
  // Volt is free, so old App Store and complimentary entitlements earn no longer history:
  // they would exempt an account from the 7-day window, or lock it read-only once they lapse.
  const paid = rows.some((row) => hasPaidAccess(row, now));
  const offers = monetizationOfferLimits();
  const latestEnd = Math.max(0, ...rows.map(paidEnd));
  const paidThrough = latestEnd > 0 ? latestEnd : null;
  const graceEndsAt = paidThrough === null ? null : paidThrough + 30 * DAY;
  return {
    workspace: {
      tier: paid ? ("workspace" as const) : ("free" as const),
      access:
        !paid && graceEndsAt !== null && now < graceEndsAt
          ? ("read_only" as const)
          : ("write" as const),
      retentionDays: paid ? null : offers.workspace.freeRetentionDays,
      recordsLimit: paid
        ? offers.workspace.paidRecordsLimit
        : offers.workspace.freeRecordsLimit,
      bytesLimit: paid
        ? offers.workspace.paidBytesLimit
        : offers.workspace.freeBytesLimit,
      paidThrough,
      graceEndsAt,
    },
  };
}
