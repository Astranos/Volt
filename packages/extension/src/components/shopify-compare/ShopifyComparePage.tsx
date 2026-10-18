import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowUpRight, Columns3, RefreshCw } from "lucide-react";
import { getShopifyProductDetails, type ShopifyProductDetails } from "../../shopify-audit/client";
import { compareProductIds, shopifyComparePath } from "../../shopify-compare/compare-url";
import { parseListingHtml } from "../../shopify-compare/listing";
import { CompareColumn } from "./CompareColumn";
import "./shopify-compare.css";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; products: ShopifyProductDetails[] }
  | { kind: "error"; message: string };

export function ShopifyComparePage() {
  const [ids, setIds] = useState(() => compareProductIds(window.location.search));
  const [requestedIds] = useState(ids);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    document.title = "Compare · Volt";
  }, []);

  useEffect(() => {
    if (!requestedIds.length) return;
    let canceled = false;
    setState({ kind: "loading" });
    getShopifyProductDetails(requestedIds)
      .then((result) => { if (!canceled) setState({ kind: "ready", products: result.products }); })
      .catch((cause: unknown) => {
        if (!canceled) setState({ kind: "error", message: cause instanceof Error ? cause.message : "Could not load Shopify products." });
      });
    return () => { canceled = true; };
  }, [requestedIds, retry]);

  const products = state.kind === "ready" ? state.products.filter((product) => ids.includes(product.id)) : [];
  const details = useMemo(
    () => new Map(state.kind === "ready" ? state.products.map((product) => [product.id, parseListingHtml(product.descriptionHtml, product.title)]) : []),
    [state],
  );
  const missing = state.kind === "ready" ? requestedIds.length - state.products.length : 0;

  const remove = (id: string) => {
    const next = ids.filter((value) => value !== id);
    setIds(next);
    window.history.replaceState(null, "", shopifyComparePath(next));
  };

  const columnCount = state.kind === "ready" ? products.length : requestedIds.length;

  return (
    <div className="compare-root">
      <header className="compare-header">
        <div className="compare-header-brand">
          <img alt="" src="/assets/icons/logo.png" />
          <div>
            <h1>Compare products</h1>
            <p>{columnCount} {columnCount === 1 ? "item" : "items"} side by side</p>
          </div>
        </div>
        {missing > 0 && <p className="compare-notice" role="status">{missing} {missing === 1 ? "product is" : "products are"} no longer in Shopify.</p>}
      </header>

      {!requestedIds.length || (state.kind === "ready" && !products.length) ? (
        <div className="compare-message">
          <Columns3 aria-hidden="true" size={28} />
          <strong>Nothing to compare</strong>
          <span>Search Shopify on the new tab and pick products with the compare button.</span>
        </div>
      ) : state.kind === "error" ? (
        <div className="compare-message" role="alert">
          <strong>Couldn’t load Shopify products</strong>
          <span>{state.message}</span>
          <div className="compare-message-actions">
            <button onClick={() => setRetry((value) => value + 1)} type="button"><RefreshCw aria-hidden="true" size={14} /> Try again</button>
            <a href="/options.html#shopify-audit">Shopify settings <ArrowUpRight aria-hidden="true" size={14} /></a>
          </div>
        </div>
      ) : (
        <main
          aria-busy={state.kind === "loading"}
          className="compare-grid"
          style={{ "--compare-columns": columnCount } as CSSProperties}
        >
          {state.kind === "loading"
            ? requestedIds.map((id) => (
              <div className="compare-column compare-column-skeleton" key={id} aria-hidden="true">
                <span /><span /><span /><span /><span /><span />
              </div>
            ))
            : products.map((product) => (
              <CompareColumn details={details.get(product.id) ?? []} key={product.id} onRemove={() => remove(product.id)} product={product} />
            ))}
        </main>
      )}
    </div>
  );
}
