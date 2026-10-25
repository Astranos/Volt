import { isTrustedExtensionPageSender, type ExtensionMessageSender } from "../access/sender-policy.ts";
import { EXTENSION_SCANNER_SIGNAL_URL } from "../domain/mobile-scanner-signal-url.ts";
import {
  MAX_COMPARE_PRODUCTS,
  normalizeShopifyShopInput,
  pickActiveShopifyShop,
  SHOPIFY_ACTIVE_SHOP_KEY,
  validShopifyAdminProductUrl,
  auditRangeInComputerTimezone,
  parseShopifyAuditDays,
  type ShopifyAuditDays,
  type ShopifyAuditProduct,
  type ShopifyAuditResult,
} from "../domain/shopify-audit.ts";

type ShopifyMessage = {
  action?: unknown;
  shop?: unknown;
  query?: unknown;
  productId?: unknown;
  productIds?: unknown;
  title?: unknown;
  hidden?: unknown;
  days?: unknown;
};

type ShopifyResponse = { success: true; value: unknown } | { success: false; error: string };

function offscreenValue(response: unknown): unknown {
  if (!response || typeof response !== "object") throw new Error("Shopify connection did not respond.");
  const envelope = response as ShopifyResponse;
  if (envelope.success !== true) throw new Error(envelope.success === false ? envelope.error : "Shopify connection did not respond.");
  return envelope.value;
}

function auditResultFrom(value: unknown): ShopifyAuditResult {
  if (!value || typeof value !== "object") throw new Error("Shopify returned an invalid audit result.");
  const result = value as Partial<ShopifyAuditResult>;
  if (typeof result.shop !== "string" || normalizeShopifyShopInput(result.shop) !== result.shop
    || typeof result.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(result.date)
    || !Array.isArray(result.products)) throw new Error("Shopify returned an invalid audit result.");
  for (const product of result.products) {
    if (!product || typeof product.id !== "string" || typeof product.title !== "string"
      || typeof product.status !== "string" || !validShopifyAdminProductUrl(product.url, result.shop)) {
      throw new Error("Shopify returned an invalid product link.");
    }
  }
  return result as ShopifyAuditResult;
}

/** Audit tabs alive at once; closing one opens the next product. */
export const AUDIT_TAB_LIMIT = 3;
const TABS_RUN_KEY = "shopifyAuditTabsRun";
// Closing the group removes its tabs one by one; let that finish before refilling.
const TAB_CLOSE_SETTLE_MS = 300;

type TabsRun = {
  shop: string;
  date: string;
  total: number;
  groupId: number;
  windowId: number | null;
  tabIds: number[];
  queue: ShopifyAuditProduct[];
};

