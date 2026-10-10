import { createHmac } from "node:crypto";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";

const mocks = vi.hoisted(() => ({
  customerCreate: vi.fn(),
  priceRetrieve: vi.fn(),
  subscriptionList: vi.fn(),
  subscriptionRetrieve: vi.fn(),
  sessionCreate: vi.fn(),
  sessionRetrieve: vi.fn(),
  portalCreate: vi.fn(),
  invoiceRetrieve: vi.fn(),
}));
vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("stripe")>();
  const sdk = new actual.default("sk_test_fake");
  return {
    default: class {
      customers = { create: mocks.customerCreate };
      prices = { retrieve: mocks.priceRetrieve };
      subscriptions = {
        list: mocks.subscriptionList,
        retrieve: mocks.subscriptionRetrieve,
      };
      checkout = {
        sessions: {
          create: mocks.sessionCreate,
          retrieve: mocks.sessionRetrieve,
        },
      };
      billingPortal = { sessions: { create: mocks.portalCreate } };
      invoices = { retrieve: mocks.invoiceRetrieve };
      webhooks = sdk.webhooks;
    },
  };
});
const modules = import.meta.glob("./**/*.ts");
const checkout = makeFunctionReference<
  "action",
  { product: "workspace" | "api" },
  { url: string }
>("stripeBilling:createCheckout");
const portal = makeFunctionReference<
  "action",
  Record<string, never>,
  { url: string }
>("stripeBilling:createPortal");
const webhook = makeFunctionReference<
  "action",
  { rawBody: string; signature: string },
  { status: number }
>("stripeBilling:processWebhook");
const register = makeFunctionReference<
  "mutation",
  { stripeCustomerId: string },
  { stripeCustomerId: string }
