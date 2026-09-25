import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { CLERK_SIGN_IN_URL } from "../../access/config";
import { connectShopifyAudit, disconnectShopifyAudit, getShopifyAuditConnection } from "../../shopify-audit/client";
import { findOpenShopifyAdminShops, shopDomainFromAdminUrl } from "../../shopify-audit/store-discovery";

export function ShopifyAuditSettings() {
  const [connectedShop, setConnectedShop] = useState<string | null>(null);
  const [availableShops, setAvailableShops] = useState<string[]>([]);
  const [selectedShop, setSelectedShop] = useState("");
  const [discoveryTabId, setDiscoveryTabId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [waitingForInstall, setWaitingForInstall] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const connection = await getShopifyAuditConnection();
      setConnectedShop(connection?.shop ?? null);
      if (connection) {
        setWaitingForInstall(false);
        setError(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not check Shopify connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    void findOpenShopifyAdminShops()
      .then((shops) => {
        setAvailableShops(shops);
        setSelectedShop((current) => shops.includes(current) ? current : shops[0] ?? "");
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!waitingForInstall) return;
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh, waitingForInstall]);

  const startOAuth = useCallback(async (shop: string) => {
    setWorking(true);
    setError(null);
    try {
      await connectShopifyAudit(shop);
      setWaitingForInstall(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start Shopify connection.");
    } finally {
      setWorking(false);
    }
  }, []);

  useEffect(() => {
    if (discoveryTabId === null) return;
    let finished = false;
    const check = async () => {
      if (finished) return;
      try {
        const tab = await chrome.tabs.get(discoveryTabId);
        if (finished) return;
        const shop = shopDomainFromAdminUrl(tab.url);
        if (!shop) return;
        finished = true;
        setDiscoveryTabId(null);
        await startOAuth(shop);
      } catch {
        finished = true;
        setDiscoveryTabId(null);
        setError("Shopify sign-in was closed before a store was selected.");
      }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 1000);
    return () => { finished = true; window.clearInterval(timer); };
  }, [discoveryTabId, startOAuth]);

  const connect = async () => {
    if (selectedShop) {
      await startOAuth(selectedShop);
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const tab = await chrome.tabs.create({ url: "https://admin.shopify.com/", active: true });
      if (typeof tab.id !== "number") throw new Error("Could not open Shopify sign-in.");
      setDiscoveryTabId(tab.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open Shopify sign-in.");
    } finally {
      setWorking(false);
    }
  };

  const disconnect = async () => {
    setWorking(true);
    setError(null);
    try {
      await disconnectShopifyAudit();
      setConnectedShop(null);
      setWaitingForInstall(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect Shopify.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="scroll-mt-20 space-y-4" id="shopify-audit">
      <div>
        <h2 className="text-2xl font-bold">Shopify product audit</h2>
        <p className="text-muted-foreground">Connect your store to open yesterday's new products in a tab group from the Volt new tab page. Draft and unpublished products are included.</p>
      </div>
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        {loading ? <p className="text-sm text-muted-foreground">Checking Shopify connection…</p> : connectedShop ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-medium">Connected to {connectedShop}</p><p className="text-sm text-muted-foreground">Volt has read-only product access for your account.</p></div>
            <button className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50" disabled={working} onClick={() => void disconnect()} type="button">Disconnect</button>
          </div>
        ) : (
          <div className="space-y-3">
            {availableShops.length > 0 ? (
              <label className="block max-w-md space-y-1 text-sm font-medium">
                <span>Store found in your Shopify tabs</span>
                <select className="h-10 w-full rounded-md border border-input bg-background px-3" onChange={(event) => setSelectedShop(event.target.value)} value={selectedShop}>
                  {availableShops.map((shop) => <option key={shop} value={shop}>{shop}</option>)}
                </select>
              </label>
            ) : <p className="text-sm text-muted-foreground">Sign in to Shopify and choose your store. Volt will detect it automatically.</p>}
            <p className="text-xs text-muted-foreground">Shopify will ask you to approve read-only access to products.</p>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={working || discoveryTabId !== null} onClick={() => void connect()} type="button">{discoveryTabId !== null ? "Waiting for Shopify…" : waitingForInstall ? "Try connecting again" : "Connect Shopify"} <ExternalLink aria-hidden="true" className="ml-1 inline h-3.5 w-3.5" /></button>
              <button aria-label="Refresh Shopify connection" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" onClick={() => void refresh()} type="button"><RefreshCw aria-hidden="true" className="inline h-4 w-4" /> Check connection</button>
            </div>
            {discoveryTabId !== null && <p className="text-sm text-muted-foreground">Choose your store in the Shopify tab. Volt will continue when its admin page opens.</p>}
            {waitingForInstall && <p className="text-sm text-muted-foreground">Finish the approval in the Shopify tab. This page will update when your store connects.</p>}
          </div>
        )}
        {error && <div className="mt-3 text-sm text-destructive" role="alert">{error} {error.toLowerCase().includes("sign in") && <button className="underline" onClick={() => void chrome.tabs.create({ url: CLERK_SIGN_IN_URL })} type="button">Sign in to Volt</button>}</div>}
      </div>
    </section>
  );
}
