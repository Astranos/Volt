import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, RefreshCw, Search } from "lucide-react";
import {
  getShopStatus,
  getYesterday,
  localYesterday,
  searchProducts,
  type AuditProduct,
  type SearchProduct,
} from "./client";

type LoadState<T> =
  | { kind: "loading" }
  | { kind: "ready"; value: T }
  | { kind: "error"; message: string };

type SearchState =
  | { kind: "idle" }
  | LoadState<{ query: string; products: SearchProduct[] }>;

type AuditState = LoadState<AuditProduct[]> | { kind: "unavailable" };

const panelClass = "rounded-2xl border border-zinc-200 bg-white shadow-sm";
const actionClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400";

export function ShopifyAuditApp() {
  const [range, setRange] = useState(() => localYesterday());
  const [status, setStatus] = useState<LoadState<{ shop: string }>>({ kind: "loading" });
  const [yesterday, setYesterday] = useState<AuditState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const searchController = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    searchController.current?.abort();
    setSearch({ kind: "idle" });
    setStatus({ kind: "loading" });
    setYesterday({ kind: "loading" });

    void (async () => {
      try {
        const connected = await getShopStatus(controller.signal);
        if (controller.signal.aborted) return;
        setStatus({ kind: "ready", value: connected });
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatus({ kind: "error", message: errorMessage(error) });
        setYesterday({ kind: "unavailable" });
        return;
      }
      try {
        const audit = await getYesterday(range, controller.signal);
        if (!controller.signal.aborted) setYesterday({ kind: "ready", value: audit.products });
      } catch (error) {
        if (!controller.signal.aborted) setYesterday({ kind: "error", message: errorMessage(error) });
      }
    })();
    return () => controller.abort();
  }, [range]);

  useEffect(() => () => searchController.current?.abort(), []);

  function onSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status.kind !== "ready") return;
    const submittedQuery = query.trim();
    if (submittedQuery.length < 2) {
      setSearch({ kind: "idle" });
      return;
    }
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setSearch({ kind: "loading" });
    void searchProducts(submittedQuery, controller.signal).then(
      value => {
        if (!controller.signal.aborted) setSearch({ kind: "ready", value: { query: submittedQuery, products: value.products } });
      },
      error => {
        if (!controller.signal.aborted) setSearch({ kind: "error", message: errorMessage(error) });
      },
    );
  }

  const dateLabel = new Date(`${range.date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-zinc-950 text-lg font-bold text-white" aria-hidden="true">V</div>
            <div>
              <p className="text-sm font-bold leading-5">Volt Resale</p>
              <p className="text-xs text-zinc-500">Shopify product audit</p>
            </div>
          </div>
          <div className="text-right text-xs text-zinc-500" aria-live="polite">
            {status.kind === "ready" ? <span>Connected to <strong className="font-semibold text-zinc-800">{status.value.shop}</strong></span> : null}
            {status.kind === "loading" ? "Checking store connection…" : null}
            {status.kind === "error" ? <span className="text-red-700">Store connection unavailable</span> : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-7 px-5 py-8 sm:px-8 sm:py-10">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Store workspace</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Product audit</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">Review the products you added yesterday, then search your store by product title.</p>
        </div>

        {status.kind === "error" ? <ErrorNotice message={status.message} /> : null}

        <section className={`${panelClass} p-5 sm:p-6`} aria-labelledby="yesterday-heading">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="yesterday-heading" className="text-xl font-semibold">Added yesterday</h2>
              <p className="mt-1 text-sm text-zinc-500">{dateLabel} · Your local time</p>
            </div>
            <button type="button" onClick={() => setRange(localYesterday())} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-zinc-300 px-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50" aria-label="Refresh product audit">
              <RefreshCw size={16} aria-hidden="true" /> Refresh
            </button>
          </div>
          <div className="mt-5" aria-live="polite">
            {yesterday.kind === "loading" ? <LoadingMessage>Loading yesterday&apos;s products…</LoadingMessage> : null}
            {yesterday.kind === "unavailable" ? <EmptyMessage>Product audit will appear when your store connection is available.</EmptyMessage> : null}
            {yesterday.kind === "error" ? <ErrorNotice message={yesterday.message} /> : null}
            {yesterday.kind === "ready" && yesterday.value.length === 0 ? (
              <EmptyMessage>No products were added yesterday. Search your store below to audit an existing product.</EmptyMessage>
            ) : null}
            {yesterday.kind === "ready" && yesterday.value.length > 0 ? (
              <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
                {yesterday.value.map(product => <AuditRow key={product.id} product={product} />)}
              </div>
            ) : null}
          </div>
        </section>

        <section className={`${panelClass} p-5 sm:p-6`} aria-labelledby="search-heading">
          <h2 id="search-heading" className="text-xl font-semibold">Find a product</h2>
          <p className="mt-1 text-sm text-zinc-500">Search by product title.</p>
          <form onSubmit={onSearch} className="mt-5 flex flex-col gap-3 sm:flex-row" role="search">
            <label htmlFor="product-query" className="sr-only">Product title</label>
            <input id="product-query" value={query} onChange={event => setQuery(event.target.value)} maxLength={120} autoComplete="off" placeholder="Product title" className="min-h-11 min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-4 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
            <button type="submit" className={actionClass} disabled={status.kind !== "ready" || search.kind === "loading" || query.trim().length < 2}>
              <Search size={16} aria-hidden="true" /> Search products
            </button>
          </form>
          <div className="mt-5" aria-live="polite">
            {search.kind === "idle" ? <EmptyMessage>Your product details will appear here.</EmptyMessage> : null}
            {search.kind === "loading" ? <LoadingMessage>Searching products…</LoadingMessage> : null}
            {search.kind === "error" ? <ErrorNotice message={search.message} /> : null}
            {search.kind === "ready" && search.value.products.length === 0 ? <EmptyMessage>No products matched “{search.value.query}”. Try a different title.</EmptyMessage> : null}
            {search.kind === "ready" && search.value.products.length > 0 ? (
              <div className="space-y-3">
                <p className="text-xs text-zinc-500">{search.value.products.length} matching {search.value.products.length === 1 ? "product" : "products"}</p>
                {search.value.products.map(product => <SearchRow key={product.id} product={product} />)}
              </div>
            ) : null}
          </div>
        </section>
      </main>
      <footer className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 pb-8 text-xs text-zinc-500 sm:px-8">
        <span>Use Volt Resale with your Shopify store session.</span>
        <nav className="flex gap-5" aria-label="Help and policies">
          <a className="hover:text-zinc-900 hover:underline" href="https://voltresale.app/privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
          <a className="hover:text-zinc-900 hover:underline" href="mailto:juanquenga@gmail.com">Support</a>
        </nav>
      </footer>
    </div>
  );
}

function AuditRow({ product }: { product: AuditProduct }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="font-semibold text-zinc-900">{product.title}</p>
        <p className="mt-1 text-xs text-zinc-500">{product.status}</p>
      </div>
      <ProductLink href={product.url} />
    </div>
  );
}

function SearchRow({ product }: { product: SearchProduct }) {
  return (
    <article className="flex flex-wrap gap-4 rounded-xl border border-zinc-200 p-4">
      {product.imageUrl ? (
        <img src={product.imageUrl} alt="" className="size-20 rounded-lg border border-zinc-100 object-cover" />
      ) : <div className="flex size-20 items-center justify-center rounded-lg bg-zinc-100 text-xs text-zinc-400">No image</div>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="font-semibold text-zinc-900">{product.title}</h3>
          <ProductLink href={product.url} />
        </div>
        <p className="mt-1 text-xs text-zinc-500">{product.status} · {product.totalInventory} in stock</p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-700">
          {product.price ? <span><strong className="font-medium">Price:</strong> {product.price} {product.currencyCode}</span> : null}
          {product.sku ? <span><strong className="font-medium">SKU:</strong> {product.sku}</span> : null}
          {product.condition ? <span><strong className="font-medium">Condition:</strong> {product.condition}</span> : null}
        </div>
      </div>
    </article>
  );
}

function ProductLink({ href }: { href: string }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline">Open product <ArrowUpRight size={15} aria-hidden="true" /></a>;
}

function EmptyMessage({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-zinc-50 px-4 py-6 text-sm text-zinc-600">{children}</p>;
}

function LoadingMessage({ children }: { children: React.ReactNode }) {
  return <p role="status" className="rounded-xl bg-zinc-50 px-4 py-6 text-sm text-zinc-600">{children}</p>;
}

function ErrorNotice({ message }: { message: string }) {
  return <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{message}</p>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please retry.";
}
