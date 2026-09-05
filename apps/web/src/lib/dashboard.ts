import {
  batchResults,
  dayLabel,
  matchesFilter,
  matchesQuery,
  type CaptureBatch,
  type CaptureFilter,
  type TimelineResult,
} from "./workspace";

export type VisibleBatch = { batch: CaptureBatch; results: TimelineResult[] };
export type DaySection = {
  key: string;
  label: string;
  batches: VisibleBatch[];
};
export type CaptureCounts = Record<CaptureFilter, number>;

export function captureCounts(batches: CaptureBatch[]): CaptureCounts {
  const counts: CaptureCounts = {
    all: 0,
    text: 0,
    barcode: 0,
    photo: 0,
    dictation: 0,
    trash: 0,
  };
  for (const batch of batches) {
    for (const result of batch.results) {
      if (result.deliveryState === "deleted") counts.trash += 1;
      else {
        counts.all += 1;
        counts[result.type] += 1;
      }
    }
  }
  return counts;
}

/** Keep a matching batch together so its photos accompany recognized text. */
export function visibleSections(
  batches: CaptureBatch[],
  filter: CaptureFilter,
  query: string,
): DaySection[] {
  const sections = new Map<string, DaySection>();
  const sorted = [...batches].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  for (const batch of sorted) {
    const results = batchResults(batch);
    const searchable = results.filter((result) =>
      filter === "trash"
        ? result.deliveryState === "deleted"
        : result.deliveryState !== "deleted",
    );
    if (
      query.trim() &&
      !searchable.some((result) => matchesQuery(result, query))
    )
      continue;
    const kept = results.filter((result) => matchesFilter(result, filter));
    if (kept.length === 0) continue;
    const date = new Date(batch.createdAt);
    const key = date.toDateString();
    const entry = { batch, results: kept };
    const section = sections.get(key);
    if (section) section.batches.push(entry);
    else sections.set(key, { key, label: dayLabel(date), batches: [entry] });
  }
  return [...sections.values()];
}

export function captureActivity(batches: CaptureBatch[], now = new Date()) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - 6 + index);
    return {
      key: date.toDateString(),
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      count: 0,
    };
  });
  for (const batch of batches) {
    for (const result of batch.results) {
      if (result.deliveryState === "deleted") continue;
      const day = days.find(
        (entry) => entry.key === new Date(result.createdAt).toDateString(),
      );
      if (day) day.count += 1;
    }
  }
  return days;
}

/** Quote every field and neutralize spreadsheet formulas, including leading whitespace. */
function csvCell(value: string | number): string {
  const text = String(value);
  const safe =
    /^\s*[=+@-]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function capturesCsv(results: TimelineResult[]): string {
  const rows: (string | number)[][] = [
    [
      "Capture ID",
      "Batch ID",
      "Type",
      "Value",
      "Format",
      "Created at",
      "Status",
      "Bytes",
    ],
  ];
  for (const result of results)
    rows.push([
      result.id,
      result.batchId,
      result.type,
      result.value ?? "",
      result.format ?? "",
      result.createdAt,
      result.deliveryState,
      result.byteCount,
    ]);
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
