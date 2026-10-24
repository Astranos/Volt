import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, RefreshCw, X } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  isReusableShopifyAuditTab,
  isShopifyAdminProductUrl,
  nextShopifyAuditProduct,
  parseShopifyAuditReview,
  startShopifyAuditReview,
  SHOPIFY_AUDIT_REVIEW_KEY,
  SHOPIFY_AUDIT_REVIEW_REQUEST_KEY,
  type ShopifyAuditReview as Review,
  type ShopifyAuditReviewRequest,
} from "../../domain/shopify-audit";
import { getShopifyAuditConnection, listShopifyAuditYesterday } from "../../shopify-audit/client";
import { openProductInPlace } from "../../shopify-audit/in-place-navigation";

type Filter = "all" | "todo";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  DRAFT: "bg-stone-200 text-stone-700 dark:bg-stone-500/20 dark:text-stone-300",
  ARCHIVED: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  UNLISTED: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
};

const formatDate = (date: string) => {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
        const inPlace = shownUrl !== product.url && tab.status === "complete"
          && await openProductInPlace(chrome.scripting, tabId, shownUrl, shown, product);
        if (stale()) return;
        await chrome.tabs.update(tabId, shownUrl === product.url || inPlace ? { active: true } : { url: product.url, active: true });
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
      await save({ ...(reviewRef.current ?? current), currentId: productId, tabId });
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
      const result = await listShopifyAuditYesterday();
      if (stale()) return;
      const previous = reviewRef.current;
      let next = startShopifyAuditReview(previous, result);
      // Keep reviewing in the existing tab; the new tab that asked becomes the
      // review tab only when there isn't a usable one already.
      if (request?.tabId != null && !await reviewTab(next)) next = { ...next, tabId: request.tabId };
      if (stale()) return;
      await save(next);
      // Show the selected product whenever the selection moved (a new day, or
      // a first load), so "Done" never marks a product that isn't on screen.
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
    void chrome.storage.local.get([SHOPIFY_AUDIT_REVIEW_KEY, SHOPIFY_AUDIT_REVIEW_REQUEST_KEY]).then((stored) => {
      if (!active) return;
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

  const doneAndNext = async () => {
    const run = generation.current;
    const current = reviewRef.current;
    if (!current?.currentId) return;
    const next: Review = { ...current, marks: { ...current.marks, [current.currentId]: "done" } };
    await save(next);
    const following = nextShopifyAuditProduct(next, current.currentId);
    if (following) await openProduct(next, following.id, run);
  };

  const previous = () => {
    const current = reviewRef.current;
    if (!current?.currentId) return;
    const index = current.products.findIndex((product) => product.id === current.currentId);
    if (index > 0) void openProduct(current, current.products[index - 1].id);
  };

  const clearMark = async (productId: string) => {
    const current = reviewRef.current;
    if (!current) return;
    const marks = { ...current.marks };
    delete marks[productId];
    await save({ ...current, marks });
  };

  const finish = async () => {
    generation.current++;
    setBusy(false);
    await save(null);
    onClose?.();
  };

  if (!loaded) return null;

  const products = review?.products ?? [];
  const doneCount = products.filter((product) => review?.marks[product.id]).length;
  const allDone = products.length > 0 && doneCount === products.length;
  const visible = products.filter((product) => filter === "all"
    || !review?.marks[product.id]);
  const currentIndex = products.findIndex((product) => product.id === review?.currentId);

  return (
    <div className="flex h-full min-h-0 flex-col text-stone-900 dark:text-stone-50">
      <div className="border-b border-stone-900/10 px-4 pb-3 pt-3 dark:border-white/10">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Shopify audit</h2>
          <div className="flex items-center gap-1">
            <button aria-label="Reload yesterday's products" className="audit-icon-button p-1.5 text-stone-500 hover:text-stone-900 disabled:opacity-50 dark:text-stone-400 dark:hover:text-stone-50" disabled={busy} onClick={() => void load(null)} title="Reload yesterday's products" type="button">
              <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
            </button>
            {review && (
              <button aria-label="End audit" className="audit-icon-button p-1.5 text-stone-500 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-50" onClick={() => void finish()} title="End audit and clear progress" type="button">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {review ? (
          <>
            <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">{review.shop.replace(/\.myshopify\.com$/, "")} · created {formatDate(review.date)}</p>
            {products.length > 0 && (
              <>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-stone-900/10 dark:bg-white/10">
                  <div className="h-full rounded-full bg-green-600 transition-[width] duration-300 dark:bg-green-500" style={{ width: `${(doneCount / products.length) * 100}%` }} />
                </div>
                <div className="mt-1.5 flex justify-between text-xs text-stone-500 dark:text-stone-400">
                  <span>{doneCount} of {products.length} reviewed</span>
                </div>
              </>
            )}
          </>
        ) : null}
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
          <p className="text-sm text-stone-500 dark:text-stone-400">{busy ? "Loading yesterday's products…" : "Review yesterday's new Shopify products one at a time in a single tab."}</p>
          {!busy && (
            <button className="audit-button-primary px-4 py-2 text-xs font-semibold" onClick={() => void load(null)} type="button">Load yesterday's products</button>
          )}
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-stone-500 dark:text-stone-400">
          No products were created on {formatDate(review.date)}.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 px-4 pb-1.5 pt-3" role="radiogroup" aria-label="Show">
            {([["all", `All ${products.length}`], ["todo", `To review ${products.length - doneCount}`]] as const).map(([value, label]) => (
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
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" ref={listRef}>
            {visible.length === 0 && <p className="px-2 py-6 text-center text-xs text-stone-500 dark:text-stone-400">Nothing here.</p>}
            {visible.map((product) => {
              const productMark = review.marks[product.id];
              const isCurrent = product.id === review.currentId;
              return (
                <div
                  className={cn(
                    "group flex items-center gap-2 rounded-lg border px-2.5 py-2",
                    isCurrent ? "border-green-600/30 bg-green-600/10" : "border-transparent hover:bg-stone-900/5 dark:hover:bg-white/5",
                  )}
                  data-current={isCurrent}
                  key={product.id}
                >
                  <button className="min-w-0 flex-1 text-left" onClick={() => void openProduct(review, product.id)} title={product.title} type="button">
                    <span className={cn("block truncate text-[13px] font-medium", productMark === "done" && "text-stone-400 line-through dark:text-stone-500")}>{product.title || "Untitled product"}</span>
                    <span className={cn("mt-0.5 inline-block rounded px-1.5 text-[10px] font-semibold", STATUS_STYLES[product.status] ?? STATUS_STYLES.DRAFT)}>
                      {product.status.charAt(0) + product.status.slice(1).toLowerCase()}
                    </span>
                  </button>
                  {productMark ? (
                    <button aria-label="Mark as not reviewed" className="audit-icon-button shrink-0 p-1" onClick={() => void clearMark(product.id)} title="Mark as not reviewed" type="button">
                      <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                    </button>
                  ) : isCurrent ? <span aria-hidden="true" className="mr-1.5 h-2 w-2 shrink-0 rounded-full bg-green-600" /> : null}
                </div>
              );
            })}
          </div>
          <div className="border-t border-stone-900/10 px-3 pb-3 pt-2.5 dark:border-white/10">
            {allDone ? (
              <div className="space-y-2 text-center">
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  All {products.length} reviewed.
                </p>
                <button className="audit-button-primary w-full px-3 py-2 text-xs font-semibold" onClick={() => void finish()} type="button">Finish audit</button>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <button aria-label="Previous product" className="audit-button px-3 py-2 disabled:opacity-40" disabled={currentIndex <= 0} onClick={previous} title="Previous product" type="button">
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <button className="audit-button-primary flex flex-1 items-center justify-center gap-1 px-3 py-2 text-xs font-semibold disabled:opacity-40" disabled={!review.currentId} onClick={() => void doneAndNext()} type="button">
                  Done &amp; next <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <p className="mt-2 text-center text-[10px] text-stone-400 dark:text-stone-500">Only one Shopify tab stays open while you review.</p>
          </div>
        </>
      )}
    </div>
  );
}
