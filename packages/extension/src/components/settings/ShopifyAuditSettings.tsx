import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, ExternalLink, RefreshCw } from "lucide-react";
import { CLERK_SIGN_IN_URL } from "../../access/config";
import { connectShopifyAudit, disconnectShopifyAudit, listHiddenShopifyProducts, setShopifyProductHidden, type ShopifyHiddenProduct } from "../../shopify-audit/client";
import { useShopifyStores } from "../../shopify-audit/use-shopify-stores";
import { findOpenShopifyAdminShops, shopDomainFromAdminUrl } from "../../shopify-audit/store-discovery";
import { useShopifyAuditMode } from "../../shopify-audit/use-audit-mode";
import { fetchKioskQueue, normalizeKioskStore } from "../../kiosk/kiosk-requests";
import { useKioskStore } from "../../kiosk/use-kiosk";

/** Which store kiosk's "Ask to see item" requests show on the new tab. */
function KioskStoreSetting() {
  const [store, saveStore] = useKioskStore();
  const [draft, setDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const save = async () => {
    const slug = normalizeKioskStore(draft);
    if (!slug) {
      setMessage("Enter a store like taylormi or taylormi.paymore.com.");
      return;
    }
    setChecking(true);
    setMessage(null);
    try {
      await fetchKioskQueue(slug);
      await saveStore(slug);
      setDraft("");
    } catch (cause) {
      setMessage(cause instanceof Error ? `Couldn't reach that kiosk: ${cause.message}` : "Couldn't reach that kiosk.");
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="font-medium">Kiosk requests</p>
      <p className="text-sm text-muted-foreground">Show customers' "Ask to see item" requests from your store kiosk on the new tab, with Found and Shown buttons.</p>
      {store ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">Showing requests for <span className="font-medium">{store}</span></p>
          <button className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => void saveStore(null)} type="button">Stop showing</button>
        </div>
      ) : (
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <input aria-label="Kiosk store" className="h-9 min-w-56 flex-1 rounded-md border border-input bg-background px-3 text-sm" onChange={(event) => setDraft(event.target.value)} placeholder="taylormi or taylormi.paymore.com" value={draft} />
          <button className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={checking || !draft.trim()} type="submit">{checking ? "Checking…" : "Save"}</button>
        </form>
      )}
      {message && <p className="mt-2 text-sm text-destructive" role="alert">{message}</p>}
    </div>
  );
}
import { MAX_SHOPIFY_STORES, type ShopifyAuditMode } from "../../domain/shopify-audit";

const AUDIT_MODES: Array<{ value: ShopifyAuditMode; label: string; description: string }> = [
  { value: "sidepanel", label: "Side panel", description: "Review one product at a time in a single tab, with a checklist in the side panel." },
  { value: "tabs", label: "Tab group", description: "Open products in a tab group, three at a time. Closing a reviewed tab opens the next one." },
];

