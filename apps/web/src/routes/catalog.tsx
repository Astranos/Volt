import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RedirectToSignIn, SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import { usePaginatedQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";

import { authConfigured } from "../components/app-providers";
import { AuthUnavailable } from "../components/auth-page";
import { WorkspaceProvider } from "../components/workspace-provider";

export const Route = createFileRoute("/catalog")({
  component: CatalogPage,
});

function CatalogPage() {
  // Same rule as the workspace route: the static build prerenders this page,
  // so neither Convex nor Clerk's gates may be constructed before hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-950">
      <CatalogHeader ready={mounted && authConfigured} />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {!authConfigured ? (
          <div className="mx-auto max-w-lg pt-10">
            <AuthUnavailable />
          </div>
        ) : !mounted ? (
          <div className="h-64" />
        ) : (
          <>
            <SignedIn>
              {/* Same rule as the workspace route: the Convex client only
                  exists under this provider, so pagination hooks must stay
                  inside it. */}
              <WorkspaceProvider>
                <CatalogBrowser />
              </WorkspaceProvider>
            </SignedIn>
            <SignedOut>
              <RedirectToSignIn />
            </SignedOut>
          </>
        )}
      </main>
    </div>
  );
}

function CatalogHeader({ ready }: { ready: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <a href="/" className="flex items-center gap-2" aria-label="Volt home">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="hidden text-sm font-semibold sm:inline">Volt</span>
          </a>
          <span className="hidden h-5 w-px bg-zinc-300 sm:block" />
          <h1 className="truncate text-sm font-semibold text-zinc-950">Catalog</h1>
        </div>

        <div className="flex items-center gap-3">
          {ready ? (
            <SignedIn>
              <UserButton />
            </SignedIn>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function CatalogBrowser() {
  const [input, setInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Keep the search reactive without re-running the query on every keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(input.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [input]);

  const catalog = usePaginatedQuery(
    api.paymoreCatalog.searchCatalog,
    { searchQuery },
    { initialNumItems: 25 },
  );

  return (
    <div className="space-y-6">
      <div className="max-w-xl">
        <label htmlFor="catalog-search" className="mb-1.5 block text-xs font-semibold text-zinc-500">
          Search by title or UPC
        </label>
        <input
          id="catalog-search"
          type="search"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="e.g. iPhone 256GB or 077000052063"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none"
        />
      </div>

      {catalog.status === "LoadingFirstPage" ? (
        <div className="h-40" />
      ) : catalog.results.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-10 text-center">
          <p className="text-sm font-semibold text-zinc-950">No catalog matches</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-zinc-500">
            The catalog fills in as PayMore imports run. Try again later or search for a different title.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-2.5 font-semibold">UPC</th>
                  <th className="px-4 py-2.5 font-semibold">Title</th>
                  <th className="px-4 py-2.5 font-semibold">Platform</th>
                  <th className="px-4 py-2.5 font-semibold">Brand</th>
                  <th className="px-4 py-2.5 font-semibold">Model</th>
                  <th className="px-4 py-2.5 font-semibold">Color</th>
                  <th className="px-4 py-2.5 font-semibold">Storage</th>
                  <th className="px-4 py-2.5 font-semibold">Updated</th>
                </tr>
              </thead>
              <tbody>
                {catalog.results.map((product) => (
                  <tr key={product.upc} className="border-b border-zinc-100 last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-zinc-600">{product.upc}</td>
                    <td className="px-4 py-2.5 font-medium text-zinc-950">{product.title}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600">{product.platform ?? "\u2014"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600">{product.brand ?? "\u2014"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600">{product.model ?? "\u2014"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600">{product.color ?? "\u2014"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600">{product.storage ?? "\u2014"}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600">
                      {new Date(product.updatedAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {catalog.status === "CanLoadMore" || catalog.status === "LoadingMore" ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => catalog.loadMore(25)}
            disabled={catalog.status === "LoadingMore"}
            className="rounded-md border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-700 hover:border-zinc-400 hover:text-zinc-950 disabled:opacity-50"
          >
            {catalog.status === "LoadingMore" ? "Loading\u2026" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
