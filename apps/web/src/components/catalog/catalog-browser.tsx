import {
  Component,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { Download, Search, X } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import {
  catalogCsv,
  catalogFilterOptions,
  filterCatalogResults,
  type CatalogProduct,
  type CatalogResult,
  type CatalogFilters,
} from "../../lib/catalog";
import { ProductDetail } from "./product-detail";
import { CatalogCompare, toggleComparison } from "./catalog-compare";
import { CatalogResults, CatalogMessage } from "./catalog-results";

type CatalogStatus =
  "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
export type CatalogContentProps = {
  products: CatalogResult[];
  status: CatalogStatus;
  searchQuery: string;
  onSearch: (query: string) => void;
  selectedUpc: string | null;
  onSelect: (upc: string) => void;
  product: CatalogProduct | null | undefined;
  onLoadMore: () => void;
};
const controlClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50";

export function CatalogBrowser() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [attempt, setAttempt] = useState(0);
  if (isLoading)
    return <CatalogMessage title="Connecting to product data" loading />;
  if (!isAuthenticated)
    return (
      <CatalogMessage
        title="Sign in to browse product data"
        description="Your session may have expired. Sign in again to continue."
      />
    );
  return (
    <CatalogErrorBoundary
      key={attempt}
      retry={() => setAttempt((value) => value + 1)}
    >
      <ConnectedCatalog />
    </CatalogErrorBoundary>
  );
}

function ConnectedCatalog() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUpc, setSelectedUpc] = useState<string | null>(null);
  const search = useCallback(
    (query: string) => {
      if (query === searchQuery) return;
      setSearchQuery(query);
      setSelectedUpc(null);
    },
    [searchQuery],
  );
  const products = usePaginatedQuery(
    api.productData.searchProducts,
    searchQuery ? { searchQuery } : {},
    { initialNumItems: 25 },
  );
  const product = useQuery(
    api.productData.getProductByUpc,
    selectedUpc ? { upc: selectedUpc } : "skip",
  );
  return (
    <CatalogContent
      products={products.results}
      status={products.status}
      searchQuery={searchQuery}
      onSearch={search}
      selectedUpc={selectedUpc}
      onSelect={setSelectedUpc}
      product={product}
      onLoadMore={() => products.loadMore(25)}
    />
  );
}

