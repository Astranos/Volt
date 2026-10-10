"use node";

import Stripe from "stripe";
import { ConvexError, v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { billingConfiguration } from "./billingConfiguration";

const productValidator = v.union(v.literal("workspace"), v.literal("api"));
const redirectValidator = v.object({ url: v.string() });
type BillingProduct = "workspace" | "api";

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new ConvexError("Billing is unavailable");
  return new Stripe(key, { maxNetworkRetries: 2 });
}

function checkoutConfiguration(product: BillingProduct) {
  const config = billingConfiguration();
  const enabled =
    product === "workspace" ? config.workspaceEnabled : config.apiEnabled;
  const priceId =
    product === "workspace" ? config.workspacePrice : config.apiPrice;
  if (!enabled || !priceId || !config.appUrl)
    throw new ConvexError("Checkout is unavailable");
  return { priceId, appUrl: config.appUrl };
}

async function validatePrice(
  stripe: Stripe,
  priceId: string,
  product: BillingProduct,
) {
  const price = await stripe.prices.retrieve(priceId);
  if (
    !price.active ||
    price.currency !== "usd" ||
    price.unit_amount !== (product === "workspace" ? 1200 : 2900) ||
    price.type !== "recurring" ||
    price.recurring?.interval !== "month" ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== "licensed"
  )
    throw new ConvexError("Billing price is incorrectly configured");
}

export const createCheckout = action({
  args: { product: productValidator },
  returns: redirectValidator,
  handler: async (ctx, args): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Authentication required");
    const config = checkoutConfiguration(args.product);
    const stripe = stripeClient();
    await validatePrice(stripe, config.priceId, args.product);
    let customer = await ctx.runQuery(internal.webBilling.getCustomer, {});
    if (!customer) {
      const created = await stripe.customers.create(
        {
          metadata: { voltOwnerClerkUserId: identity.subject },
        },
        { idempotencyKey: `volt-customer-${identity.subject}` },
      );
      customer = await ctx.runMutation(internal.webBilling.registerCustomer, {
        stripeCustomerId: created.id,
      });
    }
    // Check Stripe as well as the local ledger while webhooks are still in flight.
    const subscriptions = await stripe.subscriptions.list({
      customer: customer.stripeCustomerId,
      status: "all",
      limit: 100,
    });
    if (
      subscriptions.has_more ||
      subscriptions.data.some(
        (subscription) =>
          !["canceled", "incomplete_expired"].includes(subscription.status) &&
          (subscription.metadata.voltProduct === args.product ||
            subscription.items.data.some(
              (item) => item.price.id === config.priceId,
            )),
      )
    )
      throw new ConvexError(
        "A subscription already exists; manage it in billing",
      );
    const reservation = await ctx.runMutation(
      internal.webBilling.reserveCheckout,
      { product: args.product, requestKey: crypto.randomUUID() },
    );
    if (reservation.sessionId) {
      const session = await stripe.checkout.sessions.retrieve(
        reservation.sessionId,
      );
      if (session.status !== "open" || !session.url)
        throw new ConvexError(
          "A checkout is already being processed; refresh billing shortly",
        );
      return { url: session.url };
    }
    const metadata = {
      voltOwnerClerkUserId: identity.subject,
      voltProduct: args.product,
    };
    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customer.stripeCustomerId,
        line_items: [{ price: config.priceId, quantity: 1 }],
        client_reference_id: identity.subject,
        metadata,
        subscription_data: { metadata },
        success_url: `${config.appUrl}/billing?billing=success`,
        cancel_url: `${config.appUrl}/billing?billing=canceled`,
        expires_at: Math.floor(reservation.expiresAt / 1000),
      },
      { idempotencyKey: `volt-checkout-${reservation.requestKey}` },
    );
    if (!session.url)
      throw new ConvexError("Stripe did not return a checkout URL");
    await ctx.runMutation(internal.webBilling.finishCheckout, {
      product: args.product,
      requestKey: reservation.requestKey,
      sessionId: session.id,
      url: session.url,
      expiresAt: session.expires_at * 1000,
    });
    return { url: session.url };
  },
});

