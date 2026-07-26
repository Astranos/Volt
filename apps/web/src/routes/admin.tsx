import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RedirectToSignIn, SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import { authConfigured } from "../components/app-providers";
import { AuthUnavailable } from "../components/auth-page";
import { WorkspaceProvider } from "../components/workspace-provider";

export const Route = createFileRoute("/admin")({
  component: AdminPage,
});

function AdminPage() {
  // Same rule as the workspace route: the static build prerenders this page, so
  // neither Convex nor Clerk's gates may be constructed before hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-950">
      <AdminHeader ready={mounted && authConfigured} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
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
                <AdminConsole />
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

function AdminHeader({ ready }: { ready: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-zinc-50/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <a href="/" className="flex items-center gap-2" aria-label="Volt home">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="hidden text-sm font-semibold sm:inline">Volt</span>
          </a>
          <span className="hidden h-5 w-px bg-zinc-300 sm:block" />
          <h1 className="truncate text-sm font-semibold text-zinc-950">Admin</h1>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/dashboard"
            className="text-xs font-semibold text-zinc-600 hover:text-zinc-950"
          >
            Workspace
          </a>
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

function AdminConsole() {
  const overview = useQuery(api.admin.overview, {});
  const grantPro = useMutation(api.admin.grantPro);
  const revokePro = useMutation(api.admin.revokePro);

  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const accounts = useMemo(() => {
    if (!overview?.isAdmin) return [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return overview.accounts;
    return overview.accounts.filter(
      (account) =>
        account.email?.toLowerCase().includes(needle) ||
        account.name?.toLowerCase().includes(needle) ||
        account.clerkUserId.toLowerCase().includes(needle),
    );
  }, [overview, filter]);

  if (overview === undefined) {
    return <p className="pt-10 text-center text-sm text-zinc-500">Loading…</p>;
  }

  if (!overview.isAdmin) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 text-center">
        <h2 className="text-lg font-semibold">Not an admin</h2>
        <p className="mt-2 text-sm text-zinc-600">
          This console is limited to Volt administrators. Sign in with an admin account to manage
          complimentary Pro access.
        </p>
      </div>
    );
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = email.trim();
    if (!value) return;
    void run(async () => {
      await grantPro({ email: value, ...(note.trim() ? { note: note.trim() } : {}) });
      setEmail("");
      setNote("");
    });
  }

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-zinc-200 bg-white p-6">
        <h2 className="text-base font-semibold">Comp Volt Pro</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Grants full app access in the iPhone app, no subscription required. An email works even
          before that person has signed in — it applies the moment they do.
        </p>
        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="person@example.com"
            required
            className="h-11 flex-1 rounded-xl border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-600"
          />
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Note (optional)"
            className="h-11 flex-1 rounded-xl border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-600"
          />
          <button
            type="submit"
            disabled={busy}
            className="h-11 rounded-xl bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            Grant Pro
          </button>
        </form>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-6 py-4">
          <h2 className="text-base font-semibold">
            Comped grants{" "}
            <span className="text-sm font-normal text-zinc-500">({overview.grants.length})</span>
          </h2>
        </div>
        {overview.grants.length === 0 ? (
          <p className="px-6 py-6 text-sm text-zinc-500">Nothing comped yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {overview.grants.map((grant) => (
              <li key={grant.id} className="flex flex-wrap items-center gap-3 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {grant.email ?? grant.clerkUserId ?? "Unknown"}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {grant.note ? `${grant.note} · ` : ""}
                    {grant.status === "active" ? "Active" : "Revoked"}
                    {grant.grantedByEmail ? ` · by ${grant.grantedByEmail}` : ""}
                  </p>
                </div>
                {grant.status === "active" ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => revokePro({ grantId: grant.id }))}
                    className="h-9 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        grantPro({
                          ...(grant.email ? { email: grant.email } : {}),
                          ...(grant.clerkUserId ? { clerkUserId: grant.clerkUserId } : {}),
                        }),
                      )
                    }
                    className="h-9 rounded-lg border border-zinc-300 px-3 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-6 py-4">
          <h2 className="text-base font-semibold">
            Accounts{" "}
            <span className="text-sm font-normal text-zinc-500">({overview.accounts.length})</span>
          </h2>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search email, name, or id"
            className="h-9 w-56 rounded-lg border border-zinc-300 px-3 text-sm outline-none focus:border-emerald-600"
          />
        </div>
        {accounts.length === 0 ? (
          <p className="px-6 py-6 text-sm text-zinc-500">No accounts match.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {accounts.map((account) => (
              <li key={account.clerkUserId} className="flex flex-wrap items-center gap-3 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {account.email ?? account.name ?? account.clerkUserId}
                  </p>
                  <p className="truncate font-mono text-xs text-zinc-500">{account.clerkUserId}</p>
                </div>
                <AccessBadge account={account} />
                {account.isComped ? (
                  <span className="text-xs font-semibold text-zinc-400">Comped</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        grantPro({
                          clerkUserId: account.clerkUserId,
                          ...(account.email ? { email: account.email } : {}),
                        }),
                      )
                    }
                    className="h-9 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Give Pro
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AccessBadge({
  account,
}: {
  account: { hasProAccess: boolean; hasPaidSubscription: boolean };
}) {
  const label = account.hasPaidSubscription
    ? "Subscribed"
    : account.hasProAccess
      ? "Pro"
      : "Free";
  const tone = account.hasPaidSubscription
    ? "border-blue-200 bg-blue-50 text-blue-800"
    : account.hasProAccess
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-zinc-200 bg-zinc-50 text-zinc-600";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</span>
  );
}
