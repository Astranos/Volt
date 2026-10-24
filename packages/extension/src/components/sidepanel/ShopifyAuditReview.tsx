import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RefreshCw, X } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  isReusableShopifyAuditTab,
  isShopifyAdminProductUrl,
  nextShopifyAuditProduct,
  parseShopifyAuditDays,
  parseShopifyAuditReview,
  startShopifyAuditReview,
  SHOPIFY_AUDIT_DAYS_KEY,
  SHOPIFY_AUDIT_REVIEW_KEY,
  SHOPIFY_AUDIT_REVIEW_REQUEST_KEY,
  type ShopifyAuditDays,
  type ShopifyAuditReview as Review,
  type ShopifyAuditReviewRequest,
} from "../../domain/shopify-audit";
import { getShopifyAuditConnection, listShopifyAuditYesterday } from "../../shopify-audit/client";
import { openProductInPlace } from "../../shopify-audit/in-place-navigation";

type Filter = "all" | "todo";

const DAY_OPTIONS: Array<[ShopifyAuditDays, string]> = [[1, "Yesterday"], [2, "Last 2 days"], [3, "Last 3 days"]];

// Most products are Active, so only the other statuses get a badge.
const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-stone-200 text-stone-700 dark:bg-stone-500/20 dark:text-stone-300",
  ARCHIVED: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  UNLISTED: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
};

// "Oct 22", or "Oct 20 – 22" / "Sep 30 – Oct 2" for a multi-day audit.
const formatRange = (date: string, days: ShopifyAuditDays) => {
  const start = new Date(`${date}T12:00:00`);
  if (Number.isNaN(start.getTime())) return date;
  const short = (value: Date) => value.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (days === 1) return short(start);
  const end = new Date(start);
  end.setDate(start.getDate() + days - 1);
  return `${short(start)} – ${end.getMonth() === start.getMonth() ? end.getDate() : short(end)}`;
};

async function reviewTab(review: Review) {
  if (review.tabId === null) return null;
  const tab = await chrome.tabs.get(review.tabId).catch(() => null);
  return tab?.id !== undefined && isReusableShopifyAuditTab(tab.pendingUrl ?? tab.url, review, chrome.runtime.getURL("/newtab.html")) ? tab : null;
}