>("webBilling:registerCustomer");
function alice(t: ReturnType<typeof convexTest>) {
  return t.withIdentity({ subject: "alice", tokenIdentifier: "clerk|alice" });
}
function payload(
  type = "customer.subscription.updated",
  id = "evt_new",
  created = 20,
) {
  return JSON.stringify({
    id,
    object: "event",
    type,
    created,
    data: {
      object: { id: "sub_alice", object: "subscription", status: "active" },
    },
  });
}
function signature(rawBody: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  return `t=${timestamp},v1=${createHmac("sha256", "whsec_test").update(`${timestamp}.${rawBody}`).digest("hex")}`;
}
function canonical(status = "active", paid = true) {
  return {
    id: "sub_alice",
    customer: "cus_alice",
    metadata: { voltOwnerClerkUserId: "alice", voltProduct: "workspace" },
    status,
    cancel_at_period_end: false,
    ended_at: status === "canceled" ? 100 : null,
    items: {
      data: [
        {
          id: "si_workspace",
          current_period_end: 200,
          price: { id: "price_workspace" },
          quantity: 1,
        },
      ],
    },
    latest_invoice: {
      status: paid ? "paid" : "open",
      customer: "cus_alice",
      period_end: 100,
      lines: {
        data: [
          {
            pricing: { price_details: { price: "price_workspace" } },
            quantity: 1,
            period: { end: 200 },
          },
        ],
      },
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("BILLING_ENABLED", "true");
  vi.stubEnv("APP_URL", "https://volt.example");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fake");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
  vi.stubEnv("STRIPE_WORKSPACE_PRICE_ID", "price_workspace");
  vi.stubEnv("STRIPE_API_PRICE_ID", "price_api");
  vi.stubEnv("PRODUCT_API_COMMERCIAL_ENABLED", "false");
  mocks.priceRetrieve.mockResolvedValue({
    active: true,
    currency: "usd",
    unit_amount: 1200,
    type: "recurring",
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
  });
  mocks.customerCreate.mockResolvedValue({ id: "cus_alice" });
  mocks.subscriptionList.mockResolvedValue({ data: [], has_more: false });
  mocks.sessionCreate.mockResolvedValue({
    id: "cs_one",
    url: "https://checkout.stripe.com/c/pay",
    expires_at: Math.floor(Date.now() / 1000) + 1860,
  });
  mocks.portalCreate.mockResolvedValue({
    url: "https://billing.stripe.com/p/session",
  });
  mocks.subscriptionRetrieve.mockResolvedValue(canonical());
});
afterEach(() => vi.unstubAllEnvs());

describe("Stripe server boundary", () => {
  test("requires auth and server commercial configuration before external calls", async () => {
    const t = convexTest(schema, modules);
    await expect(t.action(checkout, { product: "workspace" })).rejects.toThrow(
      "Authentication required",
    );
    await expect(alice(t).action(checkout, { product: "api" })).rejects.toThrow(
      "unavailable",
    );
    vi.stubEnv("APP_URL", "https://volt.example.evil/path");
    await expect(
      alice(t).action(checkout, { product: "workspace" }),
    ).rejects.toThrow("unavailable");
    expect(mocks.customerCreate).not.toHaveBeenCalled();
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });
  test("creates configured recurring checkout with server owner and returns existing open checkout", async () => {
    const t = convexTest(schema, modules);
    const user = alice(t);
    expect(await user.action(checkout, { product: "workspace" })).toEqual({
      url: "https://checkout.stripe.com/c/pay",
    });
    expect(mocks.customerCreate).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { voltOwnerClerkUserId: "alice" } }),
      { idempotencyKey: "volt-customer-alice" },
    );
    expect(mocks.sessionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_alice",
        line_items: [{ price: "price_workspace", quantity: 1 }],
        success_url: "https://volt.example/billing?billing=success",
        subscription_data: {
          metadata: { voltOwnerClerkUserId: "alice", voltProduct: "workspace" },
        },
      }),
      expect.objectContaining({
        idempotencyKey: expect.stringMatching(/^volt-checkout-/),
      }),
    );
    mocks.sessionRetrieve.mockResolvedValue({
      status: "open",
      url: "https://checkout.stripe.com/c/pay",
    });
    await user.action(checkout, { product: "workspace" });
    expect(mocks.customerCreate).toHaveBeenCalledTimes(1);
    expect(mocks.sessionCreate).toHaveBeenCalledTimes(1);
  });
  test("blocks existing canonical subscriptions before a delayed webhook and rejects price mistakes", async () => {
    const t = convexTest(schema, modules);
    const user = alice(t);
    mocks.subscriptionList.mockResolvedValue({
      data: [
        {
          status: "active",
          metadata: {},
          items: { data: [{ price: { id: "price_workspace" } }] },
        },
      ],
      has_more: false,
    });
    await expect(
      user.action(checkout, { product: "workspace" }),
    ).rejects.toThrow("already exists");
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
    mocks.priceRetrieve.mockResolvedValue({
      active: true,
      currency: "usd",
      unit_amount: 2900,
      type: "recurring",
      recurring: {
        interval: "month",
        interval_count: 1,
        usage_type: "licensed",
      },
    });
    await expect(
      user.action(checkout, { product: "workspace" }),
    ).rejects.toThrow("incorrectly configured");
  });
  test("portal customer comes from the verified account mapping", async () => {
    const t = convexTest(schema, modules);
    const user = alice(t);
    await expect(user.action(portal, {})).rejects.toThrow("No billing account");
    await user.mutation(register, { stripeCustomerId: "cus_alice" });
    await user.action(portal, {});
    expect(mocks.portalCreate).toHaveBeenCalledWith({
      customer: "cus_alice",
      return_url: "https://volt.example/billing",
    });
    await expect(
      t
        .withIdentity({ subject: "bob", tokenIdentifier: "clerk|bob" })
        .action(portal, {}),
    ).rejects.toThrow("No billing account");
  });
  test("verifies untouched raw signed bodies with the actual SDK before any fetch", async () => {
    const t = convexTest(schema, modules);
    const rawBody = payload();
    expect(await t.action(webhook, { rawBody, signature: "bad" })).toEqual({
      status: 400,
    });
    expect(
      await t.action(webhook, {
        rawBody: `${rawBody} `,
        signature: signature(rawBody),
      }),
    ).toEqual({ status: 400 });
    expect(mocks.subscriptionRetrieve).not.toHaveBeenCalled();
  });
  test("canonical failed payment overrides active snapshot; paid canonical invoice lines alone extend access", async () => {
    const t = convexTest(schema, modules);
    await alice(t).mutation(register, { stripeCustomerId: "cus_alice" });
    let rawBody = payload();
    mocks.subscriptionRetrieve.mockResolvedValue(canonical("past_due", false));
    expect(
      await t.action(webhook, { rawBody, signature: signature(rawBody) }),
    ).toEqual({ status: 200 });
    expect(
      await t.run((ctx) => ctx.db.query("webSubscriptions").collect()),
    ).toMatchObject([{ status: "past_due", currentPeriodEnd: 200_000 }]);
    expect(
      await t.run((ctx) => ctx.db.query("webSubscriptions").first()),
    ).not.toHaveProperty("paidThrough");
    mocks.subscriptionRetrieve.mockResolvedValue(canonical());
    rawBody = payload("customer.subscription.updated", "evt_paid", 21);
    await t.action(webhook, { rawBody, signature: signature(rawBody) });
    await t.action(webhook, { rawBody, signature: signature(rawBody) });
    expect(
      await t.run((ctx) => ctx.db.query("webSubscriptions").collect()),
    ).toMatchObject([{ status: "active", paidThrough: 200_000 }]);
    expect(mocks.subscriptionRetrieve).toHaveBeenCalledTimes(2);
    expect(mocks.subscriptionRetrieve).toHaveBeenCalledWith("sub_alice", {
      expand: ["latest_invoice"],
    });
  });
  test("rejects canonical customer metadata claiming a different owner", async () => {
    const t = convexTest(schema, modules);
    await alice(t).mutation(register, { stripeCustomerId: "cus_alice" });
    mocks.subscriptionRetrieve.mockResolvedValue({
      ...canonical(),
      metadata: { voltOwnerClerkUserId: "bob", voltProduct: "workspace" },
    });
    const rawBody = payload();
    await expect(
      t.action(webhook, { rawBody, signature: signature(rawBody) }),
    ).rejects.toThrow("ownership mismatch");
    expect(
      await t.run((ctx) => ctx.db.query("webSubscriptions").collect()),
    ).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query("webBillingEvents").collect()),
    ).toHaveLength(0);
  });
});
