import { ConvexError, v } from "convex/values";
import { billingConfiguration } from "./billingConfiguration";
import { monetizationOfferLimits } from "./monetization";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const billingProduct = v.union(v.literal("workspace"), v.literal("api"));
export const billingStatus = v.union(
  v.literal("incomplete"),
  v.literal("incomplete_expired"),
  v.literal("trialing"),
  v.literal("active"),
  v.literal("past_due"),
  v.literal("canceled"),
  v.literal("unpaid"),
  v.literal("paused"),
);
const customerFields = {
  ownerClerkUserId: v.string(),
  ownerTokenIdentifier: v.string(),
  stripeCustomerId: v.string(),
};
const customerValidator = v.object(customerFields);
const checkoutFields = {
  requestKey: v.string(),
  expiresAt: v.number(),
  sessionId: v.optional(v.string()),
  url: v.optional(v.string()),
};
const offersValidator = v.object({
  workspace: v.object({
    freeRecordsLimit: v.number(),
    paidRecordsLimit: v.number(),
    freeBytesLimit: v.number(),
    paidBytesLimit: v.number(),
    freeRetentionDays: v.number(),
    monthlyPriceUsd: v.number(),
  }),
  api: v.object({
    evaluationLimit: v.number(),
    monthlyLimit: v.number(),
    monthlyPriceUsd: v.number(),
  }),
});

const planView = v.object({
  checkoutEnabled: v.boolean(),
  status: v.union(billingStatus, v.null()),
  currentPeriodEnd: v.union(v.number(), v.null()),
  paidThrough: v.union(v.number(), v.null()),
  cancelAtPeriodEnd: v.boolean(),
});

async function requireIdentity(ctx: Pick<QueryCtx | MutationCtx, "auth">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Authentication required");
  return identity;
}

async function ownCustomer(ctx: QueryCtx | MutationCtx) {
  const identity = await requireIdentity(ctx);
  const customer = await ctx.db
    .query("webBillingCustomers")
    .withIndex("by_ownerClerkUserId", (q) =>
      q.eq("ownerClerkUserId", identity.subject),
    )
    .unique();
  if (customer && customer.ownerTokenIdentifier !== identity.tokenIdentifier)
    throw new ConvexError("Billing identity mismatch");
  return { identity, customer };
}

export const getCustomer = internalQuery({
  args: {},
  returns: v.union(customerValidator, v.null()),
  handler: async (ctx) => {
    const { customer } = await ownCustomer(ctx);
    return customer
      ? {
          ownerClerkUserId: customer.ownerClerkUserId,
          ownerTokenIdentifier: customer.ownerTokenIdentifier,
          stripeCustomerId: customer.stripeCustomerId,
        }
      : null;
  },
});

export const registerCustomer = internalMutation({
  args: { stripeCustomerId: v.string() },
  returns: customerValidator,
  handler: async (ctx, args) => {
    const { identity, customer } = await ownCustomer(ctx);
    if (customer && customer.stripeCustomerId !== args.stripeCustomerId)
      throw new ConvexError("Billing customer conflict");
    const mapped = await ctx.db
      .query("webBillingCustomers")
      .withIndex("by_stripeCustomerId", (q) =>
        q.eq("stripeCustomerId", args.stripeCustomerId),
      )
      .unique();
    if (mapped && mapped.ownerClerkUserId !== identity.subject)
      throw new ConvexError("Billing customer belongs to another account");
    const row = {
      ownerClerkUserId: identity.subject,
      ownerTokenIdentifier: identity.tokenIdentifier,
      stripeCustomerId: args.stripeCustomerId,
    };
    if (!customer)
      await ctx.db.insert("webBillingCustomers", {
        ...row,
        createdAt: Date.now(),
      });
    return row;
  },
});

export const reserveCheckout = internalMutation({
  args: { product: billingProduct, requestKey: v.string() },
  returns: v.object({ ...checkoutFields, acquired: v.boolean() }),
  handler: async (ctx, args) => {
    const { customer } = await ownCustomer(ctx);
    if (!customer) throw new ConvexError("Billing customer missing");
    const config = billingConfiguration();
    if (
      !(args.product === "workspace"
        ? config.workspaceEnabled
        : config.apiEnabled)
    )
      throw new ConvexError("Checkout is unavailable");
    const subscriptions = await ctx.db
      .query("webSubscriptions")
      .withIndex("by_ownerClerkUserId_and_product", (q) =>
        q
          .eq("ownerClerkUserId", customer.ownerClerkUserId)
          .eq("product", args.product),
      )
      .take(50);
    if (
      subscriptions.some(
        (s) => !["canceled", "incomplete_expired"].includes(s.status),
      )
    )
      throw new ConvexError(
        "A subscription already exists; manage it in billing",
      );
    const field =
      args.product === "workspace" ? "workspaceCheckout" : "apiCheckout";
    const existing = customer[field];
    if (existing && existing.expiresAt > Date.now())
      return { ...existing, acquired: false };
    const reservation = {
      requestKey: args.requestKey,
      expiresAt: Date.now() + 31 * 60_000,
    };
    await ctx.db.patch(customer._id, { [field]: reservation });
    return { ...reservation, acquired: true };
  },
});

