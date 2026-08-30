import { v } from "convex/values";

import { mapPayMoreApiItems } from "./catalog/paymoreApi";
import { upsertCatalogProducts } from "./catalog/store";
import { mutation } from "./_generated/server";

// Ingests one page of the PayMore listing API on behalf of the local crawl
// driver. Authenticated with a deployment env var, so the mutation itself
// stays runtime-neutral (no "use node").
export const ingestInventoryPage = mutation({
  args: {
    secret: v.string(),
    collectionSlug: v.string(),
    // Convex has no v.unknown(); v.any() accepts every Convex value and
    // mapPayMoreApiItems re-validates each item defensively as unknown.
    items: v.array(v.any()),
  },
  returns: v.object({
    itemsSeen: v.number(),
    productsIngested: v.number(),
    skippedNoUpc: v.number(),
    skippedNoTitle: v.number(),
    inserted: v.number(),
    updated: v.number(),
    sourcesAdded: v.number(),
  }),
  handler: async (ctx, args) => {
    if (args.secret !== process.env.INVENTORY_CRAWL_SECRET) {
      throw new Error("Invalid crawl secret");
    }
    const mapped = mapPayMoreApiItems(args.items, args.collectionSlug);
    const stats = await upsertCatalogProducts(ctx, mapped.products, Date.now());
    return {
      itemsSeen: args.items.length,
      productsIngested: mapped.products.length,
      skippedNoUpc: mapped.skippedNoUpc,
      skippedNoTitle: mapped.skippedNoTitle,
      inserted: stats.inserted,
      updated: stats.updated,
      sourcesAdded: stats.sourcesAdded,
    };
  },
});
