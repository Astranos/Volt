import { v } from "convex/values";
import { query } from "./_generated/server";
import { loadCatalogActivity, UTC_DAY_MS } from "./catalog/activity";

const counts = {
  inserted: v.number(),
  refreshed: v.number(),
  sourcesAdded: v.number(),
  batches: v.number(),
};

export const summary = query({
  args: {
    days: v.union(v.literal(7), v.literal(30)),
    endDay: v.number(),
  },
  returns: v.object({
    days: v.number(),
    trackingStartedAt: v.union(v.number(), v.null()),
    lastIngestAt: v.union(v.number(), v.null()),
    points: v.array(v.object({ dayStart: v.number(), ...counts })),
    totals: v.object(counts),
  }),
  handler: async (ctx, args) => {
    if (!await ctx.auth.getUserIdentity()) throw new Error("Not authenticated");
    if (
      !Number.isSafeInteger(args.endDay) ||
      args.endDay < 0 ||
      args.endDay > 8_640_000_000_000_000 ||
      args.endDay % UTC_DAY_MS !== 0
    ) {
      throw new Error("endDay must be a UTC midnight timestamp");
    }
    return await loadCatalogActivity(ctx, args);
  },
});
