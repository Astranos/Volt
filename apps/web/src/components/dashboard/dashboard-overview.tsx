import {
  ArrowDownToLine,
  ArrowUpRight,
  CalendarDays,
  Smartphone,
} from "lucide-react";
import { mobileAppDownloadUrl } from "../../site-chrome";
import { captureActivity } from "../../lib/dashboard";
import type { CaptureBatch } from "../../lib/workspace";

export function DashboardHeading({
  onExport,
  exportCount,
}: {
  onExport: () => void;
  exportCount: number;
}) {
  return (
    <header className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
          Your workspace
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">
          Dashboard
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          Everything you capture, together in one place.
        </p>
      </div>
      <button
        type="button"
        disabled={exportCount === 0}
        onClick={onExport}
        className="inline-flex h-10 w-fit items-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ArrowDownToLine size={15} />
        Export CSV
        <span className="sr-only"> of {exportCount} visible captures</span>
      </button>
    </header>
  );
}

export function DashboardOverview({ batches }: { batches: CaptureBatch[] }) {
  const days = captureActivity(batches);
  const weekCount = days.reduce((total, day) => total + day.count, 0);
  const maxCount = Math.max(1, ...days.map((day) => day.count));
  return (
    <div className="mt-5 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <section
        aria-label="Capture activity over the last seven days"
        className="rounded-2xl border border-zinc-200 bg-white p-5"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">
              Capture activity
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              {weekCount} {weekCount === 1 ? "capture" : "captures"} over the
              last 7 days
            </p>
          </div>
          <CalendarDays size={17} className="text-zinc-400" />
        </div>
        {batches.length >= 100 ? (
          <p className="mt-2 text-xs text-zinc-500">
            Activity from your 100 most recent batches.
          </p>
        ) : null}
        <div className="mt-5 flex h-28 items-end gap-3 sm:gap-5">
          {days.map((day, index) => (
            <div
              key={day.key}
              className="flex min-w-0 flex-1 flex-col items-center gap-2"
            >
              <span className="text-[10px] font-medium text-zinc-500">
                {day.count}
              </span>
              <div
                className={`w-full max-w-12 rounded-t-md ${index === 6 ? "bg-emerald-500" : "bg-emerald-100"}`}
                style={{
                  height: `${Math.max(3, (day.count / maxCount) * 58)}px`,
                }}
              />
              <span className="text-[10px] text-zinc-500">
                {index === 6 ? "Today" : day.label}
              </span>
            </div>
          ))}
        </div>
      </section>
      <section className="flex flex-col justify-between rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
        <div>
          <span className="grid size-9 place-items-center rounded-xl bg-white text-emerald-700">
            <Smartphone size={18} />
          </span>
          <h2 className="mt-3 text-base font-semibold text-zinc-950">
            Keep your desk and phone connected
          </h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-zinc-600">
            Capture in the Volt iPhone app with the same account. Your barcodes,
            text, and photos appear here automatically.
          </p>
        </div>
        <a
          href={mobileAppDownloadUrl}
          className="mt-4 inline-flex w-fit items-center gap-2 text-sm font-semibold text-emerald-800 hover:text-emerald-950"
        >
          Get the iPhone app
          <ArrowUpRight size={15} />
        </a>
      </section>
    </div>
  );
}