export const finishCheckout = internalMutation({
  args: {
    product: billingProduct,
    requestKey: v.string(),
    sessionId: v.string(),
    url: v.string(),
    expiresAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { customer } = await ownCustomer(ctx);
    const field =
      args.product === "workspace" ? "workspaceCheckout" : "apiCheckout";
    if (!customer || customer[field]?.requestKey !== args.requestKey)
      throw new ConvexError("Checkout reservation changed");
    await ctx.db.patch(customer._id, {
      [field]: {
        requestKey: args.requestKey,
        sessionId: args.sessionId,
        url: args.url,
        expiresAt: args.expiresAt,
      },
    });
    return null;
  },
});

export const getAccountBilling = query({
  args: {},
  returns: v.object({
    billingEnabled: v.boolean(),
    portalEnabled: v.boolean(),
    workspace: planView,
    api: planView,
    offers: offersValidator,
  }),
  handler: async (ctx) => {
    const { identity, customer } = await ownCustomer(ctx);
    const config = billingConfiguration();
    const view = async (product: "workspace" | "api", enabled: boolean) => {
      const subscriptions = await ctx.db
        .query("webSubscriptions")
        .withIndex("by_ownerClerkUserId_and_product", (q) =>
          q.eq("ownerClerkUserId", identity.subject).eq("product", product),
        )
        .take(50);
      const current =
        subscriptions
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .find(
            (s) => !["canceled", "incomplete_expired"].includes(s.status),
          ) ?? subscriptions[0];
      return {
        checkoutEnabled:
          enabled &&
          !subscriptions.some(
            (s) => !["canceled", "incomplete_expired"].includes(s.status),
          ),
        status: current?.status ?? null,
        currentPeriodEnd: current?.currentPeriodEnd ?? null,
        paidThrough: current?.paidThrough ?? null,
        cancelAtPeriodEnd: current?.cancelAtPeriodEnd ?? false,
      };
    };
    return {
      offers: monetizationOfferLimits(),
      billingEnabled: config.billingEnabled,
      portalEnabled: config.billingEnabled && Boolean(customer),
      workspace: await view("workspace", config.workspaceEnabled),
      api: await view("api", config.apiEnabled),
    };
  },
});

export const eventProcessed = internalQuery({
  args: { eventId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) =>
    Boolean(
      await ctx.db
        .query("webBillingEvents")
        .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
        .unique(),
    ),
});

export const applySubscriptionEvent = internalMutation({
  args: {
    eventId: v.string(),
    eventCreated: v.number(),
    stripeCustomerId: v.string(),
    metadataOwnerClerkUserId: v.string(),
    product: billingProduct,
    stripeSubscriptionId: v.string(),
    status: billingStatus,
    currentPeriodEnd: v.number(),
    paidThrough: v.optional(v.number()),
    cancelAtPeriodEnd: v.boolean(),
    endedAt: v.optional(v.number()),
  },
  returns: v.union(
    v.literal("applied"),
    v.literal("duplicate"),
    v.literal("stale"),
  ),
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("webBillingEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (event) return "duplicate";
    const customer = await ctx.db
      .query("webBillingCustomers")
      .withIndex("by_stripeCustomerId", (q) =>
        q.eq("stripeCustomerId", args.stripeCustomerId),
      )
      .unique();
    if (
      !customer ||
      customer.ownerClerkUserId !== args.metadataOwnerClerkUserId
    )
      throw new ConvexError("Subscription customer ownership mismatch");
    const existing = await ctx.db
      .query("webSubscriptions")
      .withIndex("by_stripeSubscriptionId", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId),
      )
      .unique();
    if (
      existing &&
      (existing.ownerClerkUserId !== customer.ownerClerkUserId ||
        existing.stripeCustomerId !== customer.stripeCustomerId ||
        existing.product !== args.product)
    )
      throw new ConvexError("Subscription ownership mismatch");
    await ctx.db.insert("webBillingEvents", {
      eventId: args.eventId,
      eventCreated: args.eventCreated,
      processedAt: Date.now(),
    });
    if (
      existing &&
      (args.eventCreated < existing.lastEventCreated ||
        (existing.status === "canceled" && args.status !== "canceled"))
    )
      return "stale";
    const values = {
      ownerClerkUserId: customer.ownerClerkUserId,
      ownerTokenIdentifier: customer.ownerTokenIdentifier,
      product: args.product,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      status: args.status,
      currentPeriodEnd: args.currentPeriodEnd,
      ...(args.paidThrough !== undefined || existing?.paidThrough !== undefined
        ? {
            paidThrough: Math.max(
              args.paidThrough ?? 0,
              existing?.paidThrough ?? 0,
            ),
          }
        : {}),
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      ...(args.endedAt !== undefined ? { endedAt: args.endedAt } : {}),
      updatedAt: Date.now(),
      lastEventCreated: args.eventCreated,
    };
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert("webSubscriptions", values);
    return "applied";
  },
});
