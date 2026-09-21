import { ebayItemUrl, eligibleSoldText, isSoldSearch, sameSearch, usdPriceCandidates, validNextPage, type SearchPage } from "./ebay.ts";
import type { ListingCandidate } from "./types.ts";

export type AuditBrowser = {
  readCatalog: (url: string, signal: AbortSignal) => Promise<string>;
  readSearch: (url: string, signal: AbortSignal) => Promise<SearchPage>;
  close: () => Promise<void>;
};

function delay(signal: AbortSignal, milliseconds: number): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new Error("Scan stopped.")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

// These two functions run in the isolated content-script world. Keep them self-contained.
export function observeCatalog(expected: string): { url: string; text: string } {
  if (location.href !== expected) throw new Error("The catalog tab moved. Restart the scan.");
  const text = (document.querySelector("pre")?.textContent ?? document.body?.innerText ?? "").trim();
  if (text.length > 8 * 1024 * 1024) throw new Error("Catalog page exceeds the scan size limit.");
  return { url: location.href, text };
}

export function observeSearch(expected: string) {
  const expectedUrl = new URL(expected), actualUrl = new URL(location.href);
  for (const url of [expectedUrl, actualUrl]) {
    if (!url.searchParams.has("_pgn")) url.searchParams.set("_pgn", "1");
    url.searchParams.sort();
  }
  if (actualUrl.origin !== "https://www.ebay.com" || actualUrl.pathname !== "/sch/i.html" ||
      actualUrl.searchParams.get("LH_Sold") !== "1" || actualUrl.searchParams.get("LH_Complete") !== "1" ||
      actualUrl.searchParams.toString() !== expectedUrl.searchParams.toString()) {
    throw new Error("eBay is no longer on the requested sold/completed search.");
  }
  const bodyText = document.body?.innerText ?? "";
  if (/pardon our interruption|verify (?:that )?you(?:'re| are) (?:a )?human|security measure|access denied|captcha/i.test(document.title + "\n" + bodyText.slice(0, 3000))) {
    throw new Error("eBay requires human verification. Stop the scan and resolve it in Chrome before restarting.");
  }
  const elements = Array.from(document.querySelectorAll<HTMLElement>(".s-item, .s-card"));
  const cards = elements.slice(0, 120).flatMap((element) => {
    const link = element.querySelector<HTMLAnchorElement>('a[href*="/itm/"]');
    if (!link) return [];
    const fullText = element.innerText ?? element.textContent ?? "";
    const prices = Array.from(element.querySelectorAll<HTMLElement>('[class*="price"]'))
      .filter((price) => {
        if (price.closest("s, del") || price.querySelector("s, del") || !price.getClientRects().length) return false;
        for (let parent: HTMLElement | null = price; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (parent.getAttribute("aria-hidden") === "true" || parent.hidden ||
              style.display === "none" || style.visibility === "hidden" ||
              style.textDecorationLine.includes("line-through")) return false;
          if (parent === element) break;
        }
        return true;
      })
      .map((price) => (price.innerText ?? price.textContent ?? "").trim())
      .filter((text) => text.length < 100).slice(0, 16);
    return [{ href: link.href, text: fullText.slice(0, 4500), prices, truncated: fullText.length > 4500 }];
  });
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="_pgn="]'))
    .filter((a) => a.getAttribute("aria-disabled") !== "true" && a.getClientRects().length > 0)
    .slice(0, 100)
    .map((a, index) => ({ id: `link_${index}`, url: a.href, text: `${a.getAttribute("aria-label") ?? ""} ${a.getAttribute("title") ?? ""} ${a.innerText}`.trim().slice(0, 200) }));
  return {
    url: location.href, cards, links,
    noResults: /\b0 results\b|no (?:exact )?matches found|no results found/i.test(bodyText),
    truncated: elements.length > 120,
  };
}

