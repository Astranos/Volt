import { normalizeShopifyShopInput } from "../domain/shopify-audit";

async function send(action: string, extra: Record<string, unknown> = {}): Promise<unknown> {
  const response: unknown = await chrome.runtime.sendMessage({ action, ...extra });
  if (!response || typeof response !== "object") throw new Error("Shopify audit did not respond.");
  const result = response as { success?: unknown; value?: unknown; error?: unknown };
  if (result.success !== true) throw new Error(typeof result.error === "string" ? result.error : "Shopify audit failed.");
  return result.value;
}

export async function getShopifyAuditConnection(): Promise<{ shop: string } | null> {
  const value = await send("shopifyAuditStatus");
  if (value === null) return null;
  if (!value || typeof value !== "object") throw new Error("Shopify connection status was invalid.");
  const shop = (value as { shop?: unknown }).shop;
  if (typeof shop !== "string" || normalizeShopifyShopInput(shop) !== shop) throw new Error("Shopify connection status was invalid.");
  return { shop };
}

export async function connectShopifyAudit(shop: string): Promise<void> {
  await send("shopifyAuditConnect", { shop });
}

export async function disconnectShopifyAudit(): Promise<void> {
  await send("shopifyAuditDisconnect");
}

export async function openShopifyAudit(): Promise<{ shop: string; date: string; count: number }> {
  const value = await send("shopifyAuditOpenYesterday");
  if (!value || typeof value !== "object") throw new Error("Shopify audit result was invalid.");
  const result = value as { shop?: unknown; date?: unknown; count?: unknown };
  if (typeof result.shop !== "string" || typeof result.date !== "string" || typeof result.count !== "number") {
    throw new Error("Shopify audit result was invalid.");
  }
  return { shop: result.shop, date: result.date, count: result.count };
}
