import { v } from "convex/values";

import { mapPriceChartingGameDetails } from "./catalog/pricecharting";
import { upsertCatalogProducts } from "./catalog/store";
import { mutation } from "./_generated/server";

// Ingests one batch of driver-parsed PriceCharting game records into the
// shared catalog. Authenticated with a deployment env var, so the mutation
// itself stays runtime-neutral (no "use node"). PRICECHARTING_CRAWL_SECRET
// is preferred; INVENTORY_CRAWL_SECRET is accepted so one crawl secret can
// gate both catalog crawlers in a deployment.
export const ingestGameDetails = mutation({
  args: {
    secret: v.string(),
    items: v.array(v.any()),
  },
  returns: v.object({
    itemsSeen: v.number(),
    productsIngested: v.number(),
    skippedNoUpc: v.number(),
    skippedNoTitle: v.number(),
    skippedInvalidSource: v.number(),
    inserted: v.number(),
    updated: v.number(),
    sourcesAdded: v.number(),
  }),
  handler: async (ctx, args) => {
    const expected = process.env.PRICECHARTING_CRAWL_SECRET ?? process.env.INVENTORY_CRAWL_SECRET;
    // An explicitly blank configured secret must not turn the mutation
    // into an open ingestion endpoint.
    if (expected === undefined || expected.length === 0 || args.secret !== expected) {
      throw new Error("Invalid crawl secret");
    }
    const mapped = mapPriceChartingGameDetails(args.items);
    const stats = await upsertCatalogProducts(ctx, mapped.products, Date.now());
    return {
      itemsSeen: args.items.length,
      productsIngested: mapped.products.length,
      skippedNoUpc: mapped.skippedNoUpc,
      skippedNoTitle: mapped.skippedNoTitle,
      skippedInvalidSource: mapped.skippedInvalidSource,
      inserted: stats.inserted,
      updated: stats.updated,
      sourcesAdded: stats.sourcesAdded,
    };
  },
});
