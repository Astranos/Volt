import type { ShopifyAuditProduct } from "../domain/shopify-audit";

type ScriptingApi = Pick<typeof chrome.scripting, "executeScript">;
/** done: the new product shows. blocked: Shopify kept the old page (unsaved changes). fallback: do a normal load. */
export type InPlaceOutcome = "done" | "blocked" | "fallback";

const POLL_MS = 250;
const TIMEOUT_MS = 4_000;

/**
 * Runs inside Shopify's page. Only acts if the page is still the expected
 * Shopify product (the tab may have moved since Volt looked at it), then
 * marks the document so later probes can tell it's the same page, changes
 * the address, and announces it the way the back button does so Shopify's
 * own router swaps the product in place, like Sidekick.
 */
export function routeTo(origin: string, fromPath: string, toPath: string, marker: string) {
  if (location.origin !== origin || location.pathname !== fromPath) return false;
  (window as unknown as Record<string, unknown>).__voltAuditNavigation = marker;
  history.pushState(null, "", toPath);
  window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  return true;
}

/**
 * Runs inside Shopify's page: whether it's still the page routeTo marked, where
 * it is, and whether the product heading now exactly matches the new title
 * (Shopify puts a status badge like "Active" in the same heading).
 */
export function readRoute(origin: string, marker: string, title: string) {
  if (location.origin !== origin || (window as unknown as Record<string, unknown>).__voltAuditNavigation !== marker) return null;
  const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  // Only the heading carries the badge; the title is compared as-is.
  const withoutBadge = (heading: string) => heading.replace(/\s+(active|draft|archived|unlisted)$/, "");
  const wanted = clean(title);
  return {
    path: location.pathname,
    shown: !!wanted && Array.from(document.querySelectorAll("h1"))
      .some((heading) => clean(heading.textContent) === wanted || withoutBadge(clean(heading.textContent)) === wanted),
  };
}

/**
 * Moves a Shopify admin tab to another product without a full reload. Anything
 * short of confirming the new product is a fallback to a normal load, since
 * Shopify internals can change at any time.
 */
export async function openProductInPlace(
  scripting: ScriptingApi,
  tabId: number,
  currentUrl: string | undefined,
  from: ShopifyAuditProduct | undefined,
  to: ShopifyAuditProduct,
  wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<InPlaceOutcome> {
  let current: URL;
  let target: URL;
  try {
    current = new URL(currentUrl ?? "");
    target = new URL(to.url);
  } catch {
    return "fallback";
  }
  const store = (path: string) => path.split("/").slice(0, 3).join("/");
  if (current.origin !== target.origin || store(current.pathname) !== store(target.pathname)) return "fallback";
  if (!from || from.url !== `${current.origin}${current.pathname}`) return "fallback";
  // The heading check can't tell apart titles that are equal, or differ only by
  // a status word (the old heading "Blue Shirt Active" vs a product titled that).
  const norm = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  const badge = /\s+(active|draft|archived|unlisted)$/;
  const [a, b] = [norm(from.title), norm(to.title)];
  if (a === b || a.replace(badge, "") === b || b.replace(badge, "") === a) return "fallback";
  const marker = crypto.randomUUID();

  try {
    const [started] = await scripting.executeScript({
      target: { tabId }, world: "MAIN", func: routeTo, args: [target.origin, current.pathname, target.pathname, marker],
    });
    if (started?.result !== true) return "fallback";
    for (let waited = 0; waited < TIMEOUT_MS; waited += POLL_MS) {
      await wait(POLL_MS);
      const [probe] = await scripting.executeScript({ target: { tabId }, world: "MAIN", func: readRoute, args: [target.origin, marker, to.title] });
      const route = probe?.result;
      // A different document (reloaded or navigated away): not ours to judge.
      if (!route) return "fallback";
      // Shopify held the old page (its "unsaved changes" prompt): leave it alone.
      if (route.path !== target.pathname) return "blocked";
      if (route.shown) return "done";
    }
  } catch {
    return "fallback";
  }
  return "fallback";
}
