import { Button } from "@base-ui/react/button";
import { Input } from "@base-ui/react/input";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
  ArrowRight,
  Camera,
  Gamepad2,
  Headphones,
  LayoutGrid,
  Laptop,
  MapPin,
  Package,
  RotateCcw,
  Search,
  Smartphone,
  Tablet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Category, Product } from "./catalog";
import {
  browseProducts,
  initialFilters,
  routeSlug,
  type BrowseFilters,
} from "./browse";
import { ProductCard } from "./components/ProductCard";
import { ProductDetail } from "./components/ProductDetail";
import { StoreChooser } from './components/StoreChooser';
import { RequestsPage } from './components/RequestsPage';
import { useCatalog } from "./hooks/useCatalog";
import { useIdleReset } from "./hooks/useIdleReset";

const categories: { name: Category | "All"; icon: typeof Search }[] = [
  { name: "All", icon: LayoutGrid },
  { name: "Phones", icon: Smartphone },
  { name: "Computers", icon: Laptop },
  { name: "Tablets", icon: Tablet },
  { name: "Gaming", icon: Gamepad2 },
  { name: "Audio", icon: Headphones },
  { name: "Cameras", icon: Camera },
  { name: "Other", icon: Package },
];
function Wordmark() {
  return (
    <img className="wordmark" src="/paymore-logo.png" alt="PayMore" width="156" height="50" />
  );
}
function Browse({ slug }: { slug: string }) {
  const { state, refresh } = useCatalog(slug);
  const [filters, setFilters] = useState<BrowseFilters>(initialFilters);
  const [limit, setLimit] = useState(24);
  const [selected, setSelected] = useState<Product | null>(null);
  const [visitorId, setVisitorId] = useState(() => crypto.randomUUID());
  const [clock, setClock] = useState(Date.now());
  const reset = () => {
    setFilters(initialFilters);
    setLimit(24);
    setSelected(null);
    setVisitorId(crypto.randomUUID());
    refresh();
    window.scrollTo({ top: 0 });
  };
  const { remaining, keepBrowsing } = useIdleReset(reset);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const now = Math.max(clock, Date.now());
  const catalog = state.kind === "ready" ? state.catalog : null;
  const expired = !!catalog && now - Date.parse(catalog.checkedAt) > 300_000;
  const stale =
    state.kind === "ready" &&
    (state.failed || state.catalog.status === "stale");
  const products = useMemo(
    () => (catalog ? browseProducts(catalog.products, filters) : []),
    [catalog, filters],
  );
  const update = (patch: Partial<BrowseFilters>) => {
    setFilters((value) => ({ ...value, ...patch }));
    setLimit(24);
    setClock(Date.now());
  };
  const selectedLatest =
    selected && catalog?.products.find((product) => product.id === selected.id);
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Wordmark />
          <div className="store-location">
            <MapPin size={17} />
            <span>
              {catalog
                ? [catalog.store.name, catalog.store.region].filter(Boolean).join(', ')
                : "In-store browsing"}
            </span>
          </div>
          <Button className="button reset-button" aria-label="Start over" onClick={reset}>
            <RotateCcw size={18} />
            <span>Start over</span>
          </Button>
        </div>
      </header>
      <main className="catalog-main">
        <div className="page-heading">
          <div>
            <h1>Browse products</h1>
          </div>
        </div>
        <div className="search-box">
          <Search size={24} />
          <label className="sr-only" htmlFor="search">
            Search this store
          </label>
          <Input
            id="search"
            placeholder="What are you looking for?"
            value={filters.query}
            onChange={(event) => update({ query: event.target.value })}
            autoComplete="off"
          />
          {filters.query && (
            <Button
              aria-label="Clear search"
              className="clear-search"
              onClick={() => update({ query: "" })}
            >
              <X size={22} />
            </Button>
          )}
        </div>
        <nav className="categories" aria-label="Product categories">
          {categories.map(({ name, icon: Icon }) => (
            <Button
              key={name}
              className={`category-button ${filters.category === name ? "active" : ""}`}
              aria-pressed={filters.category === name}
              onClick={() => update({ category: name })}
            >
              <Icon size={22} />
              <span>{name === "All" ? "All products" : name}</span>
            </Button>
          ))}
        </nav>
        <div className="results-toolbar">
          <div>
            <h2>
              {filters.category === "All" ? "All products" : filters.category}
            </h2>
            <span className="result-count" aria-live="polite">
              {catalog && !expired
                ? `${products.length} items`
                : ""}
            </span>
          </div>
          <div className="select-controls">
            <label>
              <span className="sr-only">Budget</span>
              <select
                aria-label="Budget"
                value={filters.budget}
                onChange={(event) =>
                  update({ budget: Number(event.target.value) })
                }
              >
                <option value="0">Any budget</option>
                <option value="5000">$50 or less</option>
                <option value="10000">$100 or less</option>
                <option value="25000">$250 or less</option>
                <option value="50000">$500 or less</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Sort products</span>
              <select
                aria-label="Sort products"
                value={filters.sort}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === "newest" || value === "low" || value === "high")
                    update({ sort: value });
                }}
              >
                <option value="newest">Newest first</option>
                <option value="low">Price: low to high</option>
                <option value="high">Price: high to low</option>
              </select>
            </label>
          </div>
        </div>
        {stale && !expired && (
          <p className="notice" role="status">
            We're reconnecting. These are recently listed items; ask an
            associate to confirm availability.
          </p>
        )}
        {state.kind === "loading" ? (
          <div className="loading-state" role="status">
            <span className="loading-dot" /> Loading products…
          </div>
        ) : state.kind === "error" || expired ? (
          <section className="empty-state" role="alert">
            <Package size={36} />
            <h2>
              {state.kind === "error" && state.unknownStore
                ? "Store not found"
                : "Products are temporarily unavailable."}
            </h2>
            <p>
              {state.kind === "error" && state.unknownStore
                ? "Please ask an associate to check this tablet’s store address."
                : "Please ask an associate for help, or try connecting again."}
            </p>
            <Button className="button primary" onClick={refresh}>
              Try again
            </Button>
          </section>
        ) : products.length === 0 ? (
          <section className="empty-state">
            <Search size={36} />
            <h2>
              {catalog?.products.length
                ? "No matching products."
                : "No items are listed right now."}
            </h2>
            <p>
              {catalog?.products.length
                ? "Try a different search or a wider budget. An associate can help, too."
                : "Ask an associate what’s available in the store."}
            </p>
            <Button
              className="button primary"
              onClick={() => update(initialFilters)}
            >
              See all items
            </Button>
          </section>
        ) : (
          <>
            <div className="product-grid">
              {products.slice(0, limit).map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onOpen={() => setSelected(product)}
                />
              ))}
            </div>
            {products.length > limit && (
              <div className="load-more">
                <Button
                  className="button secondary"
                  onClick={() => setLimit((value) => value + 24)}
                >
                  Show more products <ArrowRight size={19} />
                </Button>
                <p>
                  Showing {Math.min(limit, products.length)} of{" "}
                  {products.length}
                </p>
              </div>
            )}
          </>
        )}
        <footer className="catalog-footer">
          <span>
            <strong>Ask an associate for help with an item.</strong>
          </span>
          <span>
            {catalog && !expired
              ? `Updated ${new Date(catalog.checkedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
              : "Made for browsing in store"}
          </span>
        </footer>
      </main>
      {selected && (
        <ProductDetail
          key={selected.id}
          product={selectedLatest || selected}
          storeSlug={slug}
          visitorId={visitorId}
          available={!!selectedLatest && !expired && !stale}
          onClose={() => setSelected(null)}
        />
      )}
      {remaining !== null && (
        <AlertDialog.Root open onOpenChange={(open) => { if (!open) keepBrowsing(); }}>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className="idle-backdrop" />
            <AlertDialog.Popup className="idle-notice">
              <div>
                <AlertDialog.Title>Still looking?</AlertDialog.Title>
                <AlertDialog.Description>Starting fresh in {remaining} seconds.</AlertDialog.Description>
              </div>
              <Button className="button primary" onClick={keepBrowsing}>Keep browsing</Button>
            </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      )}
    </>
  );
}
export default function App() {
  const path = window.location.pathname;
  const requestPath = /^(\/[^/]+)\/requests\/?$/.exec(path);
  const requestSlug = requestPath?.[1] ? routeSlug(requestPath[1]) : null;
  if (requestSlug) return <RequestsPage key={requestSlug} slug={requestSlug} />;
  const slug = routeSlug(path);
  if (slug) return <Browse slug={slug} />;
  return (
    <main className="store-chooser">
      <Wordmark />
      <h1>{path === "/" ? "Choose your store" : "Store not found."}</h1>
      <p>
        {path === "/"
          ? "Browse products at your local PayMore."
          : "Please ask an associate to check this tablet’s address."}
      </p>
      {path === "/" && <StoreChooser />}
    </main>
  );
}
