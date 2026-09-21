import { assessPrice } from "./assessment.ts";
import { createAuditBrowser, type AuditBrowser } from "./browser.ts";
import { collectCatalog, storeOrigin } from "./catalog.ts";
import { soldSearchUrl, validNextPage } from "./ebay.ts";
import type { AuditDecisions, AuditItem, AuditSettings, AuditSnapshot, ItemResult, SoldComparable } from "./types.ts";

export const idleAudit = (): AuditSnapshot => ({
  status: "idle", phase: "Ready to scan", total: 0, processed: 0, catalogComplete: false,
  results: [], error: null, startedAt: null, requests: 0,
});

type RunOptions = {
  settings: AuditSettings;
  decisions: AuditDecisions;
  signal: AbortSignal;
  onUpdate: (snapshot: AuditSnapshot) => void;
};

type Dependencies = { browser: AuditBrowser };

export async function runPriceAudit(options: RunOptions, dependencies?: Dependencies): Promise<void> {
  const { settings, signal, onUpdate } = options;
  let snapshot: AuditSnapshot = { ...idleAudit(), status: "running", startedAt: new Date().toISOString() };
  const publish = (change: Partial<AuditSnapshot>) => {
    snapshot = { ...snapshot, ...change };
    onUpdate(snapshot);
  };
  let browser: AuditBrowser | undefined;
  let currentItem: AuditItem | null = null;
  let currentComparables: SoldComparable[] = [];
  let currentSearch: string | null = null;
  const append = (result: ItemResult) => publish({ results: [...snapshot.results, result], processed: snapshot.processed + 1 });
  const insufficient = (item: AuditItem, reason: string): ItemResult => ({
    item, comparables: currentComparables, searchUrl: currentSearch,
    assessment: { kind: "insufficient", reason }, checkedAt: new Date().toISOString(), note: reason,
  });

  try {
    signal.throwIfAborted();
    const origin = storeOrigin(settings.storeUrl);
    if (!Number.isFinite(settings.tolerancePercent) || settings.tolerancePercent < 0 || settings.tolerancePercent > 50 ||
        !Number.isInteger(settings.maxSearchPages) || settings.maxSearchPages < 1 || settings.maxSearchPages > 5) {
      throw new Error("Choose a tolerance from 0–50% and 1–5 eBay pages per item.");
    }
    const auditBrowser = dependencies?.browser ?? createAuditBrowser();
    browser = auditBrowser;
    const decisions = options.decisions;
    publish({ phase: "Reading the public Shopify catalog…" });
    const items = await collectCatalog(origin,
      async (url) => { signal.throwIfAborted(); return auditBrowser.readCatalog(url, signal); },
      (page, total) => publish({ total, phase: `Catalog page ${page}: ${total} available variants found` }),
    );
    signal.throwIfAborted();
    publish({ total: items.length, catalogComplete: true });

    for (const item of items) {
      signal.throwIfAborted();
      currentItem = item;
      currentComparables = [];
      currentSearch = null;
      publish({ phase: `Jev is reviewing ${item.title}` });
      if (!await decisions.reviewItem(item, signal)) {
        append(insufficient(item, "Jev could not confidently establish the model, variant and condition from the catalog."));
        currentItem = null;
        continue;
      }
      const query = await decisions.chooseQuery(item, signal);
      if (!query) {
        append(insufficient(item, "Jev could not select a reliable search query for this variant."));
        currentItem = null;
        continue;
      }
      let url = soldSearchUrl(query);
      currentSearch = url;
      const seen = new Set<string>();
      let pages = 0;
      let atLimit = false;
      let truncated = false;
      for (let page = 1; page <= settings.maxSearchPages; page++) {
        signal.throwIfAborted();
        publish({ phase: `Searching sold listings: ${item.title}, page ${page}` });
        const observed = await browser.readSearch(url, signal);
        pages++;
        truncated ||= observed.truncated;
        const candidates = observed.candidates.filter((candidate) => !seen.has(candidate.id));
        candidates.forEach((candidate) => seen.add(candidate.id));
        publish({ phase: `Jev is checking ${candidates.length} sold candidates for ${item.title}` });
        currentComparables = [...currentComparables, ...await decisions.selectComparables(item, candidates, signal)];
        if (page === settings.maxSearchPages) {
          atLimit = true;
          break;
        }
        const next = await decisions.chooseNextPage(observed.nextLinks, signal);
        if (!next) break;
        if (!observed.nextLinks.some((link) => link.url === next) || !validNextPage(observed.url, next)) {
          throw new Error("The next page was not an observed link to the same sold/completed search.");
        }
        url = next;
      }
      signal.throwIfAborted();
      publish({ phase: `Jev is verifying the evidence for ${item.title}` });
      const verified = currentComparables.length >= 3 && await decisions.verifyResult(item, currentComparables, signal);
      signal.throwIfAborted();
      append({
        item, comparables: currentComparables, searchUrl: currentSearch, checkedAt: new Date().toISOString(),
        assessment: verified ? assessPrice(item, currentComparables, settings.tolerancePercent) : {
          kind: "insufficient", reason: currentComparables.length < 3
            ? "Fewer than three confident sold matches were found in the searched pages."
            : "Jev's final verification did not confirm all comparison evidence.",
        },
        note: `${pages} search page${pages === 1 ? "" : "s"} inspected. ${atLimit ? "Configured page limit reached. " : "No further next-page link selected. "}${truncated ? "Some oversized page content was excluded. " : ""}Sample of visible sold listings, not all eBay sales. Item prices only, excluding shipping and tax.`,
      });
      currentItem = null;
    }
    signal.throwIfAborted();
    publish({ status: "complete", phase: items.length ? "All available catalog variants checked" : "No available variants in the public catalog" });
  } catch (error) {
    const message = signal.aborted ? "Scan stopped. Results below are partial." :
      error instanceof Error ? error.message : "The scan failed. Results below are partial.";
    if (currentItem) append(insufficient(currentItem, message));
    publish({ status: signal.aborted ? "stopped" : "error", error: signal.aborted ? null : message, phase: message });
  } finally {
    await browser?.close();
  }
}
