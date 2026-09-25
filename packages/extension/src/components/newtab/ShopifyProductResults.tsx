import { Command } from "cmdk";
import { ArrowUpRight, Boxes, PackageSearch, RefreshCw, Store } from "lucide-react";
import type { ShopifySearchProduct, ShopifySearchResult } from "../../shopify-audit/client";
import "./shopify-product-results.css";

export type ShopifyProductSearchState =
  | { kind: "idle" }
  | { kind: "loading"; query: string }
  | { kind: "ready"; query: string; result: ShopifySearchResult }
  | { kind: "error"; query: string; message: string };

function formatPrice(product: ShopifySearchProduct): string | null {
  if (!product.price) return null;
  if (!product.currencyCode) return product.price;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: product.currencyCode,
    }).format(Number(product.price));
  } catch {
    return `${product.currencyCode} ${product.price}`;
  }
}

export function ShopifyProductResults({
  query,
  state,
  onOpenProduct,
  onRetry,
  onOpenSettings,
}: {
  query: string;
  state: ShopifyProductSearchState;
  onOpenProduct: (url: string) => void;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  if (query.trim().length < 2) {
    return <div className="shopify-search-intro">
      <span className="shopify-search-intro-icon"><Store aria-hidden="true" size={22} /></span>
      <strong>Search your Shopify products</strong>
      <span>Find products by title, SKU, or barcode. In-stock items appear first.</span>
    </div>;
  }

  if (state.kind === "error" && state.query === query) {
    return <div className="shopify-search-message" role="alert">
      <strong>Couldn’t load Shopify products</strong>
      <span>{state.message}</span>
      <div className="shopify-search-message-actions">
        <button onClick={onRetry} type="button"><RefreshCw aria-hidden="true" size={14} /> Try again</button>
        <button onClick={onOpenSettings} type="button">Shopify settings <ArrowUpRight aria-hidden="true" size={14} /></button>
      </div>
    </div>;
  }

  if (state.kind !== "ready" || state.query !== query) {
    return <div className="shopify-results" aria-label="Loading Shopify products">
      <div className="shopify-results-heading"><span>Searching Shopify…</span></div>
      <div className="shopify-results-grid" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => <div className="shopify-product-skeleton" key={index}><span /><span /></div>)}
      </div>
    </div>;
  }

  const { products, shop } = state.result;
  const inStockCount = products.filter((product) => product.totalInventory > 0).length;
  const fullSearchUrl = `https://${shop}/admin/products?query=${encodeURIComponent(query)}`;

  return <div className="shopify-results">
    <div className="shopify-results-heading">
      <span>{products.length} {products.length === 1 ? "product" : "products"}</span>
      <span className="shopify-results-stock-first">{inStockCount} in stock · shown first</span>
    </div>
    {products.length === 0 ? <div className="shopify-search-message">
      <PackageSearch aria-hidden="true" size={24} />
      <strong>No matching products</strong>
      <span>Try a different title, SKU, or barcode.</span>
    </div> : <div className="shopify-results-grid">
      {products.map((product) => {
        const price = formatPrice(product);
        return <Command.Item
          aria-label={`Open ${product.title} in Shopify`}
          className="shopify-product-card"
          key={product.id}
          onSelect={() => onOpenProduct(product.url)}
          value={`shopify-product-${product.id}`}
        >
          <span className="shopify-product-image">
            <Boxes aria-hidden="true" size={22} />
            {product.imageUrl && <img alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} src={product.imageUrl} />}
          </span>
          <span className="shopify-product-body">
            <span className="shopify-product-title" title={product.title}>{product.title}</span>
            <span className="shopify-product-details">
              {product.sku && <span className="shopify-product-sku" title={`SKU ${product.sku}`}>SKU {product.sku}</span>}
              {price && <span className="shopify-product-price">From {price}</span>}
            </span>
            <span className="shopify-product-badges">
              <span className={product.totalInventory > 0 ? "shopify-product-stock is-available" : "shopify-product-stock"}>
                {product.totalInventory > 0 ? `${product.totalInventory} in stock` : "Out of stock"}
              </span>
              <span className="shopify-product-status">{product.status.toLowerCase()}</span>
              {product.condition && <span className="shopify-product-condition" title={product.condition}>{product.condition}</span>}
            </span>
          </span>
          <ArrowUpRight aria-hidden="true" className="shopify-product-open" size={16} />
        </Command.Item>;
      })}
    </div>}
    <a className="shopify-results-view-all" href={fullSearchUrl} rel="noopener noreferrer" target="_blank">
      View all matches in Shopify <ArrowUpRight aria-hidden="true" size={14} />
    </a>
  </div>;
}
