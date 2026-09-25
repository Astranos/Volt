import { isTrustedExtensionPageSender, type ExtensionMessageSender } from "../access/sender-policy.ts";
import {
  normalizeShopifyShopInput,
  validShopifyAdminProductUrl,
  yesterdayInComputerTimezone,
  type ShopifyAuditResult,
} from "../domain/shopify-audit.ts";

type ShopifyMessage = {
  action?: unknown;
  shop?: unknown;
  query?: unknown;
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

export function createShopifyAuditController({
  chromeApi,
  extensionId,
  sendOffscreenMessage,
}: {
  chromeApi: typeof chrome;
  extensionId: string;
  sendOffscreenMessage: (message: unknown) => Promise<unknown>;
}) {
  let opening = false;

  async function forward(action: string, extra: Record<string, unknown> = {}) {
    return offscreenValue(await sendOffscreenMessage({ action, ...extra }));
  }

  async function openYesterday(windowId: number | undefined) {
    if (opening) throw new Error("A Shopify audit is already opening.");
    opening = true;
    try {
      const range = yesterdayInComputerTimezone();
      const result = auditResultFrom(await forward("shopifyAuditOffscreenListYesterday", range));
      if (result.date !== range.date) throw new Error("Shopify returned the wrong audit date.");
      const tabIds: number[] = [];
      let creationError: unknown = null;
      for (const product of result.products) {
        try {
          const tab = await chromeApi.tabs.create({
            url: product.url,
            active: false,
            ...(windowId === undefined ? {} : { windowId }),
          });
          if (typeof tab.id === "number") tabIds.push(tab.id);
        } catch (error) {
          creationError = error;
          break;
        }
      }
      if (tabIds.length > 0) {
        const groupId = await chromeApi.tabs.group({ tabIds: tabIds as [number, ...number[]] });
        await chromeApi.tabGroups.update(groupId, { title: `Shopify audit · ${result.date}`, color: "blue", collapsed: false });
        await chromeApi.tabs.update(tabIds[0], { active: true });
      }
      if (creationError) throw new Error(`Opened ${tabIds.length} of ${result.products.length} products: ${String(creationError)}`);
      return { shop: result.shop, date: result.date, count: tabIds.length };
    } finally {
      opening = false;
    }
  }

  function handleMessage(rawMessage: unknown, sender: ExtensionMessageSender & { tab?: { windowId?: number } }, sendResponse: (response?: unknown) => void) {
    if (!rawMessage || typeof rawMessage !== "object") return false;
    const message = rawMessage as ShopifyMessage;
    if (![
      "shopifyAuditStatus", "shopifyAuditConnect", "shopifyAuditDisconnect", "shopifyAuditOpenYesterday", "shopifyAuditSearchProducts",
    ].includes(String(message.action))) return false;
    if (!isTrustedExtensionPageSender(sender, extensionId, ["/options.html", "/newtab.html"])) {
      sendResponse({ success: false, error: "unauthorized_extension_sender" });
      return true;
    }
    const operation = async () => {
      switch (message.action) {
        case "shopifyAuditStatus":
          return forward("shopifyAuditOffscreenStatus");
        case "shopifyAuditConnect": {
          if (typeof message.shop !== "string") throw new Error("Enter a Shopify store domain.");
          const shop = normalizeShopifyShopInput(message.shop);
          if (!shop) throw new Error("Enter a valid store.myshopify.com domain.");
          const value = await forward("shopifyAuditOffscreenConnect", { shop });
          if (!value || typeof value !== "object" || typeof (value as { url?: unknown }).url !== "string") throw new Error("Shopify did not return a connection link.");
          const url = new URL((value as { url: string }).url);
          if (url.protocol !== "https:" || url.hostname !== shop || url.pathname !== "/admin/oauth/authorize") throw new Error("Shopify returned an invalid connection link.");
          await chromeApi.tabs.create({ url: url.href, active: true, ...(sender.tab?.windowId === undefined ? {} : { windowId: sender.tab.windowId }) });
          return { shop };
        }
        case "shopifyAuditDisconnect":
          return forward("shopifyAuditOffscreenDisconnect");
        case "shopifyAuditOpenYesterday":
          return openYesterday(sender.tab?.windowId);
        case "shopifyAuditSearchProducts": {
          if (typeof message.query !== "string") throw new Error("Enter a product search.");
          const query = message.query.trim();
          if (query.length < 2 || query.length > 120) throw new Error("Search must be 2 to 120 characters.");
          return forward("shopifyAuditOffscreenSearchProducts", { query });
        }
        default:
          return null;
      }
    };
    void operation().then((value) => sendResponse({ success: true, value }))
      .catch((error: unknown) => sendResponse({ success: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  return { handleMessage };
}