export function normalizeSearchPage(raw: ReturnType<typeof observeSearch>): SearchPage {
  if (!isSoldSearch(raw.url)) throw new Error("Only sold and completed eBay searches can be compared.");
  const seen = new Set<string>();
  const candidates: ListingCandidate[] = [];
  for (const card of raw.cards) {
    const item = ebayItemUrl(card.href);
    if (!item || seen.has(item.id) || card.truncated || !eligibleSoldText(card.text)) continue;
    const prices = usdPriceCandidates(card.prices);
    if (!prices.length) continue;
    seen.add(item.id);
    candidates.push({ ...item, text: card.text, prices });
  }
  const nextLinks = new Map<string, { id: string; text: string; url: string }>();
  for (const link of raw.links) {
    if (!validNextPage(raw.url, link.url)) continue;
    const previous = nextLinks.get(link.url);
    if (!previous || /next/i.test(link.text)) nextLinks.set(link.url, link);
  }
  return {
    url: raw.url, candidates, noResults: raw.noResults,
    nextLinks: [...nextLinks.values()],
    truncated: raw.truncated || raw.cards.some((card) => card.truncated),
  };
}

export function createAuditBrowser(): AuditBrowser {
  const tabs = new Map<"catalog" | "search", { id: number; expected: string }>();
  let closed = false;

  async function navigate(kind: "catalog" | "search", url: string, signal: AbortSignal): Promise<number> {
    signal.throwIfAborted();
    if (closed) throw new Error("This audit session has ended.");
    let owned = tabs.get(kind);
    if (!owned) {
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab.id === undefined) throw new Error("Could not create a research tab.");
      owned = { id: tab.id, expected: url };
      tabs.set(kind, owned);
      signal.throwIfAborted();
    } else {
      const current = await chrome.tabs.get(owned.id);
      signal.throwIfAborted();
      const unchanged = kind === "search" ? sameSearch(owned.expected, current.url ?? "") : current.url === owned.expected;
      if (!unchanged || (current.pendingUrl && current.pendingUrl !== owned.expected)) {
        throw new Error("The research tab was changed outside the audit. Stopped without navigating it again.");
      }
      owned.expected = url;
      await chrome.tabs.update(owned.id, { url });
      signal.throwIfAborted();
    }
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const tab = await chrome.tabs.get(owned.id);
      signal.throwIfAborted();
      if (tab.status === "complete") {
        const matches = kind === "search" ? sameSearch(url, tab.url ?? "") : tab.url === url;
        if (matches) return owned.id;
        if (kind === "search" && tab.url?.startsWith("https://www.ebay.com/splashui/challenge")) {
          throw new Error("eBay requires browser verification. The research tab was left open for you; resolve it manually before starting another audit.");
        }
        if (!tab.pendingUrl) throw new Error("The site redirected the research tab. The audit has stopped.");
      }
      await delay(signal, 300);
    }
    throw new Error("The research tab timed out. Retry after the site finishes loading.");
  }

  return {
    async readCatalog(url, signal) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || parsed.pathname !== "/products.json") throw new Error("Invalid catalog destination.");
      const id = await navigate("catalog", url, signal);
      signal.throwIfAborted();
      const results = await chrome.scripting.executeScript({ target: { tabId: id }, func: observeCatalog, args: [url] });
      signal.throwIfAborted();
      const result = results[0]?.result;
      if (!result || result.url !== url) throw new Error("Could not read the public catalog tab.");
      return result.text;
    },
    async readSearch(url, signal) {
      if (!isSoldSearch(url)) throw new Error("Refusing a search without both sold/completed filters.");
      const id = await navigate("search", url, signal);
      for (let attempt = 0; attempt < 8; attempt++) {
        signal.throwIfAborted();
        const results = await chrome.scripting.executeScript({ target: { tabId: id }, func: observeSearch, args: [url] });
        signal.throwIfAborted();
        const result = results[0]?.result;
        if (!result || !sameSearch(url, result.url)) throw new Error("Could not verify the eBay research page.");
        if (result.cards.length || result.noResults) return normalizeSearchPage(result);
        await delay(signal, 500);
      }
      throw new Error("No recognizable eBay results were found. The page may have changed or blocked the scan.");
    },
    async close() {
      closed = true;
      for (const [kind, owned] of tabs) {
        try {
          const tab = await chrome.tabs.get(owned.id);
          const matches = kind === "search" ? sameSearch(owned.expected, tab.url ?? "") : owned.expected === tab.url;
          // Leave tabs the user navigated away from; only remove our untouched research tabs.
          if (matches && (!tab.pendingUrl || tab.pendingUrl === owned.expected)) await chrome.tabs.remove(owned.id);
        } catch { /* A user may already have closed a research tab. */ }
      }
      tabs.clear();
    },
  };
}
