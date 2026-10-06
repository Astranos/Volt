import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { CatalogProduct } from "./types";
import { normalizeUPCA } from "../aiScanner";
import { isAuthorizedCatalogProductUrl } from "./hosts";

type ReviewReason = "source_upc_changed" | "variant_conflict" | "possible_upc_alias";
type Claim = Pick<CatalogProduct,
  "upc" | "title" | "brand" | "model" | "mpn" | "platform" | "edition" | "color" | "storage"
>;

function comparable(value: string | null): string | null {
  return value?.toLowerCase().replace(/[^a-z0-9]/g, "") || null;
}

function variantConflict(existing: Claim, incoming: Claim): boolean {
  const keys = ["brand", "model", "mpn", "platform", "edition", "color", "storage"] as const;
  return keys.some((key) => {
    const left = comparable(existing[key]);
    const right = comparable(incoming[key]);
    return left !== null && right !== null && left !== right;
  });
}

function materiallyChanged(existing: Claim, incoming: Claim): boolean {
  if (existing.upc !== incoming.upc || existing.title !== incoming.title) return true;
  const keys = ["brand", "model", "mpn", "platform", "edition", "color", "storage"] as const;
  return keys.some((key) => existing[key] !== incoming[key]);
}

export async function observeCatalogProducts(
  ctx: MutationCtx,
  products: CatalogProduct[],
  runId: Id<"catalogImportRuns">,
  collectionSlug: string,
  now: number,
): Promise<{ accepted: CatalogProduct[]; reviewCandidates: number }> {
  const accepted: CatalogProduct[] = [];
  const seenBySourceUrl = new Map<string, CatalogProduct>();
  const acceptedByUpc = new Map<string, CatalogProduct>();
  let reviewCandidates = 0;

  for (const candidate of products) {
    const upc = normalizeUPCA(candidate.upc);
    if (!upc) throw new Error("Invalid product UPC");
    if (!candidate.title.trim()) throw new Error("Invalid product title");
    const listings = [...new Map(candidate.listings.map((source) =>
      [source.sourceUrl, source])).values()];
    if (listings.length !== 1) throw new Error("Observed products need one source listing");
    const product = { ...candidate, upc, listings, sourceUrls: [listings[0].sourceUrl] };
    const listing = product.listings[0];
    if (!listing || product.listings.some((source) =>
      !isAuthorizedCatalogProductUrl(source.sourceUrl))) {
      throw new Error("Invalid product source URL");
    }
    const sourceUrl = listing.sourceUrl;
    const samePageSource = seenBySourceUrl.get(sourceUrl);
    seenBySourceUrl.set(sourceUrl, product);
    const observation = await ctx.db.query("catalogObservations")
      .withIndex("by_sourceUrl", (q) => q.eq("sourceUrl", sourceUrl))
      .unique();
    const source = await ctx.db.query("paymoreCatalogSources")
      .withIndex("by_sourceUrl", (q) => q.eq("sourceUrl", sourceUrl))
      .unique();
    const existingProduct = await ctx.db.query("paymoreCatalogProducts")
      .withIndex("by_upc", (q) => q.eq("upc", product.upc))
      .first();

    let reason: ReviewReason | null = null;
    if ((samePageSource && samePageSource.upc !== product.upc)
      || (source && source.upc !== product.upc)
      || (!source && observation && normalizeUPCA(observation.observedUpc) !== product.upc)) {
      reason = "source_upc_changed";
    } else if ((existingProduct && variantConflict(existingProduct, product))
      || (acceptedByUpc.get(product.upc) && variantConflict(acceptedByUpc.get(product.upc)!, product))) {
      reason = "variant_conflict";
    } else if (!existingProduct) {
      const mpnMatches = product.mpn
        ? await ctx.db.query("paymoreCatalogProducts")
            .withIndex("by_mpn", (q) => q.eq("mpn", product.mpn))
            .take(25)
        : [];
      const titleMatches = await ctx.db.query("paymoreCatalogProducts")
        .withIndex("by_title", (q) => q.eq("title", product.title))
        .take(25);
      if ([...mpnMatches, ...titleMatches, ...accepted].some((candidate) =>
        candidate.upc !== product.upc && (candidate.platform ?? null) === product.platform &&
        ((product.mpn && candidate.mpn === product.mpn) || candidate.title === product.title))) {
        reason = "possible_upc_alias";
      }
    }

    const changed = !observation || materiallyChanged({
      upc: normalizeUPCA(observation.observedUpc) ?? observation.observedUpc,
      title: observation.title,
      brand: observation.brand,
      model: observation.model,
      mpn: observation.mpn,
      platform: observation.platform,
      edition: observation.edition,
      color: observation.color,
      storage: observation.storage,
    }, product);
    const manualDecision = observation?.reviewedAt !== undefined && !changed;
    const status = manualDecision ? observation.status : reason ? "review" : "accepted";
    if (status === "review") reviewCandidates += 1;
    if (status === "accepted") {
      accepted.push(product);
      acceptedByUpc.set(product.upc, product);
    }
    else if (source && source.active !== false) await ctx.db.patch(source._id, { active: false });

    const fields = {
      sourceUrl,
      source: "external" as const,
      observedUpc: product.upc,
      title: product.title,
      brand: product.brand,
      model: product.model,
      mpn: product.mpn,
      platform: product.platform,
      edition: product.edition,
      color: product.color,
      storage: product.storage,
      collectionSlug,
      status,
      reason: manualDecision ? observation.reason : reason ?? undefined,
      candidate: product,
      runId,
      active: true,
      lastSeenAt: now,
      lastChangedAt: changed ? now : observation.lastChangedAt,
      ...(manualDecision ? { reviewedAt: observation.reviewedAt, reviewedBy: observation.reviewedBy } : {}),
      ...(!changed && observation?.classification ? { classification: observation.classification } : {}),
    };
    if (observation) {
      await ctx.db.replace(observation._id, { ...fields, firstSeenAt: observation.firstSeenAt });
    } else {
      await ctx.db.insert("catalogObservations", { ...fields, firstSeenAt: now });
    }
  }

  return { accepted, reviewCandidates };
}
