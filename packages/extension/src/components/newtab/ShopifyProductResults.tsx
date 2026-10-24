import { useState } from "react";
import { Command } from "cmdk";
import { ArrowUpRight, Boxes, Columns3, EyeOff, PackageSearch, RefreshCw, Store, X } from "lucide-react";
import type { ShopifySearchProduct, ShopifySearchResult } from "../../shopify-audit/client";
import {
  applyShopifyResultFilters,
  conditionOptions,
  DEFAULT_SHOPIFY_RESULT_FILTERS,
  type ShopifyResultFilters,
  type ShopifyResultSort,
} from "./shopify-result-filters";
import "./shopify-product-results.css";

// cmdk moves its selection on arrow keys; keep those inside the filter controls.
const keepKeys = (event: React.KeyboardEvent) => event.stopPropagation();

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
  onHideProduct,
  compareIds,
  compareFull,
  onToggleCompare,
  onRetry,
  onOpenSettings,
}: {
  query: string;
  state: ShopifyProductSearchState;
  onOpenProduct: (url: string) => void;
  onHideProduct: (product: ShopifySearchProduct) => void;
  compareIds: ReadonlySet<string>;
  compareFull: boolean;
  onToggleCompare: (product: ShopifySearchProduct) => void;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  // Kept while mounted, so filters survive a new search.
  const [filters, setFilters] = useState<ShopifyResultFilters>(DEFAULT_SHOPIFY_RESULT_FILTERS);
  // Once something is picked to compare, clicking a card adds or removes it.
  const compareMode = compareIds.size > 0;

  if (query.trim().length < 2) {
    return <div className="shopify-search-intro">
      <span className="shopify-search-intro-icon"><Store aria-hidden="true" size={22} /></span>
      <strong>Search your Shopify products</strong>
      <span>Find products by title, SKU, or barcode. In-stock items appear first. Pick a few with <Columns3 aria-hidden="true" className="shopify-search-intro-inline-icon" size={12} /> to compare them side by side.</span>
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
  const conditions = conditionOptions(products);
  // A condition from an earlier search that isn't in these results would hide everything.
  const active = { ...filters, condition: filters.condition && conditions.includes(filters.condition) ? filters.condition : null };
  const shown = applyShopifyResultFilters(products, active);
  const filtered = active.inStockOnly || active.condition !== null;
  const fullSearchUrl = `https://${shop}/admin/products?query=${encodeURIComponent(query)}`;

  return <div className="shopify-results">
    <div className="shopify-results-heading">
      <span>{filtered ? `${shown.length} of ${products.length}` : products.length} {products.length === 1 ? "product" : "products"}</span>
      {products.length > 0 && <div className="shopify-results-filters" onKeyDown={keepKeys}>
        <button
          aria-pressed={active.inStockOnly}
          className="shopify-filter-chip"
          onClick={() => setFilters({ ...active, inStockOnly: !active.inStockOnly })}
          type="button"
        >In stock</button>
        {conditions.length > 0 && <select
          aria-label="Condition"
          className="shopify-filter-select"
          onChange={(event) => setFilters({ ...active, condition: event.target.value || null })}
          value={active.condition ?? ""}
        >
          <option value="">Any condition</option>
          {conditions.map((condition) => <option key={condition} value={condition}>{condition}</option>)}
        </select>}
        <select
          aria-label="Sort"
          className="shopify-filter-select"
          onChange={(event) => setFilters({ ...active, sort: event.target.value as ShopifyResultSort })}
          value={active.sort}
        >
          <option value="relevance">In stock first</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
        </select>
      </div>}
    </div>
    {compareMode && <p className="shopify-compare-hint">Compare mode: click products to add or remove them.</p>}
    {products.length === 0 ? <div className="shopify-search-message">
      <PackageSearch aria-hidden="true" size={24} />
      <strong>No matching products</strong>
      <span>Try a different title, SKU, or barcode.</span>
    </div> : shown.length === 0 ? <div className="shopify-search-message">
      <PackageSearch aria-hidden="true" size={24} />
      <strong>No products match these filters</strong>
      <div className="shopify-search-message-actions">
        <button onClick={() => setFilters(DEFAULT_SHOPIFY_RESULT_FILTERS)} type="button">Clear filters</button>
      </div>
    </div> : <div className="shopify-results-grid">
      {shown.map((product) => {
        const price = formatPrice(product);
        const comparing = compareIds.has(product.id);
        const canToggle = comparing || !compareFull;
        return <Command.Item
          aria-label={compareMode
            ? comparing ? `Remove ${product.title} from compare` : canToggle ? `Add ${product.title} to compare` : `${product.title} (compare is full)`
            : `Open ${product.title} in Shopify`}
          className={[
            "shopify-product-card",
            comparing && "is-comparing",
            compareMode && "is-compare-mode",
            compareMode && !canToggle && "is-compare-full",
          ].filter(Boolean).join(" ")}
          key={product.id}
          onSelect={() => {
            if (!compareMode) onOpenProduct(product.url);
            else if (canToggle) onToggleCompare(product);
          }}
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
          <span className="shopify-product-actions">
            <button
              aria-label={comparing ? `Remove ${product.title} from compare` : `Add ${product.title} to compare`}
              aria-pressed={comparing}
              className="shopify-product-compare"
              data-tooltip={comparing ? "Remove from compare" : compareFull ? "Compare is full (8 max)" : "Add to compare"}
              disabled={!comparing && compareFull}
              onClick={(event) => { event.stopPropagation(); onToggleCompare(product); }}
              onKeyDown={(event) => { if (event.key === "Enter") event.stopPropagation(); }}
              type="button"
            >
              <Columns3 aria-hidden="true" size={14} />
            </button>
            <button
              aria-label={`Hide ${product.title} from results`}
              className="shopify-product-hide"
              data-tooltip="Hide from search results"
              onClick={(event) => { event.stopPropagation(); onHideProduct(product); }}
              onKeyDown={(event) => { if (event.key === "Enter") event.stopPropagation(); }}
              type="button"
            >
              <EyeOff aria-hidden="true" size={14} />
            </button>
            {compareMode ? <button
              aria-label={`Open ${product.title} in Shopify`}
              className="shopify-product-open-button"
              data-tooltip="Open in Shopify"
              onClick={(event) => { event.stopPropagation(); onOpenProduct(product.url); }}
              onKeyDown={(event) => { if (event.key === "Enter") event.stopPropagation(); }}
              type="button"
            >
              <ArrowUpRight aria-hidden="true" size={16} />
            </button> : <ArrowUpRight aria-hidden="true" className="shopify-product-open" size={16} />}
          </span>
        </Command.Item>;
      })}
    </div>}
    <a className="shopify-results-view-all" href={fullSearchUrl} rel="noopener noreferrer" target="_blank">
      View all matches in Shopify <ArrowUpRight aria-hidden="true" size={14} />
    </a>
  </div>;
}

/** Picked products waiting to be compared; stays put while the user searches again. */
export function ShopifyCompareTray({
  products,
  onRemove,
  onClear,
  onCompare,
}: {
  products: ShopifySearchProduct[];
  onRemove: (product: ShopifySearchProduct) => void;
  onClear: () => void;
  onCompare: () => void;
}) {
  return <div className="shopify-compare-tray" role="region" aria-label="Products to compare">
    <ul className="shopify-compare-tray-items">
      {products.map((product) => <li key={product.id} title={product.title}>
        <span className="shopify-compare-tray-thumb">
          <Boxes aria-hidden="true" size={14} />
          {product.imageUrl && <img alt="" src={product.imageUrl} />}
        </span>
        <span className="shopify-compare-tray-title">{product.title}</span>
        <button aria-label={`Remove ${product.title} from compare`} onClick={() => onRemove(product)} type="button"><X aria-hidden="true" size={12} /></button>
      </li>)}
    </ul>
    <div className="shopify-compare-tray-actions">
      <button className="shopify-compare-tray-clear" onClick={onClear} title="Clear and leave compare mode" type="button">Clear</button>
      <button
        className="shopify-compare-tray-open"
        disabled={products.length < 2}
        onClick={onCompare}
        title={products.length < 2 ? "Pick at least 2 products" : "Open the comparison in a new tab"}
        type="button"
      >
        <Columns3 aria-hidden="true" size={14} /> Compare {products.length}
      </button>
    </div>
  </div>;
}
