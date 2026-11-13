import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

export const retiredTables = [
  "catalogActivityDays",
  "catalogImportControl",
  "catalogImportRuns",
  "catalogImportProgress",
  "catalogImportCursors",
  "paymoreCatalogProducts",
  "paymoreCatalogSources",
  "catalogObservations",
  "productApiUsage",
  "productApiRequests",
  "productApiKeys",
  "productApiAccess",
  "productApiRateLimits",
] as const;

// Run once manually after deploying the retirement schema. Safe to restart.
export const purge = internalMutation({
  args: { table: v.optional(v.union(...retiredTables.map((table) => v.literal(table)))) },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const table = args.table ?? retiredTables[0];
    const batch = await ctx.db.query(table).paginate({
      numItems: 100,
      cursor: null,
      maximumBytesRead: 2_000_000,
    });
    for (const row of batch.page) await ctx.db.delete(row._id);
    // Restart from the beginning because deleted rows leave the index.
    const next = batch.isDone ? retiredTables[retiredTables.indexOf(table) + 1] : table;
    if (next) await ctx.scheduler.runAfter(0, internal.catalogPurge.purge, { table: next });
    return null;
  },
});
