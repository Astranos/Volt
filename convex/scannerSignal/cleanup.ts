import { internalMutation } from "../_generated/server";

export const cleanupExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let deleted = 0;
    const expiredAttempts = await ctx.db
      .query("scannerJoinAttempts")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(100);
    for (const attempt of expiredAttempts) {
      await ctx.db.delete(attempt._id);
      deleted += 1;
    }
    const expiredTokens = await ctx.db
      .query("scannerJoinTokens")
      .withIndex("by_graceExpiresAt", (q) => q.lt("graceExpiresAt", now))
      .take(100);
    for (const token of expiredTokens) {
      await ctx.db.delete(token._id);
      deleted += 1;
    }
    const expiredReconnects = await ctx.db
      .query("scannerReconnectRequests")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(100);
    for (const request of expiredReconnects) {
      await ctx.db.delete(request._id);
      deleted += 1;
    }
    const expiredPairings = await ctx.db
      .query("scannerPairings")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(100);
    for (const pairing of expiredPairings) {
      await ctx.db.delete(pairing._id);
      deleted += 1;
    }
    return { deleted };
  },
});
