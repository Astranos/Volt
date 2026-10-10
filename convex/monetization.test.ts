import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import {
  accountPolicy,
  apiPolicyForOwner,
  workspaceLifecycleEnabled,
  monetizationOfferLimits,
} from "./monetization";
import { billingConfiguration } from "./billingConfiguration";

const modules = import.meta.glob("./**/*.ts");
const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 5, 12);
type Subscription = {
  product?: "workspace" | "api";
  status?:
    | "active"
    | "past_due"
    | "canceled"
    | "incomplete"
    | "paused"
    | "unpaid";
  paidThrough?: number;
  endedAt?: number;
  currentPeriodEnd?: number;
};
async function insertSubscription(
  t: ReturnType<typeof convexTest>,
  overrides: Subscription = {},
) {
  return t.run((ctx) =>
    ctx.db.insert("webSubscriptions", {
      ownerClerkUserId: "alice",
      ownerTokenIdentifier: "clerk|alice",
      stripeCustomerId: "cus_alice",
      stripeSubscriptionId: "sub_alice",
      product: "workspace",
      status: "active",
      currentPeriodEnd: now + DAY,
      paidThrough: now + DAY,
      cancelAtPeriodEnd: false,
      updatedAt: now,
      lastEventCreated: 20,
      ...overrides,
    }),
  );
}
async function insertLegacy(
  t: ReturnType<typeof convexTest>,
  status: "active" | "expired" | "revoked",
  expiresAt?: number,
) {
  return t.run((ctx) =>
    ctx.db.insert("entitlements", {
      clerkUserId: "alice",
      kind: "storekit",
      sourceIdentifier: "apple_original",
      productId: "full_app",
      status,
      validFrom: now - 100 * DAY,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      updatedAt: now - DAY,
    }),
  );
}
function workspace(t: ReturnType<typeof convexTest>, time = now) {
  return t.run(
    async (ctx) => (await accountPolicy(ctx, "alice", time)).workspace,
  );
}