export function CatalogContent({
  products,
  status,
  searchQuery,
  onSearch,
  selectedUpc,
  onSelect,
  product,
  onLoadMore,
}: CatalogContentProps) {
  const [input, setInput] = useState(searchQuery);
  const [filters, setFilters] = useState<CatalogFilters>({
    brand: "",
    platform: "",
    sort: "relevance",
  });
  const [comparison, setComparison] = useState<CatalogResult[]>([]);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState("");
  useEffect(() => {
    if (input.trim() === searchQuery) return;
    const timer = window.setTimeout(() => onSearch(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input, searchQuery, onSearch]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileDetail(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  const visible = filterCatalogResults(products, filters);
  const options = catalogFilterOptions(products);
  const pending = input.trim() !== searchQuery;
  const loading = status === "LoadingFirstPage" || pending;
  const canLoadMore = status === "CanLoadMore" || status === "LoadingMore";
  const hasFilters = Boolean(filters.brand || filters.platform);

  function reset() {
    setInput("");
    onSearch("");
    setFilters({ brand: "", platform: "", sort: "relevance" });
  }
  function select(upc: string) {
    onSelect(upc);
    if (window.matchMedia("(max-width: 1023px)").matches) setMobileDetail(true);
  }
  function exportRows() {
    try {
      const url = URL.createObjectURL(
        new Blob([catalogCsv(visible)], { type: "text/csv;charset=utf-8;" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "volt-catalog.csv";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadStatus(
        `Exported ${visible.length} loaded ${visible.length === 1 ? "product" : "products"}.`,
      );
    } catch {
      setDownloadStatus("The CSV could not be downloaded. Try again.");
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
            Product catalog
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Identify products, compare specifications, and inspect source
            records.
          </p>
        </div>
        <button
          type="button"
          disabled={loading || visible.length === 0}
          onClick={exportRows}
          className={`${controlClass} inline-flex items-center gap-2`}
        >
          <Download className="size-4" aria-hidden="true" />
          Export loaded rows
        </button>
      </header>
      <section
        aria-label="Catalog search and filters"
        className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4"
      >
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            onSearch(input.trim());
          }}
          className="flex gap-2"
        >
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-3 size-5 text-zinc-400"
            />
            <label htmlFor="catalog-search" className="sr-only">
              Search by title, UPC, or MPN
            </label>
            <input
              id="catalog-search"
              type="search"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Search title, UPC, or MPN"
              autoComplete="off"
              spellCheck={false}
              className={`${controlClass} h-11 w-full pl-10`}
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            Search
          </button>
        </form>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-32 flex-1 gap-1 text-xs font-medium text-zinc-500">
            Brand
            <select
              value={filters.brand}
              onChange={(event) =>
                setFilters({ ...filters, brand: event.target.value })
              }
              className={controlClass}
            >
              <option value="">All brands</option>
              {filters.brand && !options.brands.includes(filters.brand) ? (
                <option value={filters.brand}>{filters.brand}</option>
              ) : null}
              {options.brands.map((brand) => (
                <option key={brand} value={brand}>
                  {brand}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-32 flex-1 gap-1 text-xs font-medium text-zinc-500">
            Platform
            <select
              value={filters.platform}
              onChange={(event) =>
                setFilters({ ...filters, platform: event.target.value })
              }
              className={controlClass}
            >
              <option value="">All platforms</option>
              {filters.platform &&
              !options.platforms.includes(filters.platform) ? (
                <option value={filters.platform}>{filters.platform}</option>
              ) : null}
              {options.platforms.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-32 flex-1 gap-1 text-xs font-medium text-zinc-500">
            Sort loaded rows
            <select
              value={filters.sort}
              onChange={(event) => {
                const sort = event.target.value;
                if (
                  sort === "relevance" ||
                  sort === "title" ||
                  sort === "updated"
                )
                  setFilters({ ...filters, sort });
              }}
              className={controlClass}
            >
              <option value="relevance">Search order</option>
              <option value="title">Title A–Z</option>
              <option value="updated">Recently updated</option>
            </select>
          </label>
          <button
            type="button"
            onClick={reset}
            disabled={!input && !hasFilters && filters.sort === "relevance"}
            className={controlClass}
          >
            Reset
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          Search covers the catalog. Filters, sorting, and export apply only to
          loaded results. Catalog records do not indicate price or stock.
        </p>
      </section>
      <p role="status" className="text-xs text-zinc-500">
        {loading
          ? "Searching product data…"
          : `${visible.length} shown of ${products.length} loaded${canLoadMore ? ". More results available." : "."}`}
      </p>
      {downloadStatus ? (
        <p role="status" className="text-xs text-emerald-700">
          {downloadStatus}
        </p>
      ) : null}
      {comparison.length > 0 ? (
        <CatalogCompare
          products={comparison}
          onRemove={(upc) =>
            setComparison((rows) => rows.filter((row) => row.upc !== upc))
          }
          onClear={() => setComparison([])}
        />
      ) : null}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)]">
        <section
          aria-label="Product data results"
          aria-busy={loading}
          className="min-w-0 space-y-3"
        >
          <CatalogResults
            products={visible}
            loading={loading}
            selectedUpc={selectedUpc}
            comparison={comparison}
            onSelect={select}
            onCompare={(row) =>
              setComparison((rows) => toggleComparison(rows, row))
            }
            hasSearch={Boolean(searchQuery)}
            hasFilters={hasFilters}
            onReset={reset}
          />
          {canLoadMore ? (
            <button
              type="button"
              disabled={status === "LoadingMore" || loading}
              onClick={onLoadMore}
              className={`${controlClass} w-full font-semibold`}
            >
              {status === "LoadingMore"
                ? "Loading products…"
                : "Load 25 more products"}
            </button>
          ) : null}
        </section>
        <section
          aria-label="Selected product"
          className="hidden min-w-0 lg:sticky lg:top-24 lg:block"
        >
          {selectedUpc ? (
            <ProductDetail key={selectedUpc} product={product} />
          ) : (
            <CatalogMessage
              title="Select a product"
              description="Open a result to see identifiers, specifications, images, and source records. Compare up to three products across searches."
            />
          )}
        </section>
      </div>
      <Dialog.Root open={mobileDetail} onOpenChange={setMobileDetail}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-zinc-950/50" />
          <Dialog.Popup className="fixed inset-x-2 bottom-2 top-12 z-50 overflow-y-auto rounded-2xl bg-zinc-50 p-3 shadow-xl sm:inset-x-[10%]">
            <div className="sticky top-0 z-10 mb-3 flex items-center justify-between rounded-lg bg-zinc-50 p-2">
              <Dialog.Title className="text-sm font-semibold">
                Product details
              </Dialog.Title>
              <Dialog.Close
                aria-label="Close product details"
                className={controlClass}
              >
                <X className="size-4" aria-hidden="true" />
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Identifiers, specifications, images, and source records for the
              selected product.
            </Dialog.Description>
            <ProductDetail key={selectedUpc} product={product} />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

export function CatalogError({ retry }: { retry: () => void }) {
  return (
    <div role="alert">
      <CatalogMessage
        title="Product data couldn't load"
        description="Check your connection and try again. If your session expired, sign in again."
      />
      <button type="button" onClick={retry} className={`${controlClass} mt-3`}>
        Try again
      </button>
    </div>
  );
}

export class CatalogErrorBoundary extends Component<
  { children: ReactNode; retry: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <CatalogError retry={this.props.retry} />
    ) : (
      this.props.children
    );
  }
}
