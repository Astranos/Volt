import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Images,
  Layers,
  ScanBarcode,
  Search,
  Smartphone,
  Trash2,
  RotateCcw,
  X,
} from "lucide-react";

import {
  useCopy,
  usePhotoUrls,
  useResultActions,
  useWorkspace,
} from "../../lib/use-workspace";
import {
  batchResults,
  captureTypeLabels,
  dayLabel,
  formatBytes,
  formatClockTime,
  formatRelativeTime,
  matchesFilter,
  matchesQuery,
  workspaceUsage,
  type CaptureBatch,
  type CaptureFilter,
  type TimelineResult,
} from "../../lib/workspace";
import { mobileAppDownloadUrl } from "../../site-chrome";
import { CaptureTile, type TileActions } from "./capture-tiles";
import { PhotoLightbox } from "./photo-lightbox";

type VisibleBatch = {
  batch: CaptureBatch;
  results: TimelineResult[];
};

type DaySection = {
  key: string;
  label: string;
  batches: VisibleBatch[];
};

export function WorkspaceView() {
  const { snapshot, isLoading, isEmpty } = useWorkspace();
  const resolvePhoto = usePhotoUrls();
  const { remove, restore } = useResultActions();
  const { copiedKey, copy } = useCopy();

  const [filter, setFilter] = useState<CaptureFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const usage = useMemo(() => workspaceUsage(snapshot), [snapshot]);
  const counts = useMemo(() => captureCounts(snapshot?.batches ?? []), [
    snapshot,
  ]);

  const sections = useMemo(
    () => visibleSections(snapshot?.batches ?? [], filter, query),
    [filter, query, snapshot],
  );

  const photos = useMemo(
    () =>
      sections
        .flatMap((section) => section.batches)
        .flatMap((entry) => entry.results)
        .filter((result) => result.type === "photo"),
    [sections],
  );

  // A photo that disappears from the filtered set must not leave the lightbox
  // pointing at nothing.
  useEffect(() => {
    if (lightboxIndex !== null && lightboxIndex >= photos.length) {
      setLightboxIndex(photos.length === 0 ? null : photos.length - 1);
    }
  }, [lightboxIndex, photos.length]);

  const selected = useMemo(
    () =>
      sections
        .flatMap((section) => section.batches)
        .flatMap((entry) => entry.results)
        .filter((result) => selectedIds.has(result.id)),
    [sections, selectedIds],
  );

  const toggleSelect = useCallback((result: TimelineResult) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(result.id)) next.delete(result.id);
      else next.add(result.id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Every mutation is a background write with no confirmation step, so a
  // failure has to say so rather than look like a no-op.
  const [error, setError] = useState<string | null>(null);
  const run = useCallback((action: Promise<unknown>, failure: string) => {
    void action.catch(() => setError(failure));
  }, []);

  const actionsFor = useCallback(
    (result: TimelineResult): TileActions => ({
      isSelected: selectedIds.has(result.id),
      isSelecting: selectedIds.size > 0,
      onToggleSelect: toggleSelect,
      onDelete: (target) =>
        run(remove([target]), "That capture could not be deleted."),
      onRestore: (target) =>
        run(restore([target]), "That capture could not be restored."),
      onOpenPhoto: (target) => {
        const position = photos.findIndex((photo) => photo.id === target.id);
        if (position >= 0) setLightboxIndex(position);
      },
      copiedKey,
      onCopy: (key, value) => void copy(key, value),
    }),
    [copiedKey, copy, photos, remove, restore, run, selectedIds, toggleSelect],
  );

  if (isLoading) return <WorkspaceSkeleton />;

  return (
    <>
      {error ? (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      ) : null}

      <StatStrip usage={usage} />

      <Toolbar
        counts={counts}
        filter={filter}
        onFilterChange={(next) => {
          setFilter(next);
          clearSelection();
        }}
        onQueryChange={setQuery}
        query={query}
      />

      {isEmpty ? (
        <FirstCaptureCard />
      ) : sections.length === 0 ? (
        <NoMatchesCard
          onReset={() => {
            setQuery("");
            setFilter("all");
          }}
        />
      ) : (
        <div className="mt-6 grid gap-10">
          {sections.map((section) => (
            <section key={section.key}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {section.label}
              </h2>
              <div className="grid gap-4">
                {section.batches.map((entry) => (
                  <BatchCard
                    key={entry.batch.id}
                    actionsFor={actionsFor}
                    entry={entry}
                    resolvePhoto={resolvePhoto}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <AnimatePresence>
        {selected.length > 0 ? (
          <SelectionBar
            onClear={clearSelection}
            onDelete={() => {
              run(remove(selected), "Those captures could not be deleted.");
              clearSelection();
            }}
            onRestore={() => {
              run(restore(selected), "Those captures could not be restored.");
              clearSelection();
            }}
            selected={selected}
          />
        ) : null}
      </AnimatePresence>

      {lightboxIndex !== null ? (
        <PhotoLightbox
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onDelete={(result) =>
            run(remove([result]), "That photo could not be deleted.")
          }
          onNavigate={setLightboxIndex}
          onRestore={(result) =>
            run(restore([result]), "That photo could not be restored.")
          }
          photos={photos}
          resolvePhoto={resolvePhoto}
        />
      ) : null}
    </>
  );
}

function BatchCard({
  actionsFor,
  entry,
  resolvePhoto,
}: {
  actionsFor: (result: TimelineResult) => TileActions;
  entry: VisibleBatch;
  resolvePhoto: ReturnType<typeof usePhotoUrls>;
}) {
  const photos = entry.results.filter((result) => result.type === "photo");
  const notes = entry.results.filter((result) => result.type !== "photo");
  const uploading = entry.batch.deliveryState === "uploading";

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden rounded-[1.35rem] border border-zinc-200 bg-white shadow-sm"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-zinc-200 bg-zinc-50/60 px-4 py-3">
        <div className="flex items-baseline gap-2.5">
          <h3 className="text-sm font-semibold text-zinc-950">
            {formatClockTime(entry.batch.createdAt)}
          </h3>
          <span className="text-xs text-zinc-500">
            {formatRelativeTime(entry.batch.createdAt)}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {uploading ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">
              <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
              Uploading
            </span>
          ) : null}
          <span>
            {entry.results.length}{" "}
            {entry.results.length === 1 ? "capture" : "captures"}
          </span>
        </div>
      </header>

      <div className="grid gap-4 p-4">
        {notes.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {notes.map((result) => (
              <CaptureTile
                key={result.id}
                actions={actionsFor(result)}
                resolvePhoto={resolvePhoto}
                result={result}
              />
            ))}
          </div>
        ) : null}

        {photos.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {photos.map((result) => (
              <CaptureTile
                key={result.id}
                actions={actionsFor(result)}
                resolvePhoto={resolvePhoto}
                result={result}
              />
            ))}
          </div>
        ) : null}
      </div>
    </motion.article>
  );
}

function StatStrip({
  usage,
}: {
  usage: ReturnType<typeof workspaceUsage>;
}) {
  const stats = [
    { icon: ScanBarcode, label: "Captures", value: String(usage.results) },
    { icon: Images, label: "Photos", value: String(usage.photos) },
    { icon: Layers, label: "Batches", value: String(usage.batches) },
    { icon: Smartphone, label: "Stored", value: formatBytes(usage.bytes) },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-[1.2rem] border border-zinc-200 bg-white p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {stat.label}
            </span>
            <stat.icon size={14} className="text-zinc-400" />
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}

type CaptureCounts = Record<CaptureFilter, number>;

function Toolbar({
  counts,
  filter,
  onFilterChange,
  onQueryChange,
  query,
}: {
  counts: CaptureCounts;
  filter: CaptureFilter;
  onFilterChange: (filter: CaptureFilter) => void;
  onQueryChange: (query: string) => void;
  query: string;
}) {
  const chips: CaptureFilter[] = ["all", "barcode", "text", "photo"];
  if (counts.dictation > 0) chips.push("dictation");
  if (counts.trash > 0) chips.push("trash");

  return (
    <div className="sticky top-16 z-30 -mx-4 mt-6 border-y border-zinc-200 bg-zinc-50/85 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-[0.85rem] border border-zinc-300 bg-white px-3 lg:max-w-sm">
          <Search size={16} className="shrink-0 text-zinc-400" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            aria-label="Search captures"
            placeholder="Search text, barcodes, and serials"
            className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400 [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              aria-label="Clear search"
              className="grid size-5 shrink-0 place-items-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <X size={13} />
            </button>
          ) : null}
        </label>

        <div
          role="group"
          aria-label="Filter captures by type"
          className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 pb-0.5"
        >
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => onFilterChange(chip)}
              aria-pressed={filter === chip}
              className={`inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[0.85rem] px-3 text-xs font-semibold transition ${
                filter === chip
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-600 hover:bg-zinc-200/70"
              }`}
            >
              {filterLabel(chip)}
              <span
                className={
                  filter === chip ? "text-white/60" : "text-zinc-400"
                }
              >
                {counts[chip]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function SelectionBar({
  onClear,
  onDelete,
  onRestore,
  selected,
}: {
  onClear: () => void;
  onDelete: () => void;
  onRestore: () => void;
  selected: TimelineResult[];
}) {
  const allDeleted = selected.every(
    (result) => result.deliveryState === "deleted",
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      role="status"
      className="fixed inset-x-0 bottom-5 z-40 mx-auto flex w-fit max-w-[calc(100vw-2rem)] items-center gap-2 rounded-[1.2rem] border border-white/10 bg-zinc-950 px-3 py-2.5 text-white shadow-2xl shadow-zinc-950/25"
    >
      <span className="px-1.5 text-sm font-semibold">
        {selected.length} selected
      </span>
      {allDeleted ? (
        <SelectionAction icon={RotateCcw} label="Restore" onClick={onRestore} />
      ) : (
        <SelectionAction icon={Trash2} label="Delete" onClick={onDelete} />
      )}
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className="grid size-8 place-items-center rounded-[0.7rem] text-zinc-400 hover:bg-white/10 hover:text-white"
      >
        <X size={15} />
      </button>
    </motion.div>
  );
}

function SelectionAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Trash2;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1.5 rounded-[0.7rem] bg-white px-3 text-xs font-semibold text-zinc-950 hover:bg-zinc-200"
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      className="mb-4 flex items-start justify-between gap-3 rounded-[1.2rem] border border-red-200 bg-red-50 px-4 py-3"
    >
      <p className="text-sm leading-6 text-red-800">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="grid size-6 shrink-0 place-items-center rounded-full text-red-500 hover:bg-red-100 hover:text-red-800"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function FirstCaptureCard() {
  return (
    <motion.div
      className="mt-6 overflow-hidden rounded-[1.35rem] border border-zinc-200 bg-white"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="grid gap-8 p-8 lg:grid-cols-[1fr_auto] lg:items-center lg:p-10">
        <div className="max-w-xl">
          <p className="text-sm font-semibold text-emerald-700">
            Nothing captured yet
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-zinc-950">
            Your workspace is ready and waiting for its first scan.
          </h2>
          <p className="mt-4 text-sm leading-7 text-zinc-600">
            Sign in to the Volt app on your iPhone with this same account, then
            scan a barcode, read a label, or shoot a listing photo. Captures
            land here as soon as the phone accepts them — no pairing, no QR
            code, and this page updates while you shoot.
          </p>
          <a
            href={mobileAppDownloadUrl}
            className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-[0.85rem] bg-zinc-950 px-5 text-sm font-semibold text-white hover:bg-zinc-800"
          >
            <Smartphone size={16} />
            Get the iPhone app
          </a>
        </div>
        <div className="hidden w-56 shrink-0 overflow-hidden rounded-[1.2rem] border border-zinc-200 lg:block">
          <img
            src="/assets/product/mobile-07-capture-results.png"
            alt="Capture results in the Volt iPhone app"
            className="w-full object-contain"
          />
        </div>
      </div>
    </motion.div>
  );
}

function NoMatchesCard({ onReset }: { onReset: () => void }) {
  return (
    <div className="mt-6 rounded-[1.35rem] border border-dashed border-zinc-300 bg-white/60 p-10 text-center">
      <h2 className="text-base font-semibold text-zinc-950">
        No captures match those filters.
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-600">
        Try a different search term, or clear the filters to see everything in
        the workspace.
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-5 inline-flex h-10 items-center justify-center rounded-[0.85rem] border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-800 hover:border-zinc-950"
      >
        Clear filters
      </button>
    </div>
  );
}

function WorkspaceSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-[5.5rem] animate-pulse rounded-[1.2rem] border border-zinc-200 bg-white"
          />
        ))}
      </div>
      <div className="mt-4 h-10 animate-pulse rounded-[0.85rem] bg-zinc-200/70" />
      {[0, 1].map((index) => (
        <div
          key={index}
          className="h-56 animate-pulse rounded-[1.35rem] border border-zinc-200 bg-white"
        />
      ))}
    </div>
  );
}

function filterLabel(filter: CaptureFilter): string {
  if (filter === "all") return "All";
  if (filter === "trash") return "Trash";
  return `${captureTypeLabels[filter]}s`;
}

function captureCounts(batches: CaptureBatch[]): CaptureCounts {
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

/**
 * Search matches on recognized text, but photos carry none. Keeping a matching
 * batch whole means searching a model number still surfaces the listing photos
 * that were shot alongside it.
 */
function visibleSections(
  batches: CaptureBatch[],
  filter: CaptureFilter,
  query: string,
): DaySection[] {
  const needle = query.trim();
  const visible: VisibleBatch[] = [];

  for (const batch of batches) {
    const results = batchResults(batch);
    if (needle && !results.some((result) => matchesQuery(result, needle))) {
      continue;
    }
    const kept = results.filter((result) => matchesFilter(result, filter));
    if (kept.length > 0) visible.push({ batch, results: kept });
  }

  const sections = new Map<string, DaySection>();
  for (const entry of visible) {
    const date = new Date(entry.batch.createdAt);
    const key = date.toDateString();
    const section = sections.get(key);
    if (section) section.batches.push(entry);
    else sections.set(key, { key, label: dayLabel(date), batches: [entry] });
  }
  return [...sections.values()];
}
