import { ArrowUpRight, ScanLine } from "lucide-react";

export function DashboardHome() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">
          Dashboard
        </h1>
        <p className="mt-1 text-sm leading-6 text-zinc-500">
          Review scanner results and export captures from your devices.
        </p>
      </header>
      <section aria-labelledby="dashboard-tools-heading">
        <h2
          id="dashboard-tools-heading"
          className="mb-3 text-sm font-semibold text-zinc-950"
        >
          Workspace tools
        </h2>
        <div className="grid gap-3">
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
        </div>
      </section>
    </div>
  );
}
