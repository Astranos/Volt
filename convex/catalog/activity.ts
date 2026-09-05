import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { UpsertStats } from "./store";

export const UTC_DAY_MS = 86_400_000;

export function utcDayStart(timestamp: number): number {
  return Math.floor(timestamp / UTC_DAY_MS) * UTC_DAY_MS;
}

type ActivityCounts = Pick<
  Doc<"catalogActivityDays">,
  "inserted" | "refreshed" | "sourcesAdded" | "batches"
>;

function emptyCounts(): ActivityCounts {
  return { inserted: 0, refreshed: 0, sourcesAdded: 0, batches: 0 };
}

export async function recordCatalogActivity(
  ctx: MutationCtx,
  stats: UpsertStats,
  timestamp: number,
): Promise<void> {
  if (stats.inserted + stats.updated + stats.sourcesAdded === 0) return;
  const dayStart = utcDayStart(timestamp);
  const existing = await ctx.db
    .query("catalogActivityDays")
    .withIndex("by_dayStart", (q) => q.eq("dayStart", dayStart))
    .unique();
  const previous = existing ?? emptyCounts();
  const counts = {
    inserted: previous.inserted + stats.inserted,
    refreshed: previous.refreshed + stats.updated,
    sourcesAdded: previous.sourcesAdded + stats.sourcesAdded,
    batches: previous.batches + 1,
    firstIngestAt: Math.min(existing?.firstIngestAt ?? timestamp, timestamp),
    lastIngestAt: Math.max(existing?.lastIngestAt ?? timestamp, timestamp),
  };
  if (existing) {
    await ctx.db.patch(existing._id, counts);
  } else {
    await ctx.db.insert("catalogActivityDays", { dayStart, ...counts });
  }
}

export async function loadCatalogActivity(
  ctx: QueryCtx,
  args: { days: 7 | 30; endDay: number },
) {
  const start = args.endDay - (args.days - 1) * UTC_DAY_MS;
  const [rows, earliest, latest] = await Promise.all([
    ctx.db.query("catalogActivityDays")
      .withIndex("by_dayStart", (q) => q.gte("dayStart", start).lte("dayStart", args.endDay))
      .take(args.days),
    ctx.db.query("catalogActivityDays").withIndex("by_dayStart").order("asc").first(),
    ctx.db.query("catalogActivityDays").withIndex("by_dayStart").order("desc").first(),
  ]);
  const byDay = new Map(rows.map((row) => [row.dayStart, row]));
  const totals = emptyCounts();
  const points = Array.from({ length: args.days }, (_, index) => {
    const dayStart = start + index * UTC_DAY_MS;
    const row = byDay.get(dayStart) ?? emptyCounts();
    const counts = {
      inserted: row.inserted,
      refreshed: row.refreshed,
      sourcesAdded: row.sourcesAdded,
      batches: row.batches,
    };
    totals.inserted += counts.inserted;
    totals.refreshed += counts.refreshed;
    totals.sourcesAdded += counts.sourcesAdded;
    totals.batches += counts.batches;
    return { dayStart, ...counts };
  });
  return {
    days: args.days,
    trackingStartedAt: earliest?.firstIngestAt ?? null,
    lastIngestAt: latest?.lastIngestAt ?? null,
    points,
    totals,
  };
}
