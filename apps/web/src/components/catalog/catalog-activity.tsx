import { Component, useEffect, useState, type ReactNode } from "react";
import type { FunctionReturnType } from "convex/server";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";

type Activity = FunctionReturnType<typeof api.catalogActivity.summary>;
type ActivityDays = 7 | 30;
const dayMs = 86_400_000;
const dayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const timeFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });

export function utcDayStart(timestamp: number): number {
  return Math.floor(timestamp / dayMs) * dayMs;
}

export function isTrackedDay(dayStart: number, trackingStartedAt: number | null): boolean {
  return trackingStartedAt !== null && dayStart >= utcDayStart(trackingStartedAt);
}

export function CatalogActivity() {
  const [attempt, setAttempt] = useState(0);
  return (
    <CatalogActivityBoundary key={attempt} retry={() => setAttempt((value) => value + 1)}>
      <ConnectedActivity />
    </CatalogActivityBoundary>
  );
}

function ConnectedActivity() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [days, setDays] = useState<ActivityDays>(7);
  const [endDay, setEndDay] = useState(() => utcDayStart(Date.now()));
  useEffect(() => {
    const timer = window.setTimeout(() => setEndDay(utcDayStart(Date.now())), Math.max(1, endDay + dayMs - Date.now()));
    return () => window.clearTimeout(timer);
  }, [endDay]);
  const data = useQuery(api.catalogActivity.summary, isAuthenticated ? { days, endDay } : "skip");
  if (!isAuthenticated && !isLoading) return null;
  return <CatalogActivityContent data={data} days={days} onDaysChange={setDays} />;
}

