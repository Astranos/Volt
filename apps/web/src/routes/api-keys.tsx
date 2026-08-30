import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RedirectToSignIn, SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";

import { ApiKeyManager } from "../components/api-keys/api-key-manager";
import { authConfigured } from "../components/app-providers";
import { AuthUnavailable } from "../components/auth-page";
import { AuthenticatedNav } from "../components/authenticated-nav";
import { WorkspaceProvider } from "../components/workspace-provider";

export const Route = createFileRoute("/api-keys")({
  component: ApiKeysPage,
});

function ApiKeysPage() {
  // Static prerendering runs without browser auth state. Keep Clerk and Convex
  // below the hydration gate, matching the other signed-in routes.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-950">
      <ApiKeysHeader ready={mounted && authConfigured} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        {!authConfigured ? (
          <div className="mx-auto max-w-lg pt-10">
            <AuthUnavailable />
          </div>
        ) : !mounted ? (
          <div className="h-64" />
        ) : (
          <>
            <SignedIn>
              <WorkspaceProvider>
                <ApiKeyManager />
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

function ApiKeysHeader({ ready }: { ready: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <a href="/" className="flex items-center gap-2" aria-label="Volt home">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="hidden text-sm font-semibold sm:inline">Volt</span>
          </a>
          <span className="hidden h-5 w-px bg-zinc-300 sm:block" />
          <h1 className="truncate text-sm font-semibold text-zinc-950">API keys</h1>
          <AuthenticatedNav current="api-keys" />
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
