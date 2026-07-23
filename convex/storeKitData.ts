import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { storeKitProductId } from "./access";

const sourceValidator = v.union(v.literal("client"), v.literal("notification"));

export const applyVerifiedTransaction = internalMutation({
  args: {
    transactionId: v.string(),
    originalTransactionId: v.string(),
    appAccountToken: v.string(),
    productId: v.string(),
    environment: v.string(),
    purchaseDate: v.number(),
    expiresDate: v.number(),
    revocationDate: v.optional(v.number()),
    signedDate: v.number(),
    source: sourceValidator,
    expectedClerkUserId: v.optional(v.string()),
    notification: v.optional(
      v.object({
        notificationUUID: v.string(),
        notificationType: v.string(),
        subtype: v.optional(v.string()),
        signedDate: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    if (args.productId !== storeKitProductId()) {
      return { statusCode: 400, body: { error: "Unexpected StoreKit product" } };
    }
    if (args.notification) {
      const existingNotification = await ctx.db
        .query("storeKitNotifications")
        .withIndex("by_notificationUUID", (query) =>
          query.eq("notificationUUID", args.notification?.notificationUUID ?? ""),
        )
        .unique();
      if (existingNotification) {
        return { statusCode: 200, body: { accepted: true, idempotent: true } };
      }
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_appAccountToken", (query) => query.eq("appAccountToken", args.appAccountToken))
      .unique();
    if (!user) return { statusCode: 409, body: { error: "Unknown appAccountToken" } };
    if (args.expectedClerkUserId && user.clerkUserId !== args.expectedClerkUserId) {
      return { statusCode: 403, body: { error: "Transaction belongs to another account" } };
    }

    const now = Date.now();
    const existingTransaction = await ctx.db
      .query("storeKitTransactions")
      .withIndex("by_transactionId", (query) => query.eq("transactionId", args.transactionId))
      .unique();
    if (
      existingTransaction &&
      (existingTransaction.originalTransactionId !== args.originalTransactionId ||
        existingTransaction.clerkUserId !== user.clerkUserId ||
        existingTransaction.appAccountToken !== args.appAccountToken ||
        existingTransaction.productId !== args.productId ||
        existingTransaction.environment !== args.environment)
    ) {
      return { statusCode: 409, body: { error: "StoreKit transaction identity changed" } };
    }

    if (args.notification) {
      await ctx.db.insert("storeKitNotifications", {
        notificationUUID: args.notification.notificationUUID,
        notificationType: args.notification.notificationType,
        ...(args.notification.subtype ? { subtype: args.notification.subtype } : {}),
        ...(args.notification.signedDate !== undefined
          ? { signedDate: args.notification.signedDate }
          : {}),
        transactionId: args.transactionId,
        receivedAt: now,
      });
    }

    if (existingTransaction && (existingTransaction.signedDate ?? -1) >= args.signedDate) {
      const entitlement = await ctx.db
        .query("entitlements")
        .withIndex("by_clerkUserId_and_sourceIdentifier", (query) =>
          query
            .eq("clerkUserId", user.clerkUserId)
            .eq("sourceIdentifier", args.originalTransactionId),
        )
        .unique();
      return {
        statusCode: 200,
        body: {
          accepted: true,
          idempotent: true,
          stale: true,
          ...(entitlement
            ? {
                subscriptionStatus: entitlement.status === "active" ? "active" : "expired",
                ...(entitlement.expiresAt !== undefined ? { expiresAt: entitlement.expiresAt } : {}),
              }
            : {}),
        },
      };
    }

    const transaction = {
      transactionId: args.transactionId,
      originalTransactionId: args.originalTransactionId,
      clerkUserId: user.clerkUserId,
      appAccountToken: args.appAccountToken,
      productId: args.productId,
      environment: args.environment,
      purchaseDate: args.purchaseDate,
      expiresDate: args.expiresDate,
      signedDate: args.signedDate,
      ...(args.revocationDate !== undefined ? { revocationDate: args.revocationDate } : {}),
      source: args.source,
      updatedAt: now,
    };
    if (existingTransaction) await ctx.db.replace(existingTransaction._id, transaction);
    else await ctx.db.insert("storeKitTransactions", transaction);

    const transactions = await ctx.db
      .query("storeKitTransactions")
      .withIndex("by_originalTransactionId", (query) =>
        query.eq("originalTransactionId", args.originalTransactionId),
      )
      .collect();
    const productTransactions = transactions.filter(
      (candidate) => candidate.productId === args.productId,
    );
    const latest = productTransactions.sort((left, right) => {
      const expirationDifference = right.expiresDate - left.expiresDate;
      const purchaseDifference = right.purchaseDate - left.purchaseDate;
      return (
        expirationDifference ||
        purchaseDifference ||
        (right.signedDate ?? 0) - (left.signedDate ?? 0)
      );
    })[0];
    if (!latest) throw new Error("StoreKit transaction insert failed");
    const status = latest.revocationDate
      ? ("revoked" as const)
      : latest.expiresDate > now
        ? ("active" as const)
        : ("expired" as const);
    const existingEntitlement = await ctx.db
      .query("entitlements")
      .withIndex("by_clerkUserId_and_sourceIdentifier", (query) =>
        query
          .eq("clerkUserId", user.clerkUserId)
          .eq("sourceIdentifier", args.originalTransactionId),
      )
      .unique();
    const entitlement = {
      clerkUserId: user.clerkUserId,
      kind: "storekit" as const,
      sourceIdentifier: args.originalTransactionId,
      productId: args.productId,
      status,
      validFrom: Math.min(...productTransactions.map((candidate) => candidate.purchaseDate)),
      expiresAt: latest.expiresDate,
      updatedAt: now,
    };
    if (existingEntitlement) await ctx.db.replace(existingEntitlement._id, entitlement);
    else await ctx.db.insert("entitlements", entitlement);

    return {
      statusCode: 200,
      body: {
        accepted: true,
        idempotent: false,
        subscriptionStatus: status === "active" ? "active" : "expired",
        expiresAt: latest.expiresDate,
      },
    };
  },
});

export const recordVerifiedNotification = internalMutation({
  args: {
    notificationUUID: v.string(),
    notificationType: v.string(),
    subtype: v.optional(v.string()),
    signedDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("storeKitNotifications")
      .withIndex("by_notificationUUID", (query) => query.eq("notificationUUID", args.notificationUUID))
      .unique();
    if (existing) return { statusCode: 200, body: { accepted: true, idempotent: true } };
    await ctx.db.insert("storeKitNotifications", {
      ...args,
      receivedAt: Date.now(),
    });
    return { statusCode: 200, body: { accepted: true, idempotent: false } };
  },
});
