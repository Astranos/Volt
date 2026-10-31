import type { ShopifyAuditProduct } from "../domain/shopify-audit";

type ScriptingApi = Pick<typeof chrome.scripting, "executeScript">;
/**
 * done: Shopify swapped the product in. blocked: Shopify kept the old page (unsaved changes).
 * unknown: the page went away or couldn't be scripted (Shopify may be loading the product
 * itself), so check the tab before loading. fallback: do a normal load.
 */
export type InPlaceOutcome = "done" | "blocked" | "unknown" | "fallback";

const POLL_MS = 250;
const TIMEOUT_MS = 4_000;

/**
 * Runs inside Shopify's page. Only acts if the page is still the expected
 * Shopify product (the tab may have moved since Volt looked at it) and its
 * heading is on screen, so its disappearing later means something, then
 * marks the document so later probes can tell it's the same page, changes
 * the address, and announces it the way the back button does so Shopify's
 * own router swaps the product in place, like Sidekick.
 */
export function routeTo(origin: string, fromPath: string, toPath: string, marker: string, oldTitle: string) {
  if (location.origin !== origin || location.pathname !== fromPath) return false;
  // Same match as readRoute's; injected functions can't share helpers.
  const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const old = clean(oldTitle);
  const shown = Array.from(document.querySelectorAll("h1")).some((heading) => {
    const text = clean(heading.textContent);
    return text === old || text.startsWith(`${old} `);
  });
  if (!old || !shown) return false;
  (window as unknown as Record<string, unknown>).__voltAuditNavigation = marker;
  history.pushState(null, "", toPath);
  window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  return true;
}

/**
 * Runs inside Shopify's page: whether it's still the page routeTo marked, where
 * it is, and whether the old product's heading is still on screen. Shopify puts
 * a status badge after the title in the heading, in the admin's language.
 */
export function readRoute(origin: string, marker: string, oldTitle: string) {
  if (location.origin !== origin || (window as unknown as Record<string, unknown>).__voltAuditNavigation !== marker) return null;
  const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const old = clean(oldTitle);
  return {
    path: location.pathname,
    old: Array.from(document.querySelectorAll("h1")).some((heading) => {
      const text = clean(heading.textContent);
      return text === old || text.startsWith(`${old} `);
    }),
  };
}

/**
 * Moves a Shopify admin tab to another product without a full reload. Only
 * tried when the old product's heading is on screen; once the address changed
 * and that heading is gone, Shopify has swapped the product in. Matching the new
 * heading exactly was too brittle (localized status badges, markup changes) and
 * a false miss reloaded a product already on screen. The old heading staying
 * put means Shopify ignored the route: a normal load.
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
  // The new heading would look like the old one when either title starts with
  // the other ("Blue Shirt" vs "Blue Shirt Large", or a heading's status badge).
  const norm = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  const [a, b] = [norm(from.title), norm(to.title)];
  if (a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `)) return "fallback";
  const marker = crypto.randomUUID();

  try {
    const [route] = await scripting.executeScript({
      target: { tabId }, world: "MAIN", func: routeTo, args: [target.origin, current.pathname, target.pathname, marker, from.title],
    });
    if (route?.result !== true) return "fallback";
    for (let waited = 0; waited < TIMEOUT_MS; waited += POLL_MS) {
      await wait(POLL_MS);
      const [probe] = await scripting.executeScript({ target: { tabId }, world: "MAIN", func: readRoute, args: [target.origin, marker, from.title] });
      const route = probe?.result;
      // A different document (reloaded or navigated away): not ours to judge.
      if (!route) return "unknown";
      // Shopify held the old page (its "unsaved changes" prompt): leave it alone.
      if (route.path !== target.pathname) return "blocked";
      if (!route.old) return "done";
    }
  } catch {
    // Usually the page going away mid-load (Shopify loading the product itself).
    return "unknown";
  }
  return "fallback";
}