export default function ShopifyAuditReview({ onClose }: { onClose?: () => void }) {
  const [review, setReview] = useState<Review | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsConnection, setNeedsConnection] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [days, setDays] = useState<ShopifyAuditDays>(1);
  const daysRef = useRef<ShopifyAuditDays>(1);
  const reviewRef = useRef<Review | null>(null);
  const handledRequestAt = useRef(0);
  // Bumped by every load and by ending the audit, so a slower earlier load
  // can't overwrite a newer one or bring back an audit that was just ended.
  const generation = useRef(0);
  // Navigations run one at a time, so quick clicks reuse the tab the previous
  // one opened instead of each opening their own.
  const navigation = useRef<Promise<unknown>>(Promise.resolve());
  const listRef = useRef<HTMLDivElement | null>(null);

  const save = useCallback(async (next: Review | null) => {
    reviewRef.current = next;
    setReview(next);
    if (next) await chrome.storage.local.set({ [SHOPIFY_AUDIT_REVIEW_KEY]: next });
    else await chrome.storage.local.remove(SHOPIFY_AUDIT_REVIEW_KEY);
  }, []);

  // `origin` is the generation of the action that led here; ending the audit or
  // starting a newer load since then cancels the navigation.
  const navigate = useCallback(async (current: Review, productId: string, origin: number) => {
    const product = current.products.find((item) => item.id === productId);
    if (!product || !isShopifyAdminProductUrl(product.url)) return;
    // A click queued before the list reloaded (e.g. a range change) no longer applies.
    if (reviewRef.current && !reviewRef.current.products.some((item) => item.id === productId)) return;
    const stale = () => origin !== generation.current;
    if (stale()) return;
    setError(null);
    try {
      // The latest saved review carries a tab an earlier queued navigation opened.
      const tab = await reviewTab(reviewRef.current ?? current);
      if (stale()) return;
      let tabId: number;
      if (tab?.id !== undefined) {
        tabId = tab.id;
        const shownUrl = tab.pendingUrl ?? tab.url;
        const shown = (reviewRef.current ?? current).products.find((item) => item.id === (reviewRef.current ?? current).currentId);
        // Same product: just bring it forward rather than reloading the editor.
        // Otherwise let Shopify swap the product in place, and reload only if that doesn't take.
        const outcome = shownUrl === product.url ? "done"
          : tab.status === "complete" ? await openProductInPlace(chrome.scripting, tabId, shownUrl, shown, product) : "fallback";
        if (stale()) return;
        if (outcome === "blocked") {
          // Shopify kept the old product (unsaved changes): leave the selection where it is.
          await chrome.tabs.update(tabId, { active: true });
          return;
        }
        if (outcome === "fallback") {
          // The tab may have moved on while we tried; only reload it if it's still ours.
          const fresh = await reviewTab(reviewRef.current ?? current);
          if (stale()) return;
          if (fresh?.id === tabId) await chrome.tabs.update(tabId, { url: product.url, active: true });
          else {
            const panelWindow = await chrome.windows.getCurrent();
            if (stale()) return;
            const created = await chrome.tabs.create({ url: product.url, active: true, ...(typeof panelWindow.id === "number" ? { windowId: panelWindow.id } : {}) });
            if (typeof created.id !== "number") throw new Error("Chrome did not open the product tab.");
            tabId = created.id;
            if (stale()) {
              await chrome.tabs.remove(tabId).catch(() => undefined);
              return;
            }
          }
        } else {
          await chrome.tabs.update(tabId, { active: true });
        }
      } else {
        const panelWindow = await chrome.windows.getCurrent();
        if (stale()) return;
        const created = await chrome.tabs.create({ url: product.url, active: true, ...(typeof panelWindow.id === "number" ? { windowId: panelWindow.id } : {}) });
        if (typeof created.id !== "number") throw new Error("Chrome did not open the product tab.");
        tabId = created.id;
        // Cancelled while opening: don't leave an untracked tab behind.
        if (stale()) {
          await chrome.tabs.remove(tabId).catch(() => undefined);
          return;
        }
      }
      if (stale()) return;
      // Opening a product is what marks it viewed; nobody has to remember a Done button.
      const latest = reviewRef.current ?? current;
      await save({ ...latest, currentId: productId, tabId, marks: { ...latest.marks, [productId]: "done" } });
    } catch (cause) {
      if (!stale()) setError(cause instanceof Error ? cause.message : "Could not open the product.");
    }
  }, [save]);

  const openProduct = useCallback((current: Review, productId: string, origin = generation.current) => {
    const task = navigation.current.then(() => navigate(current, productId, origin));
    navigation.current = task.catch(() => undefined);
    return task;
  }, [navigate]);

  const load = useCallback(async (request: ShopifyAuditReviewRequest | null) => {
    const run = ++generation.current;
    const stale = () => run !== generation.current;
    setBusy(true);
    setError(null);
    setNeedsConnection(false);
    try {
      if (!await getShopifyAuditConnection()) {
        setNeedsConnection(true);
        throw new Error("Connect your Shopify store in Volt settings first.");
      }
      const range = daysRef.current;
      const result = await listShopifyAuditYesterday(range).catch((cause: unknown) => {
        // Production must be updated before it accepts more than one day.
        if (range > 1 && cause instanceof Error && /date range/i.test(cause.message)) {
          throw new Error("Volt's server doesn't support multiple days yet. Use Yesterday for now.");
        }
        throw cause;
      });
      if (stale()) return;
      const previous = reviewRef.current;
      let next = startShopifyAuditReview(previous, result, range);
      // Keep reviewing in the existing tab; the new tab that asked becomes the
      // review tab only when there isn't a usable one already.
      if (request?.tabId != null && !await reviewTab(next)) next = { ...next, tabId: request.tabId };
      if (stale()) return;
      await save(next);
      // Show the selected product whenever the selection moved (a new day, or
      // a first load), so the highlighted product is the one on screen.
      const moved = previous?.date !== next.date || previous?.currentId !== next.currentId;
      if (next.currentId && (request || moved) && !stale()) await openProduct(next, next.currentId, run);
    } catch (cause) {
      if (!stale()) setError(cause instanceof Error ? cause.message : "Could not load the Shopify audit.");
    } finally {
      if (!stale()) setBusy(false);
    }
  }, [openProduct, save]);

  useEffect(() => {
    let active = true;
    const handleRequest = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const request = value as ShopifyAuditReviewRequest;
      // The panel can see one request both on its first read and as a change.
      if (typeof request.at !== "number" || request.at <= handledRequestAt.current) return;
      handledRequestAt.current = request.at;
      void chrome.storage.local.remove(SHOPIFY_AUDIT_REVIEW_REQUEST_KEY);
      void load({ at: request.at, tabId: typeof request.tabId === "number" ? request.tabId : null });
    };
    void chrome.storage.local.get([SHOPIFY_AUDIT_REVIEW_KEY, SHOPIFY_AUDIT_REVIEW_REQUEST_KEY, SHOPIFY_AUDIT_DAYS_KEY]).then((stored) => {
      if (!active) return;
      daysRef.current = parseShopifyAuditDays(stored[SHOPIFY_AUDIT_DAYS_KEY]);
      setDays(daysRef.current);
      const saved = parseShopifyAuditReview(stored[SHOPIFY_AUDIT_REVIEW_KEY]);
      reviewRef.current = saved;
      setReview(saved);
      setLoaded(true);
      handleRequest(stored[SHOPIFY_AUDIT_REVIEW_REQUEST_KEY]);
    });
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== "local") return;
      if (changes[SHOPIFY_AUDIT_REVIEW_REQUEST_KEY]?.newValue) handleRequest(changes[SHOPIFY_AUDIT_REVIEW_REQUEST_KEY].newValue);
      if (changes[SHOPIFY_AUDIT_REVIEW_KEY]) {
        // Another window's panel moved the review along.
        const next = parseShopifyAuditReview(changes[SHOPIFY_AUDIT_REVIEW_KEY].newValue);
        if (!next && reviewRef.current) {
          // Ended elsewhere: cancel anything this panel still has in flight.
          generation.current++;
          setBusy(false);
        }
        reviewRef.current = next;
        setReview(next);
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      active = false;
      generation.current++;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [load]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-current='true']")?.scrollIntoView({ block: "nearest" });
  }, [review?.currentId, filter]);

  const next = () => {
    const current = reviewRef.current;
    if (!current?.currentId) return;
    const following = nextShopifyAuditProduct(current, current.currentId);
    if (following) void openProduct(current, following.id);
  };

  const changeDays = (value: ShopifyAuditDays) => {
    daysRef.current = value;
    setDays(value);
    void chrome.storage.local.set({ [SHOPIFY_AUDIT_DAYS_KEY]: value });
    void load(null);
  };

  const previous = () => {
    const current = reviewRef.current;
    if (!current?.currentId) return;
    const index = current.products.findIndex((product) => product.id === current.currentId);
    if (index > 0) void openProduct(current, current.products[index - 1].id);
  };

  const finish = async () => {
    generation.current++;
    setBusy(false);
    await save(null);
    onClose?.();
  };

  if (!loaded) return null;

  const products = review?.products ?? [];
  const viewedCount = products.filter((product) => review?.marks[product.id]).length;
  const allViewed = products.length > 0 && viewedCount === products.length;
  const visible = products.filter((product) => filter === "all" || !review?.marks[product.id]);
  const currentIndex = products.findIndex((product) => product.id === review?.currentId);
  const iconButton = "audit-icon-button p-1.5 text-stone-500 hover:text-stone-900 disabled:opacity-50 dark:text-stone-400 dark:hover:text-stone-50";

  return (
    <div className="flex h-full min-h-0 flex-col text-stone-900 dark:text-stone-50">
      <div className="space-y-2.5 border-b border-stone-900/10 px-4 py-3 dark:border-white/10">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-bold" title={review?.shop}>Shopify audit</h2>
          <select
            aria-label="Products created"
            className="rounded-md border border-stone-900/15 bg-transparent px-1.5 py-1 text-xs text-stone-700 disabled:opacity-50 dark:border-white/15 dark:bg-stone-900 dark:text-stone-200"
            disabled={busy}
            onChange={(event) => changeDays(parseShopifyAuditDays(Number(event.target.value)))}
            title={review ? `Created ${formatRange(review.date, review.days)}` : undefined}
            value={days}
          >
            {DAY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <button aria-label="Reload products" className={iconButton} disabled={busy} onClick={() => void load(null)} title="Reload products" type="button">
            <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
          </button>
          {review && (
            <button aria-label="End audit" className={iconButton} onClick={() => void finish()} title="End audit and clear progress" type="button">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {review && products.length > 0 && (
          <>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-stone-900/10 dark:bg-white/10">
                  <div className="h-full rounded-full bg-green-600 transition-[width] duration-300 dark:bg-green-500" style={{ width: `${(viewedCount / products.length) * 100}%` }} />
                </div>
                <p className="mt-1 truncate text-[11px] text-stone-500 dark:text-stone-400">
                  {viewedCount} of {products.length} viewed · {formatRange(review.date, review.days)}
                </p>
              </div>
              <button aria-label="Previous product" className="audit-button flex h-8 w-8 shrink-0 items-center justify-center disabled:opacity-40" disabled={busy || currentIndex <= 0} onClick={previous} title="Previous product" type="button">
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
              {allViewed ? (
                <button className="audit-button-primary h-8 shrink-0 px-3 text-xs font-semibold" onClick={() => void finish()} title="All products viewed: clear this audit" type="button">Finish</button>
              ) : (
                <button className="audit-button-primary flex h-8 shrink-0 items-center gap-1 px-3 text-xs font-semibold disabled:opacity-40" disabled={busy || !review.currentId} onClick={next} title="Next product you haven't viewed" type="button">
                  Next <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex gap-1.5" role="radiogroup" aria-label="Show">
              {([["all", `All ${products.length}`], ["todo", `Not viewed ${products.length - viewedCount}`]] as const).map(([value, label]) => (
                <button
                  aria-checked={filter === value}
                  className="audit-chip px-2.5 py-0.5 text-[11px] font-medium text-stone-600 transition-colors hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-50"
                  key={value}
                  onClick={() => setFilter(value)}
                  role="radio"
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300" role="alert">
          {error}
          {needsConnection && (
            <button className="ml-1 font-semibold underline" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("/options.html#shopify-audit"), active: true })} type="button">Open settings</button>
          )}
        </div>
      )}

      {!review ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-stone-500 dark:text-stone-400">{busy ? "Loading products…" : "Review recently created Shopify products one at a time in a single tab."}</p>
          {!busy && (
            <button className="audit-button-primary px-4 py-2 text-xs font-semibold" onClick={() => void load(null)} type="button">Load products</button>
          )}
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-stone-500 dark:text-stone-400">
          No products were created {review.days === 1 ? "yesterday" : `in the last ${review.days} days`}.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2" ref={listRef}>
          {visible.length === 0 && <p className="px-2 py-6 text-center text-xs text-stone-500 dark:text-stone-400">You've viewed every product.</p>}
          {visible.map((product) => {
            const viewed = !!review.marks[product.id];
            const isCurrent = product.id === review.currentId;
            const status = STATUS_STYLES[product.status] ?? (product.status === "ACTIVE" ? null : STATUS_STYLES.DRAFT);
            return (
              // The row's look lives on a div: the panel's global button reset
              // overrides Tailwind backgrounds and borders on <button>.
              <div
                className={cn(
                  "rounded-lg border",
                  isCurrent ? "border-green-600/30 bg-green-600/10" : "border-transparent hover:bg-stone-900/5 dark:hover:bg-white/5",
                )}
                data-current={isCurrent}
                key={product.id}
              >
                <button className="flex w-full items-center gap-2 px-2.5 py-2 text-left disabled:opacity-60" disabled={busy} onClick={() => void openProduct(review, product.id)} title={product.title} type="button">
                  <span className={cn("min-w-0 flex-1 truncate text-[13px] font-medium", viewed && !isCurrent && "text-stone-400 dark:text-stone-500")}>
                    {product.title || "Untitled product"}
                  </span>
                  {status && (
                    <span className={cn("shrink-0 rounded px-1.5 text-[10px] font-semibold", status)}>
                      {product.status.charAt(0) + product.status.slice(1).toLowerCase()}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
