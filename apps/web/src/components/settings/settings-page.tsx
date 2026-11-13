import type { ReactNode } from "react";
import { useClerk, useUser } from "@clerk/clerk-react";
import { useQuery } from "convex/react";
import { ArrowUpRight, Chrome, History, LogOut, Smartphone, UserRound } from "lucide-react";
import type { FunctionReturnType } from "convex/server";

import { api } from "../../../../../convex/_generated/api";
import { formatBytes } from "../../lib/workspace";
import { chromeExtensionDownloadUrl, mobileAppDownloadUrl } from "../../site-chrome";

export type StorageUsage = FunctionReturnType<typeof api.workspaceStorage.getUsage>;
export type SettingsAccount = { name: string | null; email: string | null; imageUrl: string | null };

export function SettingsPage() {
  const { user } = useUser();
  const clerk = useClerk();
  const usage = useQuery(api.workspaceStorage.getUsage, {});
  return (
    <SettingsContent
      account={user ? {
        name: user.fullName,
        email: user.primaryEmailAddress?.emailAddress ?? null,
        imageUrl: user.imageUrl,
      } : null}
      usage={usage ?? null}
      onManageAccount={() => clerk.openUserProfile()}
      onSignOut={() => void clerk.signOut({ redirectUrl: "/" })}
    />
  );
}

export function SettingsContent({
  account,
  usage,
  onManageAccount,
  onSignOut,
}: {
  account: SettingsAccount | null;
  usage: StorageUsage | null;
  onManageAccount: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Settings</h1>
        <p className="mt-1 text-sm leading-6 text-zinc-500">Your account, capture storage, and the Volt apps.</p>
      </header>

      <Section title="Account" description="The account your phone and Chrome sign in with.">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3.5">
            {account?.imageUrl ? (
              <img src={account.imageUrl} alt="" className="size-11 shrink-0 rounded-full bg-zinc-100 object-cover" />
            ) : (
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-500">
                <UserRound className="size-5" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-950">{account?.name || account?.email || "Signed in"}</p>
              {account?.name && account.email ? <p className="truncate text-sm text-zinc-500">{account.email}</p> : null}
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onManageAccount} className={secondaryButton}>Manage account</button>
            <button type="button" onClick={onSignOut} className={secondaryButton}>
              <LogOut className="size-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </div>
      </Section>

      <Section title="Capture storage" description="Scans and photos your phone sends to this account.">
        {usage ? <StorageDetails usage={usage} /> : (
          <div className="space-y-4 p-5" role="status" aria-label="Loading storage">
            <div className="h-10 animate-pulse rounded-lg bg-zinc-100" />
            <div className="h-10 animate-pulse rounded-lg bg-zinc-100" />
          </div>
        )}
      </Section>

      <Section title="Apps" description="Capture on your phone, then use it in your browser.">
        <div className="divide-y divide-zinc-100">
          <AppRow
            icon={<Smartphone className="size-5" aria-hidden="true" />}
            title="Volt for iPhone"
            body="Scan barcodes, read labels, and take listing photos. Sign in with this account."
            href={mobileAppDownloadUrl}
            cta="App Store"
          />
          <AppRow
            icon={<Chrome className="size-5" aria-hidden="true" />}
            title="Volt for Chrome"
            body="Search, offers, and the handbook in your browser. Captures appear there too."
            href={chromeExtensionDownloadUrl}
            cta="Chrome Web Store"
          />
        </div>
      </Section>
    </div>
  );
}

const secondaryButton =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-[0.7rem] border border-zinc-200 bg-white px-3.5 text-sm font-semibold text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500";

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-3 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-8">
      <div className="pt-1">
        <h2 className="text-sm font-semibold text-zinc-950">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-500">{description}</p>
      </div>
      <div className="overflow-hidden rounded-[1.2rem] border border-zinc-200 bg-white">{children}</div>
    </section>
  );
}

function StorageDetails({ usage }: { usage: StorageUsage }) {
  return (
    <div className="space-y-5 p-5">
      <Meter
        label="Stored scans"
        value={`${usage.recordsUsed.toLocaleString()} of ${usage.recordsLimit.toLocaleString()}`}
        fraction={usage.recordsUsed / Math.max(1, usage.recordsLimit)}
      />
      <Meter
        label="Photo storage"
        value={`${formatBytes(usage.bytesUsed)} of ${formatBytes(usage.bytesLimit)}`}
        fraction={usage.bytesUsed / Math.max(1, usage.bytesLimit)}
      />
      <div className="flex items-start gap-3 rounded-[0.85rem] bg-zinc-50 px-4 py-3">
        <History className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden="true" />
        <p className="text-sm leading-6 text-zinc-600">
          {usage.enabled
            ? `Captures are kept for ${usage.retentionDays} days, then cleared. Export anything you need from Capture history.`
            : "Captures aren't cleared automatically right now."}
        </p>
      </div>
    </div>
  );
}

function Meter({ label, value, fraction }: { label: string; value: string; fraction: number }) {
  const percent = Math.min(100, Math.max(0, fraction * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-zinc-700">{label}</span>
        <span className="tabular-nums text-zinc-500">{value}</span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <div
          className={`h-full rounded-full ${percent >= 90 ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${percent > 0 ? Math.max(percent, 1.5) : 0}%` }}
        />
      </div>
    </div>
  );
}

function AppRow({ icon, title, body, href, cta }: { icon: ReactNode; title: string; body: string; href: string; cta: string }) {
  return (
    <div className="flex items-center gap-4 p-5">
      <span className="grid size-10 shrink-0 place-items-center rounded-[0.8rem] bg-zinc-100 text-zinc-700">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-zinc-950">{title}</p>
        <p className="mt-0.5 text-sm leading-6 text-zinc-500">{body}</p>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
      >
        {cta}
        <ArrowUpRight className="size-4" aria-hidden="true" />
        <span className="sr-only">, opens in a new tab</span>
      </a>
    </div>
  );
}
