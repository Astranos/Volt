import { convexTest } from "convex-test";
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const registerCustomer = makeFunctionReference<
  "mutation",
  { stripeCustomerId: string },
  { stripeCustomerId: string }
>("webBilling:registerCustomer");
const reserveCheckout = makeFunctionReference<
  "mutation",
  { product: "workspace" | "api"; requestKey: string },
  { acquired: boolean; requestKey: string }
>("webBilling:reserveCheckout");
const getCustomer = makeFunctionReference<
  "query",
  Record<string, never>,
  { stripeCustomerId: string } | null
>("webBilling:getCustomer");
type SubscriptionEvent = {
  eventId: string;
  eventCreated: number;
  stripeCustomerId: string;
  metadataOwnerClerkUserId: string;
  product: "workspace" | "api";
  stripeSubscriptionId: string;
  status: "active" | "past_due" | "canceled";
  currentPeriodEnd: number;
  paidThrough?: number;
  cancelAtPeriodEnd: boolean;
  endedAt?: number;
};
const applyEvent = makeFunctionReference<
  "mutation",
  SubscriptionEvent,
  "applied" | "duplicate" | "stale"
>("webBilling:applySubscriptionEvent");
const event = (
  overrides: Partial<SubscriptionEvent> = {},
): SubscriptionEvent => ({
  eventId: "evt_paid",
  eventCreated: 10,
  stripeCustomerId: "cus_alice",
  metadataOwnerClerkUserId: "alice",
  product: "workspace",
  stripeSubscriptionId: "sub_alice",
  status: "active",
  currentPeriodEnd: 2_000,
  paidThrough: 2_000,
  cancelAtPeriodEnd: false,
  ...overrides,
});
function asUser(t: ReturnType<typeof convexTest>, subject: string) {
  return t.withIdentity({ subject, tokenIdentifier: `clerk|${subject}` });
}

beforeEach(() => {
  vi.stubEnv("BILLING_ENABLED", "true");
  vi.stubEnv("APP_URL", "https://volt.example");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_fake");
  vi.stubEnv("STRIPE_WORKSPACE_PRICE_ID", "price_workspace");
  vi.stubEnv("STRIPE_API_PRICE_ID", "price_api");
});
afterEach(() => vi.unstubAllEnvs());

