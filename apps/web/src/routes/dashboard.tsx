import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RedirectToSignIn, SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";

import { authConfigured } from "../components/app-providers";
import { AuthUnavailable } from "../components/auth-page";
import { WorkspaceProvider } from "../components/workspace-provider";
import { WorkspaceView } from "../components/dashboard/workspace-view";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  // The static build prerenders this route, so the Convex client (and Clerk's
  // signed-in gates) must not be constructed until the browser takes over.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-950">
      <DashboardHeader ready={mounted && authConfigured} />
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
              <WorkspaceProvider>
                <WorkspaceView />
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

function DashboardHeader({ ready }: { ready: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <a href="/" className="flex items-center gap-2" aria-label="Volt home">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="hidden text-sm font-semibold sm:inline">Volt</span>
          </a>
          <span className="hidden h-5 w-px bg-zinc-300 sm:block" />
          <h1 className="truncate text-sm font-semibold text-zinc-950">
            Workspace
          </h1>
        </div>

        <div className="flex items-center gap-3">
          {ready ? (
            <SignedIn>
              {/* Only claim to be live once there is a subscription behind it. */}
              <span
                className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 sm:inline-flex"
                title="New captures appear here the moment your phone sends them"
              >
                <span className="size-1.5 rounded-full bg-emerald-600" />
                Live
              </span>
              <UserButton />
            </SignedIn>
          ) : null}
        </div>
      </div>
    </header>
  );
}
