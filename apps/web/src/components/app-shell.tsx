import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import {
  RedirectToSignIn,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/clerk-react";
import {
  ArrowUpRight,
  Chrome,
  Database,
  KeyRound,
  LayoutDashboard,
  Menu,
  ScanLine,
  Smartphone,
  X,
} from "lucide-react";

import {
  chromeExtensionDownloadUrl,
  mobileAppDownloadUrl,
} from "../site-chrome";
import { authConfigured } from "./app-providers";
import { AuthUnavailable } from "./auth-page";
import { WorkspaceProvider } from "./workspace-provider";

type AuthenticatedDestination =
  "workspace" | "scanner-results" | "product-data" | "api-keys";
type AppLayoutProps = {
  current: AuthenticatedDestination;
  children: ReactNode;
  account?: ReactNode;
};

const destinations = {
  workspace: {
    href: "/dashboard",
    label: "Dashboard / Activity",
    icon: LayoutDashboard,
  },
  "scanner-results": {
    href: "/scanner-results",
    label: "Scanner results",
    icon: ScanLine,
  },
  "product-data": { href: "/catalog", label: "Product data", icon: Database },
  "api-keys": { href: "/api-keys", label: "API keys", icon: KeyRound },
} satisfies Record<
  AuthenticatedDestination,
  { href: string; label: string; icon: typeof LayoutDashboard }
>;
const destinationOrder: readonly AuthenticatedDestination[] = [
  "workspace",
  "scanner-results",
  "product-data",
  "api-keys",
];

export function AppShell({
  current,
  children,
}: Omit<AppLayoutProps, "account">) {
  // Static prerendering has no browser auth state. Keep Clerk gates and the
  // Convex client below this hydration boundary on every account route.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <AppLayout
      current={current}
      account={
        mounted && authConfigured ? (
          <SignedIn>
            <UserButton />
          </SignedIn>
        ) : null
      }
    >
      {!authConfigured ? (
        <div className="mx-auto max-w-lg pt-10">
          <AuthUnavailable />
        </div>
      ) : !mounted ? (
        <div
          role="status"
          className="flex h-64 items-center justify-center text-sm text-zinc-500"
        >
          Loading your workspace…
        </div>
      ) : (
        <>
          <SignedIn>
            <WorkspaceProvider>{children}</WorkspaceProvider>
          </SignedIn>
          <SignedOut>
            <RedirectToSignIn />
          </SignedOut>
        </>
      )}
    </AppLayout>
  );
}

export function AppLayout({ current, children, account }: AppLayoutProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-950">
      <a
        href="#main-content"
        className="sr-only z-[70] rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-64 flex-col border-r border-zinc-800 bg-zinc-950 text-zinc-100 lg:flex">
        <Sidebar current={current} />
      </aside>
      <div className="min-w-0 lg:pl-64">
        <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
                <Dialog.Trigger
                  aria-label="Open navigation"
                  className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 lg:hidden"
                >
                  <Menu className="size-5" aria-hidden="true" />
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Backdrop className="fixed inset-0 z-[60] bg-zinc-950/60 backdrop-blur-sm" />
                  <Dialog.Popup className="fixed inset-y-0 left-0 z-[61] flex w-72 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto bg-zinc-950 text-zinc-100 shadow-2xl outline-none">
                    <Dialog.Title className="sr-only">
                      Volt navigation
                    </Dialog.Title>
                    <Dialog.Close
                      aria-label="Close navigation"
                      className="absolute right-3 top-4 z-10 flex size-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    >
                      <X className="size-5" aria-hidden="true" />
                    </Dialog.Close>
                    <Sidebar
                      current={current}
                      onNavigate={() => setMenuOpen(false)}
                    />
                  </Dialog.Popup>
                </Dialog.Portal>
              </Dialog.Root>
              <div className="min-w-0">
                <span className="hidden text-xs text-zinc-500 sm:block">
                  Your workspace
                </span>
                <p className="truncate text-sm font-semibold">
                  {destinations[current].label}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <ConnectionStatus />
              {account}
            </div>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-7xl scroll-mt-20 px-4 py-6 outline-none sm:px-6 lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

function Sidebar({
  current,
  onNavigate,
}: {
  current: AuthenticatedDestination;
  onNavigate?: () => void;
}) {
  return (
    <>
      <a
        href="/dashboard"
        onClick={onNavigate}
        aria-label="Volt dashboard"
        className="flex h-20 shrink-0 items-center gap-3 px-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400"
      >
        <img src="/favicon.svg" alt="" className="size-9" />
        <span className="text-xl font-bold tracking-tight">
          Volt<span className="ml-1 text-emerald-400">.</span>
        </span>
      </a>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-4">
        <p className="px-3 pb-3 pt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Workspace
        </p>
        <nav aria-label="Main navigation" className="space-y-1">
          {destinationOrder.map((id) => {
            const destination = destinations[id];
            const Icon = destination.icon;
            return (
              <a
                key={id}
                href={destination.href}
                onClick={onNavigate}
                aria-current={current === id ? "page" : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${current === id ? "bg-emerald-400/10 text-emerald-300 ring-1 ring-inset ring-emerald-400/20" : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"}`}
              >
                <Icon className="size-[18px]" aria-hidden="true" />
                {destination.label}
                {current === id ? (
                  <span className="ml-auto size-1.5 rounded-full bg-emerald-400" />
                ) : null}
              </a>
            );
          })}
        </nav>
        <div className="mt-auto pt-12">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-sm font-semibold text-zinc-100">
              Capture from anywhere
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
              Send scans from your phone and use them in your browser.
            </p>
            <div className="mt-4 space-y-1">
              <a
                href={mobileAppDownloadUrl}
                target="_blank"
                rel="noreferrer"
                onClick={onNavigate}
                className="flex items-center gap-2 rounded-md py-2 text-xs font-medium text-zinc-300 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <Smartphone className="size-4" aria-hidden="true" />
                Get the iOS app
                <ArrowUpRight className="ml-auto size-3.5" aria-hidden="true" />
                <span className="sr-only">, opens in a new tab</span>
              </a>
              <a
                href={chromeExtensionDownloadUrl}
                target="_blank"
                rel="noreferrer"
                onClick={onNavigate}
                className="flex items-center gap-2 rounded-md py-2 text-xs font-medium text-zinc-300 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <Chrome className="size-4" aria-hidden="true" />
                Chrome extension
                <ArrowUpRight className="ml-auto size-3.5" aria-hidden="true" />
                <span className="sr-only">, opens in a new tab</span>
              </a>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between px-3 text-[11px] text-zinc-500">
            <span>Volt workspace</span>
            <a
              href="/privacy"
              onClick={onNavigate}
              className="rounded hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              Privacy
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

function ConnectionStatus() {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (online === null) return null;
  return (
    <span
      role="status"
      title={
        online
          ? "Your browser has a network connection"
          : "Reconnect to load and update your workspace"
      }
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${online ? "border-zinc-200 bg-zinc-50 text-zinc-600" : "border-amber-200 bg-amber-50 text-amber-800"}`}
    >
      <span
        className={`size-1.5 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500"}`}
      />
      {online ? "Online" : "Offline"}
    </span>
  );
}