describe("server billing ledger", () => {
  test("billing query returns the same configured offers and keeps missing setup disabled", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const billing = makeFunctionReference<
      "query",
      Record<string, never>,
      {
        billingEnabled: boolean;
        offers: {
          workspace: { paidRecordsLimit: number };
          api: { monthlyLimit: number };
        };
        workspace: { checkoutEnabled: boolean };
        api: { checkoutEnabled: boolean };
      }
    >("webBilling:getAccountBilling");
    vi.stubEnv("WORKSPACE_PAID_RECORD_LIMIT", "30000");
    vi.stubEnv("PRODUCT_API_MONTHLY_LIMIT", "6000");
    expect(await alice.query(billing, {})).toMatchObject({
      offers: {
        workspace: { paidRecordsLimit: 30000 },
        api: { monthlyLimit: 6000 },
      },
      workspace: { checkoutEnabled: true },
      api: { checkoutEnabled: false },
    });
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    expect(await alice.query(billing, {})).toMatchObject({
      billingEnabled: false,
      workspace: { checkoutEnabled: false },
      api: { checkoutEnabled: false },
    });
  });

  test("requires verified identity and isolates customers, including customer race collisions", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const bob = asUser(t, "bob");
    await expect(
      t.mutation(registerCustomer, { stripeCustomerId: "cus_alice" }),
    ).rejects.toThrow("Authentication required");
    await alice.mutation(registerCustomer, { stripeCustomerId: "cus_alice" });
    await alice.mutation(registerCustomer, { stripeCustomerId: "cus_alice" });
    expect(await alice.query(getCustomer, {})).toMatchObject({
      stripeCustomerId: "cus_alice",
    });
    expect(await bob.query(getCustomer, {})).toBeNull();
    await expect(
      bob.mutation(registerCustomer, { stripeCustomerId: "cus_alice" }),
    ).rejects.toThrow("another account");
    await expect(
      alice.mutation(registerCustomer, { stripeCustomerId: "cus_other" }),
    ).rejects.toThrow("conflict");
    expect(
      await t.run((ctx) => ctx.db.query("webBillingCustomers").collect()),
    ).toHaveLength(1);
  });

  test("serializes checkout attempts and keeps API checkout disabled until commercial authorization", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    await alice.mutation(registerCustomer, { stripeCustomerId: "cus_alice" });
    const [a, b] = await Promise.all([
      alice.mutation(reserveCheckout, {
        product: "workspace",
        requestKey: "request_one",
      }),
      alice.mutation(reserveCheckout, {
        product: "workspace",
        requestKey: "request_two",
      }),
    ]);
    expect(a.requestKey).toBe(b.requestKey);
    expect([a.acquired, b.acquired].sort()).toEqual([false, true]);
    await expect(
      alice.mutation(reserveCheckout, {
        product: "api",
        requestKey: "api_one",
      }),
    ).rejects.toThrow("unavailable");
    vi.stubEnv("PRODUCT_API_COMMERCIAL_ENABLED", "true");
    expect(
      await alice.mutation(reserveCheckout, {
        product: "api",
        requestKey: "api_one",
      }),
    ).toMatchObject({ acquired: true });
    vi.stubEnv("BILLING_ENABLED", "false");
    await expect(
      alice.mutation(reserveCheckout, {
        product: "workspace",
        requestKey: "disabled",
      }),
    ).rejects.toThrow("unavailable");
  });

  test("atomically deduplicates events, binds ownership, and rejects stale status regression", async () => {
    const t = convexTest(schema, modules);
    await asUser(t, "alice").mutation(registerCustomer, {
      stripeCustomerId: "cus_alice",
    });
    await expect(
      t.mutation(applyEvent, event({ metadataOwnerClerkUserId: "bob" })),
    ).rejects.toThrow("ownership mismatch");
    expect(await t.mutation(applyEvent, event())).toBe("applied");
    expect(await t.mutation(applyEvent, event())).toBe("duplicate");
    expect(
      await t.mutation(
        applyEvent,
        event({ eventId: "evt_old", eventCreated: 9, status: "past_due" }),
      ),
    ).toBe("stale");
    expect(
      await t.run((ctx) => ctx.db.query("webSubscriptions").collect()),
    ).toMatchObject([{ status: "active", paidThrough: 2_000 }]);
    expect(
      await t.run((ctx) => ctx.db.query("webBillingEvents").collect()),
    ).toHaveLength(2);
  });

  test("failed renewals never extend paid access, and cancellation retains the paid period independently", async () => {
    const t = convexTest(schema, modules);
    await asUser(t, "alice").mutation(registerCustomer, {
      stripeCustomerId: "cus_alice",
    });
    await t.mutation(applyEvent, event());
    await t.mutation(
      applyEvent,
      event({
        eventId: "evt_failed",
        eventCreated: 11,
        status: "past_due",
        currentPeriodEnd: 3_000,
        paidThrough: undefined,
      }),
    );
    expect(
      await t.run((ctx) => ctx.db.query("webSubscriptions").collect()),
    ).toMatchObject([
      { status: "past_due", currentPeriodEnd: 3_000, paidThrough: 2_000 },
    ]);
    await t.mutation(
      applyEvent,
      event({
        eventId: "evt_paid_again",
        eventCreated: 12,
        currentPeriodEnd: 3_000,
        paidThrough: 3_000,
        cancelAtPeriodEnd: true,
      }),
    );
    await t.mutation(
      applyEvent,
      event({
        eventId: "evt_cancel",
        eventCreated: 13,
        status: "canceled",
        currentPeriodEnd: 3_000,
        paidThrough: undefined,
        endedAt: 2_500,
      }),
    );
    expect(
      await t.run((ctx) => ctx.db.query("webSubscriptions").collect()),
    ).toMatchObject([
      { status: "canceled", paidThrough: 3_000, endedAt: 2_500 },
    ]);
    expect(
      await t.mutation(
        applyEvent,
        event({ eventId: "evt_stale_same_second", eventCreated: 13 }),
      ),
    ).toBe("stale");
  });
});