export function createShopifyAuditController({
  chromeApi,
  extensionId,
  sendOffscreenMessage,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: {
  chromeApi: typeof chrome;
  extensionId: string;
  sendOffscreenMessage: (message: unknown) => Promise<unknown>;
  wait?: (ms: number) => Promise<unknown>;
}) {
  let opening = false;
  // Tab removals are handled one at a time so refills never race each other.
  let tabEvents: Promise<unknown> = Promise.resolve();

  async function forward(action: string, extra: Record<string, unknown> = {}) {
    return offscreenValue(await sendOffscreenMessage({ action, ...extra }));
  }

  // A page may name the store it's showing; otherwise the store picked on this computer is used.
  async function storeFor(message: ShopifyMessage): Promise<{ shop?: string }> {
    if (message.shop !== undefined) {
      const shop = typeof message.shop === "string" ? normalizeShopifyShopInput(message.shop) : null;
      if (!shop) throw new Error("Enter a valid store.myshopify.com domain.");
      return { shop };
    }
    const saved = (await chromeApi.storage.local.get(SHOPIFY_ACTIVE_SHOP_KEY))[SHOPIFY_ACTIVE_SHOP_KEY];
    const shop = typeof saved === "string" ? normalizeShopifyShopInput(saved) : null;
    return shop ? { shop } : {};
  }

  async function status() {
    const value = await forward("shopifyAuditOffscreenStores");
    if (!Array.isArray(value)) throw new Error("Shopify connection status was invalid.");
    const shops = value.map((row: unknown) => {
      const shop = row && typeof row === "object" ? (row as { shop?: unknown }).shop : null;
      if (typeof shop !== "string" || normalizeShopifyShopInput(shop) !== shop) throw new Error("Shopify connection status was invalid.");
      return shop;
    });
    const saved = (await chromeApi.storage.local.get(SHOPIFY_ACTIVE_SHOP_KEY))[SHOPIFY_ACTIVE_SHOP_KEY];
    const shop = pickActiveShopifyShop(saved, shops);
    // A store disconnected elsewhere stops being the active one here.
    if (shop !== saved) await (shop ? chromeApi.storage.local.set({ [SHOPIFY_ACTIVE_SHOP_KEY]: shop }) : chromeApi.storage.local.remove(SHOPIFY_ACTIVE_SHOP_KEY));
    return shop ? { shop, shops } : null;
  }

  async function listYesterday(days: ShopifyAuditDays = 1, store: { shop?: string } = {}) {
    const range = auditRangeInComputerTimezone(days);
    const result = auditResultFrom(await forward("shopifyAuditOffscreenListYesterday", { ...range, ...store }));
    if (store.shop && result.shop !== store.shop) throw new Error("Shopify returned the wrong store.");
    if (result.date !== range.date) throw new Error("Shopify returned the wrong audit date.");
    return result;
  }

  // Run state lives in session storage so a service worker restart keeps the queue.
  async function loadRun(): Promise<TabsRun | null> {
    const stored = await chromeApi.storage.session.get(TABS_RUN_KEY);
    const run = stored[TABS_RUN_KEY] as TabsRun | undefined;
    return run && Array.isArray(run.tabIds) && Array.isArray(run.queue) ? run : null;
  }
  const saveRun = (run: TabsRun) => chromeApi.storage.session.set({ [TABS_RUN_KEY]: run });
  const clearRun = () => chromeApi.storage.session.remove(TABS_RUN_KEY);
  const groupExists = (groupId: number) => chromeApi.tabGroups.get(groupId).then(() => true, () => false);

  // A tiny extension page stands in for the product until its tab is viewed,
  // so background audit tabs don't each run Shopify admin.
  const lazyTabUrl = (product: ShopifyAuditProduct) => {
    const params = new URLSearchParams({ u: product.url, t: product.title });
    return `${chromeApi.runtime.getURL("/shopify-audit-tab.html")}?${params}`;
  };

  async function openTab(product: ShopifyAuditProduct, windowId: number | null, active: boolean) {
    const tab = await chromeApi.tabs.create({ url: lazyTabUrl(product), active, ...(windowId === null ? {} : { windowId }) });
    if (typeof tab.id !== "number") throw new Error("Chrome did not open the audit tab.");
    return tab.id;
  }

  // Starting an audit goes through the same one-at-a-time chain as tab-close
  // handling, so a late close handler can never clear or overwrite a new run.
  function openYesterday(windowId: number | undefined) {
    if (opening) return Promise.reject(new Error("A Shopify audit is already opening."));
    const result = tabEvents.then(() => openYesterdayNow(windowId));
    tabEvents = result.catch(() => undefined);
    return result;
  }

  async function openYesterdayNow(windowId: number | undefined) {
    if (opening) throw new Error("A Shopify audit is already opening.");
    opening = true;
    try {
      const existing = await loadRun();
      if (existing && await groupExists(existing.groupId)) {
        // Clicking Audit again returns to the open audit instead of duplicating it.
        const first = existing.tabIds[0];
        if (typeof first === "number") await chromeApi.tabs.update(first, { active: true }).catch(() => undefined);
        return { shop: existing.shop, date: existing.date, count: existing.total, opened: existing.tabIds.length, resumed: true };
      }
      if (existing) await clearRun();

      const result = await listYesterday(1, await storeFor({}));
      const targetWindow = windowId ?? null;
      const first = result.products.slice(0, AUDIT_TAB_LIMIT);
      const tabIds: number[] = [];
      try {
        for (const [index, product] of first.entries()) tabIds.push(await openTab(product, targetWindow, index === 0));
        if (tabIds.length === 0) return { shop: result.shop, date: result.date, count: 0, opened: 0, resumed: false };
        const groupId = await chromeApi.tabs.group({ tabIds: tabIds as [number, ...number[]] });
        await chromeApi.tabGroups.update(groupId, { title: `Shopify audit · ${result.date}`, color: "blue", collapsed: false });
        await saveRun({ shop: result.shop, date: result.date, total: result.products.length, groupId, windowId: targetWindow, tabIds, queue: result.products.slice(first.length) });
      } catch (error) {
        await Promise.all(tabIds.map((id) => chromeApi.tabs.remove(id).catch(() => undefined)));
        throw new Error(`Could not open the Shopify audit: ${error instanceof Error ? error.message : String(error)}`);
      }
      return { shop: result.shop, date: result.date, count: result.products.length, opened: tabIds.length, resumed: false };
    } finally {
      opening = false;
    }
  }

  // Chrome refuses tab edits while a tab is being dragged; that's not the
  // audit being closed, so wait it out briefly instead of giving up.
  async function groupWithRetry(groupId: number, tabId: number) {
    for (let attempt = 0; ; attempt++) {
      try {
        await chromeApi.tabs.group({ groupId, tabIds: [tabId] });
        return;
      } catch (error) {
        const busy = error instanceof Error && /cannot be edited right now/i.test(error.message);
        if (!busy || attempt >= 10) throw error;
        await wait(300);
      }
    }
  }

  async function refillAfterClose(tabId: number, windowClosing: boolean) {
    const run = await loadRun();
    if (!run || !run.tabIds.includes(tabId)) return;
    if (windowClosing) return clearRun();
    await wait(TAB_CLOSE_SETTLE_MS);
    const alive: number[] = [];
    for (const id of run.tabIds) {
      if (id !== tabId && await chromeApi.tabs.get(id).then(() => true, () => false)) alive.push(id);
    }
    // Every audit tab gone at once means the group was closed: that cancels the audit.
    if (alive.length === 0 || !await groupExists(run.groupId)) return clearRun();
    const queue = [...run.queue];
    while (alive.length < AUDIT_TAB_LIMIT && queue.length > 0) {
      const product = queue.shift()!;
      const id = await openTab(product, run.windowId, false);
      try {
        await groupWithRetry(run.groupId, id);
      } catch {
        await chromeApi.tabs.remove(id).catch(() => undefined);
        return clearRun();
      }
      alive.push(id);
    }
    await saveRun({ ...run, tabIds: alive, queue });
  }

  /** Wire to chrome.tabs.onRemoved: closing a reviewed audit tab opens the next product. */
  function handleTabRemoved(tabId: number, removeInfo: { isWindowClosing?: boolean } = {}) {
    tabEvents = tabEvents.then(() => refillAfterClose(tabId, !!removeInfo.isWindowClosing)).catch(() => undefined);
    return tabEvents;
  }

  function handleMessage(rawMessage: unknown, sender: ExtensionMessageSender & { tab?: { windowId?: number } }, sendResponse: (response?: unknown) => void) {
    if (!rawMessage || typeof rawMessage !== "object") return false;
    const message = rawMessage as ShopifyMessage;
    if (![
      "shopifyAuditStatus", "shopifyAuditConnect", "shopifyAuditDisconnect", "shopifyAuditOpenYesterday", "shopifyAuditListYesterday", "shopifyAuditSearchProducts",
      "shopifyAuditProductDetails", "shopifyAuditHiddenProducts", "shopifyAuditSetProductHidden",
    ].includes(String(message.action))) return false;
    if (!isTrustedExtensionPageSender(sender, extensionId, ["/options.html", "/newtab.html", "/shopify-compare.html", "/sidepanel.html"])) {
      sendResponse({ success: false, error: "unauthorized_extension_sender" });
      return true;
    }
    const operation = async () => {
      switch (message.action) {
        case "shopifyAuditStatus":
          return status();
        case "shopifyAuditConnect": {
          if (typeof message.shop !== "string") throw new Error("Enter a Shopify store domain.");
          const shop = normalizeShopifyShopInput(message.shop);
          if (!shop) throw new Error("Enter a valid store.myshopify.com domain.");
          const value = await forward("shopifyAuditOffscreenConnect", { shop });
          if (!value || typeof value !== "object" || typeof (value as { url?: unknown }).url !== "string") throw new Error("Shopify did not return a connection link.");
          const connection = value as { url: string; browserCookie?: { url?: unknown; name?: unknown; value?: unknown } };
          const url = new URL(connection.url);
          if (url.protocol !== "https:" || url.hostname !== shop || url.pathname !== "/admin/oauth/authorize") throw new Error("Shopify returned an invalid connection link.");
          const cookie = connection.browserCookie;
          const callback = url.searchParams.get("redirect_uri");
          if (!callback || cookie?.url !== callback || cookie.name !== "volt_shopify_oauth"
            || typeof cookie.value !== "string" || !/^[a-f0-9]{64}$/.test(cookie.value)
            || new URL(callback).origin !== new URL(EXTENSION_SCANNER_SIGNAL_URL).origin
            || new URL(callback).pathname !== "/api/shopify/callback") {
            throw new Error("Shopify browser authorization was invalid.");
          }
          const savedCookie = await chromeApi.cookies.set({
            url: callback,
            name: cookie.name,
            value: cookie.value,
            path: "/api/shopify/callback",
            secure: true,
            httpOnly: true,
            sameSite: "lax",
            expirationDate: Date.now() / 1000 + 600,
          });
          if (!savedCookie) throw new Error("Could not prepare the Shopify browser authorization.");
          await chromeApi.tabs.create({ url: url.href, active: true, ...(sender.tab?.windowId === undefined ? {} : { windowId: sender.tab.windowId }) });
          return { shop };
        }
        case "shopifyAuditDisconnect": {
          // Naming no store disconnects all of them.
          const store = message.shop === undefined ? {} : await storeFor(message);
          return forward("shopifyAuditOffscreenDisconnect", store);
        }
        case "shopifyAuditOpenYesterday":
          return openYesterday(sender.tab?.windowId);
        case "shopifyAuditListYesterday":
          return listYesterday(parseShopifyAuditDays(message.days), await storeFor(message));
        case "shopifyAuditSearchProducts": {
          if (typeof message.query !== "string") throw new Error("Enter a product search.");
          const query = message.query.trim();
          if (query.length < 2 || query.length > 120) throw new Error("Search must be 2 to 120 characters.");
          return forward("shopifyAuditOffscreenSearchProducts", { query, ...await storeFor(message) });
        }
        case "shopifyAuditProductDetails": {
          const ids = message.productIds;
          if (!Array.isArray(ids) || !ids.length || ids.length > MAX_COMPARE_PRODUCTS || new Set(ids).size !== ids.length
            || !ids.every((id) => typeof id === "string" && /^gid:\/\/shopify\/Product\/\d+$/.test(id))) {
            throw new Error(`Pick 1 to ${MAX_COMPARE_PRODUCTS} Shopify products to compare.`);
          }
          return forward("shopifyAuditOffscreenProductDetails", { productIds: ids, ...await storeFor(message) });
        }
        case "shopifyAuditHiddenProducts":
          return forward("shopifyAuditOffscreenHiddenProducts", await storeFor(message));
        case "shopifyAuditSetProductHidden": {
          if (typeof message.productId !== "string" || !/^gid:\/\/shopify\/Product\/\d+$/.test(message.productId)
            || typeof message.title !== "string" || !message.title.trim() || typeof message.hidden !== "boolean") {
            throw new Error("Invalid Shopify product.");
          }
          return forward("shopifyAuditOffscreenSetProductHidden", { productId: message.productId, title: message.title, hidden: message.hidden, ...await storeFor(message) });
        }
        default:
          return null;
      }
    };
    void operation().then((value) => sendResponse({ success: true, value }))
      .catch((error: unknown) => sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  return { handleMessage, handleTabRemoved };
}
