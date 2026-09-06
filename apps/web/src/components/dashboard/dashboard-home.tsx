import type { ReactNode } from "react";
import { ArrowUpRight, Database, KeyRound, ScanLine } from "lucide-react";
import { CatalogActivity } from "../catalog/catalog-activity";

export function DashboardHome({
  activity = <CatalogActivity />,
}: {
  activity?: ReactNode;
}) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
          Dashboard / Activity
        </h1>
        <p className="mt-1 text-sm leading-6 text-zinc-500">
          Track catalog imports and open the tools you need for product research
          and scanner results.
        </p>
      </header>
      {activity}
      <section aria-labelledby="dashboard-tools-heading">
        <h2
          id="dashboard-tools-heading"
          className="mb-3 text-sm font-semibold text-zinc-950"
        >
          Workspace tools
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <a
            href="/scanner-results"
            className="group rounded-xl border border-zinc-200 bg-white p-5 shadow-sm hover:border-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <ScanLine aria-hidden="true" className="size-5 text-emerald-700" />
            <span className="mt-4 flex items-center justify-between gap-2 text-sm font-semibold text-zinc-950">
              Scanner results
              <ArrowUpRight
                aria-hidden="true"
                className="size-4 text-zinc-400 group-hover:text-emerald-600"
              />
            </span>
            <span className="mt-1 block text-xs leading-5 text-zinc-500">
              Review scans and photos sent from your devices, then search and
              export your captures.
            </span>
          </a>
          <a
            href="/catalog"
            className="group rounded-xl border border-zinc-200 bg-white p-5 shadow-sm hover:border-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <Database aria-hidden="true" className="size-5 text-emerald-700" />
            <span className="mt-4 flex items-center justify-between gap-2 text-sm font-semibold text-zinc-950">
              Product catalog
              <ArrowUpRight
                aria-hidden="true"
                className="size-4 text-zinc-400 group-hover:text-emerald-600"
              />
            </span>
            <span className="mt-1 block text-xs leading-5 text-zinc-500">
              Find products by title or identifier, compare specifications, and
              inspect source records.
            </span>
          </a>
          <a
            href="/api-keys"
            className="group rounded-xl border border-zinc-200 bg-white p-5 shadow-sm hover:border-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <KeyRound aria-hidden="true" className="size-5 text-emerald-700" />
            <span className="mt-4 flex items-center justify-between gap-2 text-sm font-semibold text-zinc-950">
              API keys
              <ArrowUpRight
                aria-hidden="true"
                className="size-4 text-zinc-400 group-hover:text-emerald-600"
              />
            </span>
            <span className="mt-1 block text-xs leading-5 text-zinc-500">
              Manage credentials for integrations that look up product data.
            </span>
          </a>
        </div>
      </section>
    </div>
  );
}