beforeEach(() => {
  vi.stubEnv("VOLT_ENTITLEMENT_BYPASS", "");
  vi.stubEnv("WORKSPACE_STORAGE_POLICY_ENABLED", "");
  vi.stubEnv("BILLING_ENABLED", "");
  vi.stubEnv("PRODUCT_API_COMMERCIAL_ENABLED", "");
  for (const key of [
    "WORKSPACE_PAID_RECORD_LIMIT",
    "WORKSPACE_FREE_RECORD_LIMIT",
    "WORKSPACE_PAID_BYTE_LIMIT",
    "WORKSPACE_FREE_BYTE_LIMIT",
    "PRODUCT_API_MONTHLY_LIMIT",
    "PRODUCT_API_EVALUATION_LIMIT",
  ])
    vi.stubEnv(key, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("monetization entitlement policy", () => {
  test("a fresh account defaults to free history and lifetime API evaluation with all rollouts disabled", async () => {
    const t = convexTest(schema, modules);
    expect(await workspace(t)).toMatchObject({
      tier: "free",
      access: "write",
      retentionDays: 7,
      recordsLimit: 1_000,
      bytesLimit: 104_857_600,
      paidThrough: null,
      graceEndsAt: null,
    });
    expect(
      await t.run((ctx) => apiPolicyForOwner(ctx, "clerk|alice", now)),
    ).toMatchObject({
      tier: "evaluation",
      limit: 100,
      periodKey: "evaluation",
      resetsAt: null,
    });
    expect(workspaceLifecycleEnabled()).toBe(false);
    expect(billingConfiguration().billingEnabled).toBe(false);
    vi.stubEnv("WORKSPACE_STORAGE_POLICY_ENABLED", "TRUE");
    expect(workspaceLifecycleEnabled()).toBe(false);
  });

  test("active legacy purchases retain paid workspace access, including perpetual grants", async () => {
    const t = convexTest(schema, modules);
    await insertLegacy(t, "active", now + DAY);
    expect(await workspace(t)).toMatchObject({
      tier: "workspace",
      access: "write",
      retentionDays: null,
      recordsLimit: 25_000,
      bytesLimit: 1_073_741_824,
      paidThrough: now + DAY,
    });
    const perpetual = convexTest(schema, modules);
    await insertLegacy(perpetual, "active");
    expect(await workspace(perpetual)).toMatchObject({
      tier: "workspace",
      access: "write",
      retentionDays: null,
      paidThrough: null,
    });
  });

  test("expired legacy purchases enter exactly thirty days of read-only grace", async () => {
    const t = convexTest(schema, modules);
    await insertLegacy(t, "expired", now - DAY);
    expect(await workspace(t)).toMatchObject({
      tier: "free",
      access: "read_only",
      paidThrough: now - DAY,
      graceEndsAt: now + 29 * DAY,
    });
    expect(await workspace(t, now + 29 * DAY - 1)).toMatchObject({
      access: "read_only",
    });
    expect(await workspace(t, now + 29 * DAY)).toMatchObject({
      tier: "free",
      access: "write",
    });
  });

  test("legacy revocation begins grace at revocation, not a still-future purchase expiration", async () => {
    const t = convexTest(schema, modules);
    await insertLegacy(t, "revoked", now + 20 * DAY);
    expect(await workspace(t)).toMatchObject({
      tier: "free",
      access: "read_only",
      paidThrough: now - DAY,
      graceEndsAt: now + 29 * DAY,
    });
  });

  test("Stripe paid periods survive scheduled cancellation and delinquency without unpaid extensions", async () => {
    const t = convexTest(schema, modules);
    await insertSubscription(t, {
      status: "past_due",
      currentPeriodEnd: now + 31 * DAY,
    });
    expect(await workspace(t)).toMatchObject({
      tier: "workspace",
      paidThrough: now + DAY,
    });
    expect(await workspace(t, now + DAY)).toMatchObject({
      tier: "free",
      access: "read_only",
      graceEndsAt: now + 31 * DAY,
    });
    const canceled = convexTest(schema, modules);
    await insertSubscription(canceled, { status: "canceled" });
    expect(await workspace(canceled)).toMatchObject({
      tier: "workspace",
      paidThrough: now + DAY,
    });
    const ended = convexTest(schema, modules);
    await insertSubscription(ended, { status: "canceled", endedAt: now - DAY });
    expect(await workspace(ended)).toMatchObject({
      tier: "free",
      access: "read_only",
      paidThrough: now - DAY,
    });
  });

  test("active status without payment proof grants neither paid workspace nor a fabricated grace period", async () => {
    const t = convexTest(schema, modules);
    await insertSubscription(t, { paidThrough: undefined });
    expect(await workspace(t)).toMatchObject({
      tier: "free",
      access: "write",
      paidThrough: null,
      graceEndsAt: null,
    });
  });

  test("out-of-order webhooks cannot change a canceled subscription back to paid access", async () => {
    const t = convexTest(schema, modules);
    await insertSubscription(t, { status: "canceled", endedAt: now - DAY });
    await t.run((ctx) =>
      ctx.db.insert("webBillingCustomers", {
        ownerClerkUserId: "alice",
        ownerTokenIdentifier: "clerk|alice",
        stripeCustomerId: "cus_alice",
        createdAt: now,
      }),
    );
    const apply = makeFunctionReference<
      "mutation",
      {
        eventId: string;
        eventCreated: number;
        stripeCustomerId: string;
        metadataOwnerClerkUserId: string;
        product: "workspace";
        stripeSubscriptionId: string;
        status: "active";
        currentPeriodEnd: number;
        paidThrough: number;
        cancelAtPeriodEnd: boolean;
      },
      string
    >("webBilling:applySubscriptionEvent");
    expect(
      await t.mutation(apply, {
        eventId: "evt_old",
        eventCreated: 19,
        stripeCustomerId: "cus_alice",
        metadataOwnerClerkUserId: "alice",
        product: "workspace",
        stripeSubscriptionId: "sub_alice",
        status: "active",
        currentPeriodEnd: now + 31 * DAY,
        paidThrough: now + 31 * DAY,
        cancelAtPeriodEnd: false,
      }),
    ).toBe("stale");
    expect(await workspace(t)).toMatchObject({
      tier: "free",
      access: "read_only",
      paidThrough: now - DAY,
    });
  });

  test("paid API is separate from workspace and commercial authorization is mandatory", async () => {
    const t = convexTest(schema, modules);
    await insertSubscription(t, { product: "api" });
    expect(await workspace(t)).toMatchObject({ tier: "free" });
    expect(
      await t.run((ctx) => apiPolicyForOwner(ctx, "clerk|alice", now)),
    ).toMatchObject({ tier: "evaluation", limit: 100 });
    vi.stubEnv("PRODUCT_API_COMMERCIAL_ENABLED", "true");
    expect(
      await t.run((ctx) => apiPolicyForOwner(ctx, "clerk|alice", now)),
    ).toMatchObject({
      tier: "api",
      limit: 5_000,
      periodKey: "2026-10",
      resetsAt: Date.UTC(2026, 10, 1),
      paidThrough: now + DAY,
    });
    expect(
      await t.run((ctx) => apiPolicyForOwner(ctx, "clerk|bob", now)),
    ).toMatchObject({ tier: "evaluation" });
  });

  test("invalid and excessive environment limits retain conservative defaults", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("WORKSPACE_FREE_RECORD_LIMIT", "-1");
    vi.stubEnv("WORKSPACE_FREE_BYTE_LIMIT", "Infinity");
    vi.stubEnv("PRODUCT_API_EVALUATION_LIMIT", "1.5");
    expect(await workspace(t)).toMatchObject({
      recordsLimit: 1_000,
      bytesLimit: 104_857_600,
    });
    expect(
      await t.run((ctx) => apiPolicyForOwner(ctx, "clerk|alice", now)),
    ).toMatchObject({ limit: 100 });
    vi.stubEnv("WORKSPACE_FREE_RECORD_LIMIT", "1000000000001");
    expect(await workspace(t)).toMatchObject({ recordsLimit: 1_000 });
    vi.stubEnv("WORKSPACE_FREE_RECORD_LIMIT", "250");
    expect(await workspace(t)).toMatchObject({ recordsLimit: 250 });
    expect(monetizationOfferLimits()).toMatchObject({
      workspace: {
        freeRecordsLimit: 250,
        paidRecordsLimit: 25_000,
        monthlyPriceUsd: 12,
      },
      api: { evaluationLimit: 100, monthlyLimit: 5_000, monthlyPriceUsd: 29 },
    });
  });
});
