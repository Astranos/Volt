import { useEffect, useRef, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { usePaginatedQuery, useQuery } from "convex/react";
import {
  ArrowUpRight,
  Barcode,
  Boxes,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  ImageOff,
  LoaderCircle,
  PackageSearch,
  Search,
  Store,
  X,
} from "lucide-react";

import { api } from "../../../../../convex/_generated/api";

type CatalogSearchResult =
  FunctionReturnType<typeof api.paymoreCatalog.searchCatalog>["page"][number];
type CatalogProduct = NonNullable<
  FunctionReturnType<typeof api.paymoreCatalog.getByUpc>
>;
type CatalogListing = CatalogProduct["listings"][number];

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function CatalogBrowser() {
  const [input, setInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUpc, setSelectedUpc] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  const catalog = usePaginatedQuery(
    api.paymoreCatalog.searchCatalog,
    { searchQuery },
    { initialNumItems: 25 },
  );
  const selectedIsVisible = catalog.results.some(
    (product) => product.upc === selectedUpc,
  );
  const activeUpc = selectedIsVisible
    ? selectedUpc
    : (catalog.results[0]?.upc ?? null);
  const activeProduct = useQuery(
    api.paymoreCatalog.getByUpc,
    activeUpc ? { upc: activeUpc } : "skip",
  );

  function selectProduct(upc: string) {
    setSelectedUpc(upc);
    if (window.matchMedia("(max-width: 1023px)").matches) {
      window.requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  const canLoadMore =
    catalog.status === "CanLoadMore" || catalog.status === "LoadingMore";

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950 text-white shadow-sm">
        <div className="relative px-5 py-6 sm:px-7 sm:py-8">
          <div className="pointer-events-none absolute -right-14 -top-16 size-56 rounded-full border border-white/10" />
          <div className="pointer-events-none absolute -right-4 -top-5 size-32 rounded-full border border-white/10" />
          <div className="relative max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
              PayMore product catalog
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Find the exact product, then inspect every listing.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
              Search every imported collection by title, UPC, or MPN. Select a
              result to compare stores, condition, price, images, and stock.
            </p>
          </div>

          <div className="relative mt-6 max-w-3xl">
            <label htmlFor="catalog-search" className="sr-only">
              Search by title, UPC, or MPN
            </label>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-zinc-500"
            />
            <input
              id="catalog-search"
              type="search"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Search iPhone 256GB, MG494LL/A, or a UPC"
              className="h-12 w-full rounded-xl border border-white/15 bg-white pl-12 pr-12 text-sm font-medium text-zinc-950 outline-none placeholder:text-zinc-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/20"
            />
            {input ? (
              <button
                type="button"
                onClick={() => setInput("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-950">
            {searchQuery ? `Results for \"${searchQuery}\"` : "All products"}
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            {catalog.status === "LoadingFirstPage"
              ? "Searching the catalog"
              : `${catalog.results.length}${canLoadMore ? "+" : ""} ${catalog.results.length === 1 ? "product" : "products"}`}
          </p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 sm:inline-flex">
          <Boxes aria-hidden="true" className="size-3.5" />
          All imported collections
        </span>
      </div>

      {catalog.status === "LoadingFirstPage" ? (
        <CatalogLoading />
      ) : catalog.results.length === 0 ? (
        <CatalogEmpty hasSearch={Boolean(searchQuery)} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(22rem,0.6fr)]">
          <section
            ref={detailRef}
            aria-label="Selected product"
            className="scroll-mt-24 lg:sticky lg:top-24 lg:order-2"
          >
            <ProductDetail product={activeProduct} />
          </section>

          <section aria-label="Catalog results" className="space-y-3 lg:order-1">
            {catalog.results.map((product) => (
              <ProductResultCard
                key={product.upc}
                product={product}
                selected={product.upc === activeUpc}
                onSelect={selectProduct}
              />
            ))}

            {canLoadMore ? (
              <button
                type="button"
                onClick={() => catalog.loadMore(25)}
                disabled={catalog.status === "LoadingMore"}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-700 shadow-sm hover:border-zinc-400 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-wait disabled:opacity-60"
              >
                {catalog.status === "LoadingMore" ? (
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                ) : null}
                {catalog.status === "LoadingMore" ? "Loading products" : "Load more products"}
              </button>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}

function ProductResultCard({
  product,
  selected,
  onSelect,
}: {
  product: CatalogSearchResult;
  selected: boolean;
  onSelect: (upc: string) => void;
}) {
  const specs = compactValues([
    product.brand,
    product.model,
    product.storage,
    product.color,
    product.platform,
  ]);

  return (
    <button
      type="button"
      onClick={() => onSelect(product.upc)}
      aria-pressed={selected}
      className={`group w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 sm:p-5 ${
        selected
          ? "border-emerald-500 ring-1 ring-emerald-500/20"
          : "border-zinc-200 hover:border-zinc-300 hover:shadow-md"
      }`}
    >
      <div className="flex items-start gap-4">
        <span
          className={`mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl ${
            selected
              ? "bg-emerald-100 text-emerald-700"
              : "bg-zinc-100 text-zinc-500 group-hover:bg-zinc-950 group-hover:text-white"
          }`}
        >
          <PackageSearch aria-hidden="true" className="size-5" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-3">
            <span className="text-sm font-semibold leading-6 text-zinc-950 sm:text-[0.95rem]">
              {product.title}
            </span>
            <ChevronRight
              aria-hidden="true"
              className={`mt-1 size-4 shrink-0 transition ${
                selected
                  ? "translate-x-0.5 text-emerald-600"
                  : "text-zinc-300 group-hover:translate-x-0.5 group-hover:text-zinc-600"
              }`}
            />
          </span>

          {specs.length > 0 ? (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {specs.map((spec, index) => (
                <span
                  key={`${index}-${spec}`}
                  className="rounded-md bg-zinc-100 px-2 py-1 text-[0.68rem] font-semibold text-zinc-600"
                >
                  {spec}
                </span>
              ))}
            </span>
          ) : null}

          <span className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.7rem] text-zinc-500">
            <span className="inline-flex items-center gap-1.5 font-mono">
              <Barcode aria-hidden="true" className="size-3.5" />
              {product.upc}
            </span>
            {product.mpn ? (
              <span className="font-mono">MPN {product.mpn}</span>
            ) : null}
            <span className="inline-flex items-center gap-1.5">
              <Clock3 aria-hidden="true" className="size-3.5" />
              {dateFormatter.format(new Date(product.updatedAt))}
            </span>
          </span>
        </span>
      </div>
    </button>
  );
}

function ProductDetail({
  product,
}: {
  product: CatalogProduct | null | undefined;
}) {
  if (product === undefined) return <ProductDetailLoading />;
  if (product === null) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <PackageSearch aria-hidden="true" className="mx-auto size-7 text-zinc-300" />
        <p className="mt-3 text-sm font-semibold text-zinc-950">
          Product details unavailable
        </p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          The catalog changed while this result was open. Select another product.
        </p>
      </div>
    );
  }

  const featuredListing = pickFeaturedListing(product.listings);
  const prices = product.listings.flatMap((listing) =>
    listing.price === undefined ? [] : [listing.price],
  );
  const lowestPrice = prices.length > 0 ? Math.min(...prices) : null;
  const totalQuantity = product.listings.reduce(
    (total, listing) => total + (listing.quantity ?? 0),
    0,
  );
  const hasQuantity = product.listings.some(
    (listing) => listing.quantity !== undefined,
  );
  const stores = new Set(
    product.listings.flatMap((listing) =>
      listing.storeName ? [listing.storeName] : [],
    ),
  );

  return (
    <article className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="relative aspect-[16/9] overflow-hidden bg-zinc-100">
        {featuredListing?.imageUrl ? (
          <img
            src={featuredListing.imageUrl}
            alt={product.title}
            className="size-full object-contain p-5"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="grid size-full place-items-center text-zinc-300">
            <span className="flex flex-col items-center gap-2 text-xs font-medium">
              <ImageOff aria-hidden="true" className="size-8" />
              No product image
            </span>
          </div>
        )}
        <span className="absolute left-3 top-3 rounded-full border border-white/70 bg-white/90 px-2.5 py-1 text-[0.68rem] font-semibold text-zinc-700 shadow-sm backdrop-blur">
          {product.listings.length} {product.listings.length === 1 ? "listing" : "listings"}
        </span>
      </div>

      <div className="space-y-5 p-5 sm:p-6">
        <div>
          <div className="flex flex-wrap gap-1.5">
            {(product.collections ?? []).map((collection) => (
              <span
                key={collection}
                className="rounded-full bg-emerald-50 px-2.5 py-1 text-[0.68rem] font-semibold text-emerald-800"
              >
                {collection}
              </span>
            ))}
          </div>
          <h3 className="mt-3 text-lg font-semibold leading-7 tracking-tight text-zinc-950">
            {product.title}
          </h3>
          <p className="mt-1 text-xs font-mono text-zinc-500">
            UPC {product.upc}{product.mpn ? `  ·  MPN ${product.mpn}` : ""}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <DetailMetric
            icon={CircleDollarSign}
            label="From"
            value={lowestPrice === null ? "No price" : currencyFormatter.format(lowestPrice)}
          />
          <DetailMetric
            icon={Boxes}
            label="In stock"
            value={hasQuantity ? String(totalQuantity) : "Unknown"}
          />
          <DetailMetric
            icon={Store}
            label="Stores"
            value={stores.size > 0 ? String(stores.size) : "Unknown"}
          />
        </div>

        <ProductSpecs product={product} />

        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
              Available listings
            </h4>
            <span className="text-[0.68rem] text-zinc-400">
              Updated {dateFormatter.format(new Date(product.updatedAt))}
            </span>
          </div>
          <div className="space-y-2">
            {product.listings.length > 0 ? (
              product.listings.map((listing) => (
                <ListingCard key={listing.sourceUrl} listing={listing} />
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-zinc-200 p-4 text-xs text-zinc-500">
                No source listings are attached to this product yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function ProductSpecs({ product }: { product: CatalogProduct }) {
  const specs = [
    ["Brand", product.brand],
    ["Model", product.model],
    ["Storage", product.storage],
    ["Color", product.color],
    ["Carrier", product.carrier],
    ["Platform", product.platform],
    ["Edition", product.edition],
  ].filter((entry): entry is [string, string] => entry[1] !== null);

  if (specs.length === 0) return null;

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-zinc-50 p-4">
      {specs.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-zinc-400">
            {label}
          </dt>
          <dd className="mt-0.5 truncate text-xs font-semibold text-zinc-700">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DetailMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Boxes;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-200 p-3">
      <Icon aria-hidden="true" className="size-4 text-zinc-400" />
      <p className="mt-2 truncate text-xs font-semibold text-zinc-950">{value}</p>
      <p className="mt-0.5 text-[0.65rem] font-medium text-zinc-400">{label}</p>
    </div>
  );
}

function ListingCard({ listing }: { listing: CatalogListing }) {
  return (
    <a
      href={listing.sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="group flex items-center gap-3 rounded-xl border border-zinc-200 p-3 transition hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-zinc-100 text-zinc-500 group-hover:bg-zinc-950 group-hover:text-white">
        <Store aria-hidden="true" className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-zinc-800">
          {formatStoreName(listing.storeName)}
        </span>
        <span className="mt-0.5 block truncate text-[0.68rem] text-zinc-500">
          {compactValues([
            listing.condition,
            listing.quantity === undefined
              ? null
              : `${listing.quantity} in stock`,
          ]).join(" · ") || "Listing details pending"}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-xs font-semibold text-zinc-950">
          {listing.price === undefined
            ? "Price pending"
            : currencyFormatter.format(listing.price)}
        </span>
        <span className="mt-0.5 inline-flex items-center gap-1 text-[0.65rem] font-semibold text-zinc-400 group-hover:text-zinc-700">
          Open
          <ArrowUpRight aria-hidden="true" className="size-3" />
        </span>
      </span>
    </a>
  );
}

function CatalogLoading() {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(22rem,0.6fr)]">
      <div className="space-y-3">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-2xl border border-zinc-200 bg-white"
          />
        ))}
      </div>
      <div className="h-[34rem] animate-pulse rounded-2xl border border-zinc-200 bg-white lg:sticky lg:top-24" />
    </div>
  );
}

function ProductDetailLoading() {
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="aspect-[16/9] animate-pulse bg-zinc-100" />
      <div className="space-y-4 p-6">
        <div className="h-5 w-4/5 animate-pulse rounded bg-zinc-100" />
        <div className="h-3 w-2/5 animate-pulse rounded bg-zinc-100" />
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-20 animate-pulse rounded-xl bg-zinc-100" />
          ))}
        </div>
      </div>
    </div>
  );
}

function CatalogEmpty({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
      <PackageSearch aria-hidden="true" className="mx-auto size-9 text-zinc-300" />
      <p className="mt-4 text-sm font-semibold text-zinc-950">
        {hasSearch ? "No matching products" : "The catalog is empty"}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-zinc-500">
        {hasSearch
          ? "Try a shorter title, a full UPC, or an MPN."
          : "Products will appear here after the first PayMore import completes."}
      </p>
    </div>
  );
}

function pickFeaturedListing(listings: CatalogListing[]): CatalogListing | null {
  return (
    listings.find(
      (listing) => listing.imageUrl && listing.price !== undefined,
    ) ??
    listings.find((listing) => listing.imageUrl) ??
    listings[0] ??
    null
  );
}

function compactValues(values: Array<string | null>): string[] {
  return values.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function formatStoreName(storeName: string | undefined): string {
  if (!storeName) return "PayMore listing";
  return storeName
    .replace(/^paymore-/i, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
