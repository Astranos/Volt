import { useCallback, useEffect, useState } from "react";
import { SHOPIFY_ACTIVE_SHOP_KEY } from "../domain/shopify-audit";
import { getShopifyAuditConnection, setActiveShopifyStore, type ShopifyConnection } from "./client";

/** The account's connected Shopify stores and the active one, following changes from other pages. */
export function useShopifyStores() {
  const [connection, setConnection] = useState<ShopifyConnection | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await getShopifyAuditConnection();
      setConnection(next);
      setError(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check Shopify connection.");
      throw cause;
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh().catch(() => undefined);
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      const shop = changes[SHOPIFY_ACTIVE_SHOP_KEY]?.newValue;
      if (area !== "local" || typeof shop !== "string") return;
      setConnection((current) => current?.shops.includes(shop) ? { ...current, shop } : current);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [refresh]);
  const select = useCallback(async (shop: string) => {
    setConnection((current) => current?.shops.includes(shop) ? { ...current, shop } : current);
    await setActiveShopifyStore(shop);
  }, []);
  return { connection, loaded, error, refresh, select };
}
