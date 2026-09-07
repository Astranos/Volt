import { useEffect, useState } from "react";
import { ArrowRight, Check, Copy, Search } from "lucide-react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { CONVEX_URL } from "../../lib/env";
import type { CatalogResult } from "../../lib/catalog";
import {
  createPublicSearch,
  UPC_SEARCH_CANONICAL,
  UPC_SEARCH_DESCRIPTION,
  UPC_SEARCH_TITLE,
  type PublicSearchState,
} from "../../lib/upc-search";

const examples = ["Nintendo Switch", "PlayStation", "iPhone"];
const buttonClass =
  "rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600";

export function UpcSearchIntro() {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 sm:text-6xl">
        Find the UPC for
        <br className="hidden sm:block" /> your next listing.
      </h1>
      <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-zinc-600">
        Search by product name, UPC, or manufacturer part number. Find a match
        in Volt's catalog, check the details, and copy the code. No account
        needed.
      </p>
      <p className="mt-3 text-sm text-zinc-500">
        Current catalog coverage focuses on electronics and video games.
      </p>
    </div>
  );
}

export function UpcSearchGuide() {
  return (
    <div className="mx-auto mt-16 max-w-5xl">
      <section
        className="rounded-3xl bg-zinc-950 p-8 text-white sm:flex sm:items-center sm:justify-between sm:gap-10 sm:p-10"
        aria-labelledby="upc-volt-title"
      >
        <div className="max-w-xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Keep going with Volt
          </p>
          <h2
            id="upc-volt-title"
            className="mt-3 text-2xl font-semibold tracking-tight"
          >
            One lookup today. A faster workflow tomorrow.
          </h2>
          <p className="mt-3 leading-7 text-zinc-300">
            Explore Volt's scanning tools, workspace, and product data API for
            your inventory workflow. Review the available services and access
            requirements before getting started.
          </p>
        </div>
        <div className="mt-6 flex shrink-0 flex-col gap-3 sm:mt-0">
          <a href="/sign-up" className={buttonClass}>
            Get started with Volt{" "}
            <ArrowRight className="ml-2 inline size-4" aria-hidden="true" />
          </a>
          <a
            href="/api-keys"
            className="rounded-xl border border-zinc-700 px-6 py-3 text-center text-sm font-semibold hover:bg-zinc-800"
          >
            Explore API access
          </a>
        </div>
      </section>
      <section
        className="mx-auto mt-16 max-w-3xl"
        aria-labelledby="upc-help-title"
      >
        <h2
          id="upc-help-title"
          className="text-2xl font-semibold tracking-tight text-zinc-950"
        >
          A few things to know about UPC lookup
        </h2>
        <div className="mt-6 divide-y divide-zinc-200">
          {[
            [
              "What is a UPC code?",
              "A UPC-A is a 12-digit product identifier commonly printed beneath a retail barcode. Keep leading zeros when copying a code. A UPC identifies a product, not an individual item's serial number.",
            ],
            [
              "How do I choose the right match?",
              "Check the exact model, color, storage, platform, edition, and packaging against your item. Similar names can have different UPCs. Confirm the code with the packaging or manufacturer before using it in a listing.",
            ],
            [
              "Why can't I find my item?",
              "Volt's catalog is not a complete registry of every product. It currently focuses on electronics and video games. Try a shorter name or an exact manufacturer part number. A missing result does not mean a product has no UPC.",
            ],
            [
              "Can Volt create or assign a UPC?",
              "No. This tool looks up existing catalog records and does not issue codes or verify GS1 ownership. If you need a new product identifier for your own product, contact GS1.",
            ],
          ].map(([question, answer]) => (
            <details key={question} className="group py-5">
              <summary className="cursor-pointer font-medium text-zinc-900">
                {question}
              </summary>
              <p className="mt-3 text-sm leading-7 text-zinc-600">{answer}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

function ProductCard({ product }: { product: CatalogResult }) {
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const variants = [
    product.storage,
    product.color,
    product.carrier,
    product.platform,
    product.edition,
  ].filter(Boolean);
  async function copyUpc() {
    try {
      await navigator.clipboard.writeText(product.upc);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }
  return (
    <li className="flex flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          {product.brand || "Catalog match"}
        </p>
        <h3 className="mt-2 text-lg font-semibold leading-6 text-zinc-950">
          {product.title}
        </h3>
        <dl className="mt-4 space-y-1 text-sm text-zinc-600">
          {product.model ? (
            <div>
              <dt className="inline font-medium">Model: </dt>
              <dd className="inline">{product.model}</dd>
            </div>
          ) : null}
          {product.mpn ? (
            <div>
              <dt className="inline font-medium">MPN: </dt>
              <dd className="inline break-all">{product.mpn}</dd>
            </div>
          ) : null}
        </dl>
        {variants.length > 0 ? (
          <p className="mt-3 text-sm text-zinc-500">{variants.join(" · ")}</p>
        ) : null}
      </div>
      <div className="mt-6 rounded-xl bg-zinc-50 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              UPC
            </p>
            <p className="select-all break-all font-mono text-lg font-medium text-zinc-950">
              {product.upc}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void copyUpc()}
            aria-label={`Copy UPC ${product.upc}`}
            className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-600 hover:border-emerald-300 hover:text-emerald-700"
          >
            {copy === "copied" ? (
              <Check className="size-4" aria-hidden="true" />
            ) : (
              <Copy className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
        <p role="status" className="mt-1 text-xs text-zinc-600">
          {copy === "copied"
            ? "UPC copied."
            : copy === "failed"
              ? "Couldn't copy. Select the code and copy it manually."
              : "Check the exact variant before listing."}
        </p>
      </div>
    </li>
  );
}

export function PublicSearchResults({
  state,
  retry,
}: {
  state: PublicSearchState;
  retry: () => void;
}) {
  if (state.kind === "idle")
    return (
      <p className="py-6 text-center text-sm text-zinc-500">
        Have an item in mind? Start with its name or model number.
      </p>
    );
  if (state.kind === "loading")
    return (
      <p role="status" className="py-10 text-center text-zinc-600">
        Searching Volt's catalog…
      </p>
    );
  if (state.kind === "error")
    return (
      <div
        role="alert"
        className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center"
      >
        <p className="text-sm text-amber-900">{state.message}</p>
        <button
          type="button"
          onClick={retry}
          className="mt-3 text-sm font-semibold text-amber-900 underline"
        >
          Try again
        </button>
      </div>
    );
  return (
    <section aria-label="Search results">
      <p role="status" className="mb-4 text-sm text-zinc-600">
        {state.result.products.length
          ? `${state.result.products.length} matches for “${state.query}”`
          : `No matches for “${state.query}”`}
      </p>
      {state.result.products.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {state.result.products.map((product) => (
            <ProductCard key={product.upc} product={product} />
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-300 p-8 text-center">
          <h2 className="font-semibold text-zinc-900">
            Let's try a different search.
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-zinc-600">
            Try a shorter product name, an exact UPC, or the manufacturer's part
            number. Our catalog doesn't cover every item.
          </p>
        </div>
      )}
      {state.result.hasMore ? (
        <p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
          Showing up to 20 matches. Add a model number or a more specific
          product name to narrow your search.
        </p>
      ) : null}
    </section>
  );
}

export function PublicUpcSearch({
  initialQuery = "",
}: {
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<PublicSearchState>({ kind: "idle" });
  const [search] = useState(() =>
    createPublicSearch(async (searchQuery) => {
      const client = new ConvexHttpClient(CONVEX_URL);
      return client.query(api.productData.searchPublicProducts, {
        searchQuery,
      });
    }, setState),
  );
  useEffect(() => {
    const previousTitle = document.title;
    const restore: Array<() => void> = [];
    function setMeta(name: string, content: string) {
      const existing = document.head.querySelector<HTMLMetaElement>(
        `meta[name="${name}"]`,
      );
      const meta = existing ?? document.createElement("meta");
      const previous = meta.content;
      meta.name = name;
      meta.content = content;
      if (!existing) document.head.append(meta);
      restore.push(() => {
        if (existing) meta.content = previous;
        else meta.remove();
      });
      return meta;
    }
    document.title = UPC_SEARCH_TITLE;
    setMeta("description", UPC_SEARCH_DESCRIPTION);
    const robots = setMeta("robots", "index,follow");
    const existingCanonical = document.head.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    const canonical = existingCanonical ?? document.createElement("link");
    const previousHref = canonical.href;
    canonical.rel = "canonical";
    canonical.href = UPC_SEARCH_CANONICAL;
    if (!existingCanonical) document.head.append(canonical);
    const readLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const value = params.get("q") ?? "";
      robots.content = params.has("q") ? "noindex,follow" : "index,follow";
      setQuery(value);
      void search.search(value);
    };
    readLocation();
    window.addEventListener("popstate", readLocation);
    window.addEventListener("volt-upc-search", readLocation);
    return () => {
      search.cancel();
      window.removeEventListener("popstate", readLocation);
      window.removeEventListener("volt-upc-search", readLocation);
      document.title = previousTitle;
      restore.forEach((reset) => reset());
      if (existingCanonical) canonical.href = previousHref;
      else canonical.remove();
    };
  }, [initialQuery, search]);
  function submit(value: string) {
    const normalized = value.trim();
    const url = new URL(window.location.href);
    if (normalized) url.searchParams.set("q", normalized);
    else url.searchParams.delete("q");
    window.history.pushState(window.history.state, "", url);
    window.dispatchEvent(new Event("volt-upc-search"));
  }
  return (
    <div className="bg-zinc-50 px-5 pb-20 pt-14 sm:px-8 sm:pt-20">
      <UpcSearchIntro />
      <div className="mx-auto mt-9 max-w-5xl">
        <form
          action="/upc-search"
          method="get"
          onSubmit={(event) => {
            event.preventDefault();
            submit(query);
          }}
          className="mx-auto max-w-3xl"
        >
          <label
            htmlFor="upc-search-input"
            className="mb-2 block text-sm font-medium text-zinc-700"
          >
            Product name, UPC, or MPN
          </label>
          <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-2 shadow-sm sm:flex-row">
            <div className="flex min-w-0 flex-1 items-center gap-3 pl-3">
              <Search
                className="size-5 shrink-0 text-zinc-400"
                aria-hidden="true"
              />
              <input
                id="upc-search-input"
                name="q"
                type="search"
                required
                minLength={2}
                maxLength={120}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="e.g. Nintendo Switch OLED"
                className="min-w-0 flex-1 bg-transparent py-3 text-base text-zinc-950 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              />
            </div>
            <button className={buttonClass} type="submit">
              Search UPCs
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-500">
            Use 2 to 120 characters. Search results are limited to 20 matches.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span>Try a search</span>
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => submit(example)}
                className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-600 hover:border-emerald-300 hover:text-emerald-700"
              >
                {example}
              </button>
            ))}
          </div>
        </form>
        <div className="mt-10" aria-busy={state.kind === "loading"}>
          <PublicSearchResults
            state={state}
            retry={() => submit(query)}
          />
        </div>
      </div>
      <UpcSearchGuide />
    </div>
  );
}
