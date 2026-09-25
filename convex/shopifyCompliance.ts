import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalMutation } from "./_generated/server";

const BATCH_SIZE = 100;
const redactShopReference = makeFunctionReference<"mutation", { shop: string }, null>("shopifyCompliance:redactShop");

export const redactShop = internalMutation({
  args: { shop: v.string() },
  returns: v.null(),
  handler: async (ctx, { shop }) => {
    const connections = await ctx.db.query("shopifyConnections")
      .withIndex("by_shop", (q) => q.eq("shop", shop))
      .take(BATCH_SIZE);
    const states = await ctx.db.query("shopifyOAuthStates")
      .withIndex("by_shop", (q) => q.eq("shop", shop))
      .take(BATCH_SIZE);
    for (const row of [...connections, ...states]) await ctx.db.delete(row._id);
    if (connections.length === BATCH_SIZE || states.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, redactShopReference, { shop });
    }
    return null;
  },
});
