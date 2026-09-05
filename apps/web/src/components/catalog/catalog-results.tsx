import { LoaderCircle, PackageSearch } from "lucide-react";
import { catalogDate, type CatalogResult } from "../../lib/catalog";

export function CatalogMessage({
  title,
  description,
  loading = false,
}: {
  title: string;
  description?: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
      {loading ? (
        <LoaderCircle
          aria-hidden="true"
          className="mx-auto size-7 animate-spin text-emerald-600"
        />
      ) : (
        <PackageSearch
          aria-hidden="true"
          className="mx-auto size-7 text-zinc-300"
        />
      )}
      <h2 className="mt-3 text-sm font-semibold text-zinc-900">{title}</h2>
      {description ? (
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-500">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function CatalogResults({
  products,
  loading,
  selectedUpc,
  comparison,
  onSelect,
  onCompare,
  hasSearch,
  hasFilters,
  onReset,
}: {
  products: CatalogResult[];
  loading: boolean;
  selectedUpc: string | null;
  comparison: CatalogResult[];
  onSelect: (upc: string) => void;
  onCompare: (product: CatalogResult) => void;
  hasSearch: boolean;
  hasFilters: boolean;
  onReset: () => void;
}) {
  if (loading)
    return (
      <div role="status">
        <CatalogMessage title="Loading products" loading />
      </div>
    );
  if (!products.length)
    return (
      <div>
        <CatalogMessage
          title={
            hasFilters
              ? "No loaded products match these filters"
              : hasSearch
                ? "No matching products"
                : "No product data yet"
          }
          description={
            hasFilters
              ? "Clear the filters or load more results below to keep looking."
              : hasSearch
                ? "Try a shorter title, a full UPC, or an MPN."
                : "Imported product records will appear here."
          }
        />
        {hasSearch || hasFilters ? (
          <button
            type="button"
            onClick={onReset}
            className="mt-3 text-sm font-semibold text-emerald-700 underline"
          >
            Clear search and filters
          </button>
        ) : null}
      </div>
    );
  return (
    <ul className="space-y-2">
      {products.map((product) => {
        const compared = comparison.some((row) => row.upc === product.upc);
        const selected = selectedUpc === product.upc;
        return (
          <li
            key={product.upc}
            className={`overflow-hidden rounded-xl border bg-white ${selected ? "border-emerald-500 ring-1 ring-emerald-500/20" : "border-zinc-200"}`}
          >
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(product.upc)}
              className="block w-full p-4 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
            >
              <span className="block text-sm font-semibold leading-6 text-zinc-950">
                {product.title}
              </span>
              <span className="mt-1 block text-xs leading-5 text-zinc-500">
                {[
                  product.brand,
                  product.model,
                  product.storage,
                  product.color,
                  product.platform,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Specifications not provided"}
              </span>
              <span className="mt-2 block break-all font-mono text-xs text-zinc-600">
                UPC {product.upc}
                {product.mpn ? ` · MPN ${product.mpn}` : ""}
              </span>
            </button>
            <div className="flex items-center justify-between gap-3 border-t border-zinc-100 px-4 py-2">
              <span className="text-[0.68rem] text-zinc-400">
                Updated {catalogDate(product.updatedAt)}
              </span>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-zinc-600">
                <input
                  type="checkbox"
                  checked={compared}
                  disabled={!compared && comparison.length >= 3}
                  onChange={() => onCompare(product)}
                  aria-label={`Compare ${product.title}`}
                  className="size-4 accent-emerald-600"
                />
                Compare
              </label>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
