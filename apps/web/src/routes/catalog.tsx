import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RedirectToSignIn, SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";

import { authConfigured } from "../components/app-providers";
import { AuthUnavailable } from "../components/auth-page";
import { CatalogBrowser } from "../components/catalog/catalog-browser";
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
