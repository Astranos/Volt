import { useCallback, useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { CLERK_SIGN_IN_URL } from "../../access/config";
import { normalizeShopifyShopInput } from "../../domain/shopify-audit";
import { connectShopifyAudit, disconnectShopifyAudit, getShopifyAuditConnection } from "../../shopify-audit/client";

export function ShopifyAuditSettings() {
  const [shop, setShop] = useState("");
  const [connectedShop, setConnectedShop] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [waitingForInstall, setWaitingForInstall] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const connection = await getShopifyAuditConnection();
      setConnectedShop(connection?.shop ?? null);
      if (connection) {
        setShop(connection.shop);
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
    if (!waitingForInstall) return;
    const timer = window.setInterval(() => { void refresh(); }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh, waitingForInstall]);

  const connect = async () => {
    const domain = normalizeShopifyShopInput(shop);
    if (!domain) { setError("Enter your store's .myshopify.com domain."); return; }
    setWorking(true);
    setError(null);
    try {
      await connectShopifyAudit(domain);
      setShop(domain);
      setWaitingForInstall(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start Shopify connection.");
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
            <label className="block max-w-md space-y-1 text-sm font-medium">
              <span>Shopify store domain</span>
              <input autoComplete="url" className="h-10 w-full rounded-md border border-input bg-background px-3" onChange={(event) => setShop(event.target.value)} placeholder="your-store.myshopify.com" value={shop} />
            </label>
            <p className="text-xs text-muted-foreground">Use the permanent .myshopify.com domain. Shopify will ask you to approve read-only access to products.</p>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={working || !normalizeShopifyShopInput(shop)} onClick={() => void connect()} type="button">{waitingForInstall ? "Try connecting again" : "Connect Shopify"} <ExternalLink aria-hidden="true" className="ml-1 inline h-3.5 w-3.5" /></button>
              <button aria-label="Refresh Shopify connection" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" onClick={() => void refresh()} type="button"><RefreshCw aria-hidden="true" className="inline h-4 w-4" /> Check connection</button>
            </div>
            {waitingForInstall && <p className="text-sm text-muted-foreground">Finish the approval in the Shopify tab. This page will update when your store connects.</p>}
          </div>
        )}
        {error && <div className="mt-3 text-sm text-destructive" role="alert">{error} {error.toLowerCase().includes("sign in") && <button className="underline" onClick={() => void chrome.tabs.create({ url: CLERK_SIGN_IN_URL })} type="button">Sign in to Volt</button>}</div>}
      </div>
    </section>
  );
}
