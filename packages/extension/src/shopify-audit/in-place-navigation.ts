import type { ShopifyAuditProduct } from "../domain/shopify-audit";

type ScriptingApi = Pick<typeof chrome.scripting, "executeScript">;

const POLL_MS = 250;
const TIMEOUT_MS = 4_000;

// Runs inside Shopify's page. The admin is a single-page app: changing the
// address and announcing it the way the back button does lets its own router
// swap the product in place, like Sidekick does, instead of a full page load.
function routeTo(path: string) {
  history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  return true;
}

// Runs inside Shopify's page: where it is now and whether the new product shows.
function readRoute(title: string) {
  const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const wanted = clean(title);
  const headings = Array.from(document.querySelectorAll("h1"), (heading) => clean(heading.textContent));
  return {
    path: location.pathname,
    shown: !!wanted && (clean(document.title).includes(wanted) || headings.some((heading) => heading.includes(wanted))),
  };
}

/**
 * Moves a Shopify admin tab to another product without a full reload. Returns
 * false when that isn't possible or didn't take, so the caller falls back to a
 * normal page load; Shopify internals can change at any time.
 */
export async function openProductInPlace(
  scripting: ScriptingApi,
  tabId: number,
  currentUrl: string | undefined,
  from: ShopifyAuditProduct | undefined,
  to: ShopifyAuditProduct,
  wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  let current: URL;
  let target: URL;
  try {
    current = new URL(currentUrl ?? "");
    target = new URL(to.url);
  } catch {
    return false;
  }
  // Same store's admin only, and a title check can't tell two same-named products apart.
  const store = (path: string) => path.split("/").slice(0, 3).join("/");
  if (current.origin !== target.origin || store(current.pathname) !== store(target.pathname)) return false;
  if (!from || from.title.trim().toLowerCase() === to.title.trim().toLowerCase()) return false;

  try {
    const [started] = await scripting.executeScript({ target: { tabId }, world: "MAIN", func: routeTo, args: [target.pathname] });
    if (started?.result !== true) return false;
    for (let waited = 0; waited < TIMEOUT_MS; waited += POLL_MS) {
      await wait(POLL_MS);
      const [probe] = await scripting.executeScript({ target: { tabId }, world: "MAIN", func: readRoute, args: [to.title] });
      const route = probe?.result;
      if (!route) return false;
      // Shopify held the old page (its "unsaved changes" prompt): don't force a reload over it.
      if (route.path !== target.pathname) return true;
      if (route.shown) return true;
    }
  } catch {
    return false;
  }
  return false;
}