export function CatalogActivityContent({ data, days, onDaysChange }: {
  data: Activity | undefined;
  days: ActivityDays;
  onDaysChange: (days: ActivityDays) => void;
}) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const lastPoint = data?.points.at(-1);
  const active = data?.points.find((point) => point.dayStart === selectedDay) ?? lastPoint;
  const maximum = Math.max(1, ...(data?.points.map((point) => point.inserted + point.refreshed) ?? []));
  const hasTracking = data !== undefined && data.trackingStartedAt !== null;

  return (
    <section aria-labelledby="catalog-activity-heading" className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="catalog-activity-heading" className="text-sm font-semibold text-zinc-950">Catalog activity</h2>
          <p className="mt-1 text-xs text-zinc-500">Daily imports across the catalog, in UTC.</p>
        </div>
        <div role="group" aria-label="Activity period" className="flex gap-1 rounded-lg bg-zinc-100 p-1">
          {([7, 30] as const).map((period) => (
            <button
              key={period}
              type="button"
              aria-pressed={days === period}
              onClick={() => onDaysChange(period)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${days === period
                ? "bg-white text-zinc-950 shadow-sm"
                : "text-zinc-500 hover:text-zinc-900"}`}
            >
              {period} days
            </button>
          ))}
        </div>
      </div>
      {data === undefined ? (
        <p role="status" className="py-8 text-center text-sm text-zinc-500">Loading catalog activity</p>
      ) : !hasTracking ? (
        <div className="py-7 text-center">
          <p className="text-sm font-semibold text-zinc-800">Activity tracking starts with the next import</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">Earlier import history is unavailable. Existing products are still available in the catalog.</p>
        </div>
      ) : (
        <>
          <dl className="mt-5 grid grid-cols-3 gap-3">
            {[{ label: "New products", value: data.totals.inserted }, { label: "Refreshes", value: data.totals.refreshed }, { label: "Source links added", value: data.totals.sourcesAdded }].map(({ label, value }) => (
              <div key={label}>
                <dt className="text-[0.68rem] text-zinc-500">{label}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums text-zinc-950">{value.toLocaleString("en-US")}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.68rem] text-zinc-500">
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-emerald-500" />New products</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-zinc-400" />Refreshes</span>
            <span>Repeat imports count as refreshes.</span>
          </div>
          <div className="mt-4 flex h-28 items-stretch gap-1 border-b border-zinc-200" role="group" aria-label="Daily catalog activity. Select a day for details.">
            {data.points.map((point) => {
              const tracked = isTrackedDay(point.dayStart, data.trackingStartedAt);
              const description = tracked
                ? `${dayFormatter.format(point.dayStart)} UTC: ${point.inserted} new products, ${point.refreshed} refreshes, ${point.sourcesAdded} source links added, ${point.batches} import batches`
                : `${dayFormatter.format(point.dayStart)} UTC: history unavailable`;
              return (
                <button
                  key={point.dayStart}
                  type="button"
                  aria-label={description}
                  title={description}
                  aria-pressed={active?.dayStart === point.dayStart}
                  onClick={() => setSelectedDay(point.dayStart)}
                  className={`flex min-w-0 flex-1 flex-col justify-end rounded-t-sm px-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${active?.dayStart === point.dayStart
                    ? "bg-emerald-50"
                    : "hover:bg-zinc-50"}`}
                >
                  {tracked ? (
                    <>
                      <span aria-hidden="true" className="block w-full bg-zinc-400" style={{ height: `${point.refreshed / maximum * 100}%` }} />
                      <span aria-hidden="true" className="block w-full bg-emerald-500" style={{ height: `${point.inserted / maximum * 100}%` }} />
                      {point.inserted + point.refreshed === 0 ? <span aria-hidden="true" className="h-0.5 w-full bg-zinc-200" /> : null}
                    </>
                  ) : <span aria-hidden="true" className="h-2 w-full rounded-t border border-dashed border-zinc-300" />}
                </button>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[0.65rem] text-zinc-400">
            <span>{data.points[0] ? dayFormatter.format(data.points[0].dayStart) : ""}</span>
            <span>{lastPoint ? dayFormatter.format(lastPoint.dayStart) : ""}</span>
          </div>
          <p aria-live="polite" className="mt-3 min-h-8 text-xs leading-5 text-zinc-600">
            {active ? (
              <>
                {dayFormatter.format(active.dayStart)} UTC: {isTrackedDay(active.dayStart, data.trackingStartedAt)
                  ? `${active.inserted} new products · ${active.refreshed} refreshes · ${active.sourcesAdded} source links · ${active.batches} batches`
                  : "History unavailable before tracking began."}
              </>
            ) : "No daily activity available."}
          </p>
          <p className="mt-2 text-[0.68rem] leading-5 text-zinc-500">
            {data.trackingStartedAt !== null ? `Counts begin ${timeFormatter.format(data.trackingStartedAt)} UTC. Earlier dates are unavailable, not zero.` : ""}
            {data.lastIngestAt !== null ? ` Last import ${timeFormatter.format(data.lastIngestAt)} UTC.` : ""}
          </p>
          <details className="mt-3 border-t border-zinc-100 pt-3">
            <summary className="cursor-pointer text-xs font-semibold text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">View daily counts</summary>
            <div className="mt-3 max-h-64 overflow-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <caption className="sr-only">Daily catalog imports in UTC. Unavailable means tracking had not started.</caption>
                <thead>
                  <tr>
                    {["Day UTC", "New", "Refreshes", "Sources", "Batches"].map((label) => (
                      <th key={label} scope="col" className="p-2 font-semibold text-zinc-600">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.points.map((point) => (
                    <tr key={point.dayStart} className="border-t border-zinc-100">
                      <th scope="row" className="whitespace-nowrap p-2 font-medium text-zinc-600">{dayFormatter.format(point.dayStart)}</th>
                      {isTrackedDay(point.dayStart, data.trackingStartedAt)
                        ? [point.inserted, point.refreshed, point.sourcesAdded, point.batches].map((value, index) => (
                          <td key={index} className="p-2 text-zinc-700">{value}</td>
                        ))
                        : <td colSpan={4} className="p-2 text-zinc-400">Unavailable</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

export class CatalogActivityBoundary extends Component<{ children: ReactNode; retry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <CatalogActivityError retry={this.props.retry} /> : this.props.children;
  }
}

export function CatalogActivityError({ retry }: { retry: () => void }) {
  return (
    <section aria-label="Catalog activity" className="rounded-2xl border border-zinc-200 bg-white p-5">
      <p className="text-sm font-semibold text-zinc-800">Activity is temporarily unavailable</p>
      <p className="mt-1 text-xs text-zinc-500">You can still search and compare products in the catalog.</p>
      <button
        type="button"
        onClick={retry}
        className="mt-3 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        Retry activity
      </button>
    </section>
  );
}