export function ShopifyAuditSettings() {
  const stores = useShopifyStores();
  const shops = useMemo(() => stores.connection?.shops ?? [], [stores.connection]);
  const activeShop = stores.connection?.shop ?? null;
  const [openShops, setOpenShops] = useState<string[]>([]);
  const [selectedShop, setSelectedShop] = useState("");
  const [discoveryTabId, setDiscoveryTabId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [working, setWorking] = useState(false);
  // The store being approved in a Shopify tab; cleared once it shows up as connected.
  const [pendingShop, setPendingShop] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hiddenProducts, setHiddenProducts] = useState<ShopifyHiddenProduct[] | null>(null);
  const [auditMode, setAuditMode] = useShopifyAuditMode();
  const { refresh } = stores;
  // Stores open in Shopify tabs that aren't connected yet.
  const availableShops = useMemo(() => openShops.filter((shop) => !shops.includes(shop)), [openShops, shops]);
  const showConnect = shops.length === 0 || adding;

  useEffect(() => {
    if (!activeShop) { setHiddenProducts(null); return; }
    let current = true;
    void listHiddenShopifyProducts(activeShop)
      .then((products) => { if (current) setHiddenProducts(products); })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load hidden products."));
    return () => { current = false; };
  }, [activeShop]);
  useEffect(() => {
    void findOpenShopifyAdminShops().then(setOpenShops).catch(() => undefined);
  }, []);
  useEffect(() => {
    setSelectedShop((current) => availableShops.includes(current) ? current : availableShops[0] ?? "");
  }, [availableShops]);
  useEffect(() => {
    if (pendingShop && shops.includes(pendingShop)) {
      setPendingShop(null);
      setAdding(false);
      setError(null);
    }
  }, [pendingShop, shops]);
  useEffect(() => {
    if (!pendingShop) return;
    const timer = window.setInterval(() => { void refresh().catch(() => undefined); }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh, pendingShop]);

  const startOAuth = useCallback(async (shop: string) => {
    setWorking(true);
    setError(null);
    try {
      await connectShopifyAudit(shop);
      // A reconnect is already listed, so there's nothing to wait for.
      setPendingShop(shops.includes(shop) ? null : shop);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start Shopify connection.");
    } finally {
      setWorking(false);
    }
  }, [shops]);

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

  const disconnect = async (shop: string) => {
    setWorking(true);
    setError(null);
    try {
      await disconnectShopifyAudit(shop);
      if (pendingShop === shop) setPendingShop(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect Shopify.");
    } finally {
      setWorking(false);
    }
  };

  const unhide = async (product: ShopifyHiddenProduct) => {
    setError(null);
    try {
      await setShopifyProductHidden(product, false, activeShop ?? undefined);
      setHiddenProducts((current) => current?.filter((item) => item.id !== product.id) ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not show the product again.");
    }
  };

  const shownError = error ?? (stores.connection ? null : stores.error);
  const button = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50";

  return (
    <section className="scroll-mt-20 space-y-4" id="shopify-audit">
      <div>
        <h2 className="text-2xl font-bold">Shopify product audit</h2>
        <p className="text-muted-foreground">Connect your stores to search their inventory and review yesterday's new products from the Volt new tab page. Draft and unpublished products are included.</p>
      </div>
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        {!stores.loaded ? <p className="text-sm text-muted-foreground">Checking Shopify connection…</p> : (
          <div className="space-y-4">
            {shops.length > 0 && (
              <div className="space-y-2">
                <div>
                  <p className="font-medium">{shops.length === 1 ? `Connected to ${shops[0]}` : `${shops.length} stores connected`}</p>
                  <p className="text-sm text-muted-foreground">
                    Volt has read-only product access for your account.
                    {shops.length > 1 && " This computer searches and audits the active store. Switch stores here or from the new tab's Shopify results."}
                  </p>
                </div>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {shops.map((shop) => (
                    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2" key={shop}>
                      <span className="min-w-0 truncate text-sm">
                        <span className="font-medium">{shop}</span>
                        {shops.length > 1 && shop === activeShop && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Active</span>}
                      </span>
                      <span className="flex shrink-0 flex-wrap gap-2">
                        {shop !== activeShop && <button className={button} disabled={working} onClick={() => void stores.select(shop).catch(() => undefined)} type="button">Make active</button>}
                        <button className={button} disabled={working} onClick={() => void startOAuth(shop)} title="Approve access again if Shopify asks you to reconnect" type="button">Reconnect</button>
                        <button className={button} disabled={working} onClick={() => void disconnect(shop)} type="button">Disconnect</button>
                      </span>
                    </li>
                  ))}
                </ul>
                {!showConnect && (shops.length < MAX_SHOPIFY_STORES
                  ? <button className={button} disabled={working} onClick={() => setAdding(true)} type="button">Connect another store</button>
                  : <p className="text-xs text-muted-foreground">You can connect up to {MAX_SHOPIFY_STORES} stores.</p>)}
              </div>
            )}
            {showConnect && (
              <div className="space-y-3">
                {shops.length > 0 && <p className="font-medium">Connect another store</p>}
                {availableShops.length > 0 ? (
                  <label className="block max-w-md space-y-1 text-sm font-medium">
                    <span>Store found in your Shopify tabs</span>
                    <select className="h-10 w-full rounded-md border border-input bg-background px-3" onChange={(event) => setSelectedShop(event.target.value)} value={selectedShop}>
                      {availableShops.map((shop) => <option key={shop} value={shop}>{shop}</option>)}
                    </select>
                  </label>
                ) : <p className="text-sm text-muted-foreground">Sign in to Shopify and choose {shops.length > 0 ? "the store to add" : "your store"}. Volt will detect it automatically.</p>}
                <p className="text-xs text-muted-foreground">Shopify will ask you to approve read-only access to products.</p>
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50" disabled={working || discoveryTabId !== null} onClick={() => void connect()} type="button">{discoveryTabId !== null ? "Waiting for Shopify…" : pendingShop ? "Try connecting again" : "Connect Shopify"} <ExternalLink aria-hidden="true" className="ml-1 inline h-3.5 w-3.5" /></button>
                  <button aria-label="Refresh Shopify connection" className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted" onClick={() => void refresh().catch(() => undefined)} type="button"><RefreshCw aria-hidden="true" className="inline h-4 w-4" /> Check connection</button>
                  {shops.length > 0 && <button className="rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted" onClick={() => { setAdding(false); setPendingShop(null); }} type="button">Cancel</button>}
                </div>
                {discoveryTabId !== null && <p className="text-sm text-muted-foreground">Choose your store in the Shopify tab. Volt will continue when its admin page opens.</p>}
                {pendingShop && <p className="text-sm text-muted-foreground">Finish the approval in the Shopify tab. This page will update when {pendingShop} connects.</p>}
              </div>
            )}
          </div>
        )}
        <div className="mt-5 border-t border-border pt-4">
          <p className="font-medium">Open audits in</p>
          <div aria-label="Open audits in" className="mt-2 grid gap-2 sm:grid-cols-2" role="radiogroup">
            {AUDIT_MODES.map((mode) => (
              <button
                aria-checked={auditMode === mode.value}
                className={`rounded-lg border p-3 text-left transition-colors ${auditMode === mode.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted"}`}
                key={mode.value}
                onClick={() => setAuditMode(mode.value)}
                role="radio"
                type="button"
              >
                <span className="block text-sm font-medium">{mode.label}{mode.value === "sidepanel" ? " (default)" : ""}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{mode.description}</span>
              </button>
            ))}
          </div>
        </div>
        <KioskStoreSetting />
        {activeShop && hiddenProducts && (
          <div className="mt-5 border-t border-border pt-4">
            <p className="font-medium">Hidden from new tab search{shops.length > 1 && ` · ${activeShop}`}</p>
            <p className="text-sm text-muted-foreground">Use the hide button on a Shopify search result to keep it out of new tab results.</p>
            {hiddenProducts.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No hidden products.</p> : (
              <ul className="mt-3 divide-y divide-border rounded-md border border-border">
                {hiddenProducts.map((product) => (
                  <li className="flex items-center justify-between gap-3 px-3 py-2" key={product.id}>
                    <span className="truncate text-sm" title={product.title}>{product.title}</span>
                    <button className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted" onClick={() => void unhide(product)} type="button"><Eye aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />Show in results</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {shownError && <div className="mt-3 text-sm text-destructive" role="alert">{shownError} {shownError.toLowerCase().includes("sign in") && <button className="underline" onClick={() => void chrome.tabs.create({ url: CLERK_SIGN_IN_URL })} type="button">Sign in to Volt</button>}</div>}
      </div>
    </section>
  );
}
