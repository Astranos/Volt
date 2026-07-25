import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  Check,
  Copy,
  Image as ImageIcon,
  ImageOff,
  Mic,
  RotateCcw,
  ScanBarcode,
  Trash2,
  Type,
} from "lucide-react";

import type { PhotoState, usePhotoUrls } from "../../lib/use-workspace";
import { usePhotoUrl } from "../../lib/use-workspace";
import {
  captureTypeLabels,
  formatBytes,
  formatClockTime,
  isPhotoPending,
  type CaptureType,
  type TimelineResult,
} from "../../lib/workspace";

const typeIcons: Record<CaptureType, typeof Type> = {
  text: Type,
  barcode: ScanBarcode,
  photo: ImageIcon,
  dictation: Mic,
};

export type TileActions = {
  isSelected: boolean;
  /** True once anything is selected, which is when the checkboxes stay put. */
  isSelecting: boolean;
  onToggleSelect: (result: TimelineResult) => void;
  onDelete: (result: TimelineResult) => void;
  onRestore: (result: TimelineResult) => void;
  onOpenPhoto: (result: TimelineResult) => void;
  copiedKey: string | null;
  onCopy: (key: string, value: string) => void;
};

export function CaptureTile({
  actions,
  resolvePhoto,
  result,
}: {
  actions: TileActions;
  resolvePhoto: ReturnType<typeof usePhotoUrls>;
  result: TimelineResult;
}) {
  return result.type === "photo" ? (
    <PhotoTile actions={actions} resolvePhoto={resolvePhoto} result={result} />
  ) : (
    <TextTile actions={actions} result={result} />
  );
}

