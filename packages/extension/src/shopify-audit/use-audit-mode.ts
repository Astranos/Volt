import { useEffect, useRef, useState } from "react";
import { parseShopifyAuditMode, SHOPIFY_AUDIT_MODE_KEY, type ShopifyAuditMode } from "../domain/shopify-audit";

/** The stored audit mode (chrome.storage.sync), following changes made elsewhere. */
export function useShopifyAuditMode(): [ShopifyAuditMode, (mode: ShopifyAuditMode) => void] {
  const [mode, setMode] = useState<ShopifyAuditMode>("sidepanel");
  // A choice or storage event is newer than the initial read; don't let it revert.
  const settled = useRef(false);
  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    let active = true;
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area !== "sync" || !changes[SHOPIFY_AUDIT_MODE_KEY]) return;
      settled.current = true;
      setMode(parseShopifyAuditMode(changes[SHOPIFY_AUDIT_MODE_KEY].newValue));
    };
    void chrome.storage.sync.get(SHOPIFY_AUDIT_MODE_KEY).then((stored) => {
      if (active && !settled.current) setMode(parseShopifyAuditMode(stored[SHOPIFY_AUDIT_MODE_KEY]));
    }).catch(() => undefined);
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);
  const choose = (next: ShopifyAuditMode) => {
    settled.current = true;
    setMode(next);
    void chrome.storage?.sync.set({ [SHOPIFY_AUDIT_MODE_KEY]: next }).catch(() => undefined);
  };
  return [mode, choose];
}