export const createPortal = action({
  args: {},
  returns: redirectValidator,
  handler: async (ctx): Promise<{ url: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Authentication required");
    const config = billingConfiguration();
    if (!config.billingEnabled || !config.appUrl)
      throw new ConvexError("Billing is unavailable");
    const customer = await ctx.runQuery(internal.webBilling.getCustomer, {});
    if (!customer) throw new ConvexError("No billing account exists");
    const session = await stripeClient().billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: `${config.appUrl}/billing`,
    });
    return { url: session.url };
  },
});

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function objectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  return record(value) && typeof value.id === "string" ? value.id : null;
}
function subscriptionId(event: Stripe.Event): string | null {
  const object: unknown = event.data.object;
  if (!record(object)) return null;
  if (event.type.startsWith("customer.subscription.")) return objectId(object);
  if (event.type.startsWith("checkout.session."))
    return objectId(object.subscription);
  if (event.type.startsWith("invoice.")) {
    if (record(object.parent) && record(object.parent.subscription_details))
      return objectId(object.parent.subscription_details.subscription);
    return objectId(object.subscription);
  }
  return null;
}

function subscriptionStatus(value: string) {
  switch (value) {
    case "incomplete":
    case "incomplete_expired":
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "unpaid":
    case "paused":
      return value;
    default:
      throw new ConvexError("Unsupported subscription status");
  }
}

const handledEvents = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "invoice.marked_uncollectible",
  "invoice.voided",
]);

export const processWebhook = internalAction({
  args: { rawBody: v.string(), signature: v.string() },
  returns: v.object({ status: v.number() }),
  handler: async (ctx, args): Promise<{ status: number }> => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret || !process.env.STRIPE_SECRET_KEY) return { status: 503 };
    const stripe = stripeClient();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        args.rawBody,
        args.signature,
        secret,
      );
    } catch {
      return { status: 400 };
    }
    if (!handledEvents.has(event.type)) return { status: 200 };
    if (
      await ctx.runQuery(internal.webBilling.eventProcessed, {
        eventId: event.id,
      })
    )
      return { status: 200 };
    const id = subscriptionId(event);
    if (!id) return { status: 200 };
    // Snapshot events can be stale or arrive in any order. Use the authenticated
    // canonical resource, including its current invoice, for every update.
    const subscription = await stripe.subscriptions.retrieve(id, {
      expand: ["latest_invoice"],
    });
    const customerId = objectId(subscription.customer);
    const owner = subscription.metadata.voltOwnerClerkUserId;
    const product = subscription.metadata.voltProduct;
    if (!customerId || !owner || (product !== "workspace" && product !== "api"))
      return { status: 200 };
    const config = billingConfiguration();
    const priceId =
      product === "workspace" ? config.workspacePrice : config.apiPrice;
    const item = subscription.items.data[0];
    if (
      !priceId ||
      subscription.items.data.length !== 1 ||
      !item ||
      item.price.id !== priceId ||
      item.quantity !== 1
    )
      throw new ConvexError("Subscription price mismatch");
    const currentPeriodEnd = item.current_period_end * 1000;
    const latestInvoice = subscription.latest_invoice;
    const invoice =
      typeof latestInvoice === "string"
        ? await stripe.invoices.retrieve(latestInvoice)
        : latestInvoice;
    // Status alone is not proof of payment. An unpaid renewal preserves only
    // the last confirmed paid period rather than extending access.
    const paidLineEnds =
      invoice?.status === "paid" && objectId(invoice.customer) === customerId
        ? invoice.lines.data
            .filter((line) => {
              const value: unknown = line;
              if (!record(value)) return false;
              const legacyPrice = objectId(value.price);
              const pricing = value.pricing;
              const linePrice =
                record(pricing) && record(pricing.price_details)
                  ? objectId(pricing.price_details.price)
                  : legacyPrice;
              return linePrice === priceId && line.quantity === 1;
            })
            .map((line) => line.period.end * 1000)
        : [];
    const paidThrough = paidLineEnds.some((end) => end >= currentPeriodEnd)
      ? currentPeriodEnd
      : undefined;
    await ctx.runMutation(internal.webBilling.applySubscriptionEvent, {
      eventId: event.id,
      eventCreated: event.created,
      stripeCustomerId: customerId,
      metadataOwnerClerkUserId: owner,
      product,
      stripeSubscriptionId: subscription.id,
      status: subscriptionStatus(subscription.status),
      currentPeriodEnd,
      ...(paidThrough !== undefined ? { paidThrough } : {}),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      ...(subscription.ended_at !== null
        ? { endedAt: subscription.ended_at * 1000 }
        : {}),
    });
    return { status: 200 };
  },
});
