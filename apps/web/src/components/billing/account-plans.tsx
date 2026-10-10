import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
function formatStorageBytes(bytes: number) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index =
    bytes > 0 ? Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  return `${(bytes / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[index]}`;
}

const button =
  "mt-5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-200 disabled:text-zinc-500";
export function AccountPlans() {
  const billing = useQuery(api.webBilling.getAccountBilling, {});
  const storage = useQuery(api.workspaceStorage.getUsage, {});
  const usage = useQuery(api.productApiUsage.getStatus, {});
  const checkout = useAction(api.stripeBilling.createCheckout);
  const portal = useAction(api.stripeBilling.createPortal);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function open(product: "workspace" | "api" | "portal") {
    setPending(true);
    setError(null);
    try {
      const result =
        product === "portal" ? await portal({}) : await checkout({ product });
      window.location.assign(result.url);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to open billing. Try again.",
      );
      setPending(false);
    }
  }
  if (!billing || !storage || !usage)
    return <p role="status">Loading plans and usage…</p>;
  return (
    <AccountPlansContent
      billing={billing}
      storage={storage}
      usage={usage}
      pending={pending}
      error={error}
      open={open}
    />
  );
}

export function AccountPlansContent({
  billing,
  storage,
  usage,
  pending,
  error,
  open,
}: {
  billing: FunctionReturnType<typeof api.webBilling.getAccountBilling>;
  storage: FunctionReturnType<typeof api.workspaceStorage.getUsage>;
  usage: FunctionReturnType<typeof api.productApiUsage.getStatus>;
  pending: boolean;
  error: string | null;
  open: (product: "workspace" | "api" | "portal") => Promise<void>;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Plans and usage</h1>
        <p className="mt-2 text-zinc-600">
          Scanning is free. Pay for longer cloud history or product API access
          when you need it.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
          {error}
        </p>
      )}
      {!billing.billingEnabled && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Paid plans are coming soon. Checkout is unavailable while payment
          setup is completed.
        </p>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-2xl border border-zinc-200 bg-white p-6">
          <p className="text-sm text-emerald-700">
            {storage.tier === "workspace" ? "Workspace active" : "Free scanner"}
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            Workspace · ${billing.offers.workspace.monthlyPriceUsd} / month
          </h2>
          <p className="mt-3 text-sm text-zinc-600">
            Remove website ads and keep scans while subscribed, up to{" "}
            {billing.offers.workspace.paidRecordsLimit.toLocaleString()} records
            and {formatStorageBytes(billing.offers.workspace.paidBytesLimit)}.
            Free history lasts {billing.offers.workspace.freeRetentionDays}{" "}
            days, up to{" "}
            {billing.offers.workspace.freeRecordsLimit.toLocaleString()} records
            and {formatStorageBytes(billing.offers.workspace.freeBytesLimit)}.
          </p>
          <p className="mt-4 text-sm">
            {storage.recordsUsed.toLocaleString()} /{" "}
            {storage.recordsLimit.toLocaleString()} records ·{" "}
            {formatStorageBytes(storage.bytesUsed)} /{" "}
            {formatStorageBytes(storage.bytesLimit)}
          </p>
          {!storage.enabled && (
            <p className="mt-2 text-sm text-zinc-500">
              Pilot mode: retention and storage limits are not yet enforced.
              Existing history is preserved.
            </p>
          )}
          {storage.access === "read_only" && storage.graceEndsAt && (
            <p className="mt-2 text-sm text-amber-800">
              Cloud history is read-only until{" "}
              {new Date(storage.graceEndsAt).toLocaleDateString()}. Export your
              scans or renew before retention resumes.
            </p>
          )}
          <button
            className={button}
            disabled={
              pending ||
              !billing.workspace.checkoutEnabled ||
              storage.tier === "workspace"
            }
            onClick={() => void open("workspace")}
          >
            {storage.tier === "workspace"
              ? "Workspace active"
              : billing.workspace.checkoutEnabled
                ? "Upgrade workspace"
                : "Coming soon"}
          </button>
        </section>
        <section className="rounded-2xl border border-zinc-200 bg-white p-6">
          <p className="text-sm text-emerald-700">
            {usage.tier === "api" ? "API plan active" : "API evaluation"}
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            Product API · ${billing.offers.api.monthlyPriceUsd} / month
          </h2>
          <p className="mt-3 text-sm text-zinc-600">
            {billing.offers.api.monthlyLimit.toLocaleString()} successful
            requests per UTC calendar month. Evaluation includes{" "}
            {billing.offers.api.evaluationLimit.toLocaleString()} successful
            requests total. All your keys share the allowance.
          </p>
          <p className="mt-4 text-sm">
            {usage.used.toLocaleString()} / {usage.limit.toLocaleString()}{" "}
            requests · {usage.remaining.toLocaleString()} remaining
          </p>
          {usage.resetsAt && (
            <p className="mt-2 text-sm text-zinc-500">
              Resets {new Date(usage.resetsAt).toLocaleDateString()}
            </p>
          )}
          {!usage.enforcementEnabled && (
            <p className="mt-2 text-sm text-zinc-500">
              Pilot mode: usage is tracked; the request allowance is not yet
              enforced.
            </p>
          )}
          <button
            className={button}
            disabled={
              pending || !billing.api.checkoutEnabled || usage.tier === "api"
            }
            onClick={() => void open("api")}
          >
            {usage.tier === "api"
              ? "API plan active"
              : billing.api.checkoutEnabled
                ? "Subscribe to API"
                : "Coming soon"}
          </button>
          <a
            href="/api-keys"
            className="ml-4 text-sm text-emerald-700 underline"
          >
            Manage API keys
          </a>
        </section>
      </div>
      {billing.portalEnabled && (
        <button
          className={button}
          disabled={pending}
          onClick={() => void open("portal")}
        >
          Manage subscriptions
        </button>
      )}
      <p className="text-sm text-zinc-500">
        Plans apply to your account. API access is purchased separately. Paid
        history is retained within storage limits; it is not permanent archival
        storage.
      </p>
    </div>
  );
}

export function StorageSummary() {
  const storage = useQuery(api.workspaceStorage.getUsage, {});
  if (!storage) return null;
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm">
      <span>
        {storage.tier === "workspace" ? "Workspace" : "Free scanner"} ·{" "}
        {storage.recordsUsed.toLocaleString()} /{" "}
        {storage.recordsLimit.toLocaleString()} stored scans
        {!storage.enabled
          ? " · Pilot retention"
          : storage.access === "read_only"
            ? " · Read-only"
            : storage.retentionDays
              ? ` · ${storage.retentionDays}-day history`
              : " · Persistent history"}
      </span>
      <a href="/billing" className="font-medium text-emerald-700">
        Plans and usage →
      </a>
    </div>
  );
}