function PhotoTile({
  actions,
  resolvePhoto,
  result,
}: {
  actions: TileActions;
  resolvePhoto: ReturnType<typeof usePhotoUrls>;
  result: TimelineResult;
}) {
  // Presigning every photo on mount would fire one action per thumbnail, so
  // tiles only ask for a URL once they are close to the viewport. A batch that
  // is still uploading has nothing to sign yet.
  const { ref, inView } = useInView<HTMLDivElement>();
  const pending = isPhotoPending(result);
  const ready = inView && !pending;
  const photo = usePhotoUrl(
    resolvePhoto,
    ready ? result.batchId : null,
    ready ? result.id : null,
  );
  const deleted = result.deliveryState === "deleted";

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={`group relative aspect-4/5 overflow-hidden rounded-[1rem] border bg-zinc-100 ${
        actions.isSelected
          ? "border-emerald-600 ring-2 ring-emerald-600/25"
          : "border-zinc-200"
      } ${deleted ? "opacity-60" : ""}`}
    >
      <PhotoSurface
        alt={`Capture from ${formatClockTime(result.createdAt)}`}
        pending={pending}
        photo={photo}
      />

      <button
        type="button"
        onClick={(event) => {
          // Modifier-click and any click while a selection is open pick the
          // tile instead of opening it.
          if (
            actions.isSelecting ||
            event.metaKey ||
            event.shiftKey ||
            event.ctrlKey
          ) {
            actions.onToggleSelect(result);
            return;
          }
          actions.onOpenPhoto(result);
        }}
        className="absolute inset-0 cursor-zoom-in"
        aria-label={actions.isSelecting ? "Select photo" : "Open photo"}
      />

      <SelectionDot
        isSelected={actions.isSelected}
        isSelecting={actions.isSelecting}
        onToggle={() => actions.onToggleSelect(result)}
      />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-zinc-950/75 to-transparent p-2.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
        <span className="text-[0.68rem] font-semibold text-white/90">
          {formatBytes(result.byteCount)}
        </span>
        <div className="pointer-events-auto flex gap-1">
          {deleted ? (
            <OverlayButton
              label="Restore photo"
              onClick={() => actions.onRestore(result)}
            >
              <RotateCcw size={13} />
            </OverlayButton>
          ) : (
            <OverlayButton
              label="Delete photo"
              onClick={() => actions.onDelete(result)}
            >
              <Trash2 size={13} />
            </OverlayButton>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export function PhotoSurface({
  alt,
  className = "size-full object-cover",
  pending = false,
  photo,
}: {
  alt: string;
  className?: string;
  /** The batch is still uploading, so there is nothing to sign yet. */
  pending?: boolean;
  photo: PhotoState;
}) {
  if (!pending && photo.status === "ready") {
    return (
      <img
        src={photo.url}
        alt={alt}
        // A tab left open past the five-minute presign shows a broken image
        // unless the URL is refreshed on the first failed load.
        onError={photo.retry}
        className={className}
      />
    );
  }
  return (
    // The minimums matter in the lightbox, where nothing else gives the
    // placeholder a size to fill.
    <div className="grid size-full min-h-32 min-w-32 place-items-center rounded-[1.2rem] bg-zinc-100">
      {pending ? (
        <span className="flex flex-col items-center gap-1.5 text-zinc-400">
          <span className="size-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-500" />
          <span className="text-[0.68rem] font-medium">Uploading</span>
        </span>
      ) : photo.status === "error" ? (
        <span className="flex flex-col items-center gap-1.5 text-zinc-400">
          <ImageOff size={18} />
          <span className="text-[0.68rem] font-medium">Unavailable</span>
        </span>
      ) : (
        <span className="size-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-500" />
      )}
    </div>
  );
}

function TextTile({
  actions,
  result,
}: {
  actions: TileActions;
  result: TimelineResult;
}) {
  const Icon = typeIcons[result.type] ?? Type;
  const value = result.value ?? "";
  const copyKey = `${result.batchId}/${result.id}`;
  const copied = actions.copiedKey === copyKey;
  const deleted = result.deliveryState === "deleted";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={`group relative flex flex-col justify-between gap-3 rounded-[1rem] border bg-white p-3.5 ${
        actions.isSelected
          ? "border-emerald-600 ring-2 ring-emerald-600/20"
          : "border-zinc-200"
      } ${deleted ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[0.6rem] bg-zinc-100 text-zinc-500">
          <Icon size={14} />
        </span>
        <p
          className={`min-w-0 flex-1 break-words text-sm leading-6 text-zinc-800 ${
            result.type === "barcode" ? "font-mono tracking-tight" : ""
          }`}
        >
          {value || (
            <span className="text-zinc-400">No recognized text</span>
          )}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-zinc-400">
          {result.format ?? captureTypeLabels[result.type]}
        </span>
        <div className="flex items-center gap-1 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          {value ? (
            <TileButton
              label={copied ? "Copied" : "Copy text"}
              onClick={() => actions.onCopy(copyKey, value)}
            >
              {copied ? (
                <Check size={13} className="text-emerald-600" />
              ) : (
                <Copy size={13} />
              )}
            </TileButton>
          ) : null}
          {deleted ? (
            <TileButton
              label="Restore capture"
              onClick={() => actions.onRestore(result)}
            >
              <RotateCcw size={13} />
            </TileButton>
          ) : (
            <TileButton
              label="Delete capture"
              onClick={() => actions.onDelete(result)}
            >
              <Trash2 size={13} />
            </TileButton>
          )}
        </div>
      </div>

      <SelectionDot
        isSelected={actions.isSelected}
        isSelecting={actions.isSelecting}
        onToggle={() => actions.onToggleSelect(result)}
      />
    </motion.div>
  );
}

function SelectionDot({
  isSelected,
  isSelecting,
  onToggle,
}: {
  isSelected: boolean;
  isSelecting: boolean;
  onToggle: () => void;
}) {
  // Hover is not a thing on a phone, so the checkbox stays visible on small
  // screens and for as long as a selection is in progress.
  const resting = isSelecting
    ? "border-zinc-400 bg-white/85 text-transparent backdrop-blur"
    : "border-zinc-300 bg-white/85 text-transparent backdrop-blur sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100";

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isSelected}
      aria-label={isSelected ? "Deselect capture" : "Select capture"}
      className={`absolute left-2 top-2 z-10 grid size-5 place-items-center rounded-full border transition ${
        isSelected
          ? "border-emerald-600 bg-emerald-600 text-white"
          : resting
      }`}
    >
      <Check size={12} strokeWidth={3} />
    </button>
  );
}

function TileButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid size-7 place-items-center rounded-[0.6rem] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
    >
      {children}
    </button>
  );
}

function OverlayButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid size-7 place-items-center rounded-[0.6rem] bg-white/90 text-zinc-700 backdrop-blur hover:bg-white hover:text-zinc-950"
    >
      {children}
    </button>
  );
}

function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true);
      },
      { rootMargin: "400px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [inView]);

  return { ref, inView };
}
