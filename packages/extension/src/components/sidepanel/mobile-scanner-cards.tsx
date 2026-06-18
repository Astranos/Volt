import React from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  FolderOpen,
  ImagePlus,
  Loader2,
  Plus,
  RefreshCw,
  Scan,
  ScanLine,
  Smartphone,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import type { ScannerConnectionStatus } from "../../../../scanner-protocol/src";
import type { HydratedMobileScannerPhotoResult } from "../../domain/mobile-scanner-results";
import { cn } from "../../lib/utils";
import { ConnectionPill } from "./mobile-shared";
import { formatPhotoSize, type MobilePhoto } from "./mobile-photo-helpers";
import {
  formatRelativeTime,
  photoFromResult,
  type TimelineGroup,
} from "./mobile-scanner-timeline";

export function CompactScannerStatus({
  status,
  error,
  phoneCount,
  transferSummary,
  onAddPhone,
  onForceRestart,
  onDisconnect,
}: {
  status: ScannerConnectionStatus;
  error: string | null;
  phoneCount: number;
  transferSummary?: string | null;
  onAddPhone: () => void;
  onForceRestart: () => void;
  onDisconnect: () => void;
}) {
  const connected = status === "connected";
  const creating = status === "creating";
  const copy = connected
    ? `${phoneCount} phone${phoneCount === 1 ? "" : "s"} connected${transferSummary ? ` · ${transferSummary}` : ""}`
    : status === "waiting"
      ? "Pairing popup is ready for iPhone."
      : creating
        ? "Preparing mobile scanner session."
        : status === "error"
          ? (error ?? "Scanner session needs attention.")
          : "Open the pairing popup to add an iPhone.";

  return (
    <div className="sidepanel-scanner-card liquid-glass concentric-xl flex min-w-0 flex-col gap-3 px-3.5 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="sidepanel-scanner-icon liquid-glass-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-green-700 dark:text-green-300">
          <Smartphone className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="sidepanel-scanner-title text-[15px] font-bold leading-tight text-stone-900 dark:text-stone-50">
            Mobile Scanner
          </div>
          <div className="sidepanel-scanner-copy mt-1 text-xs font-medium leading-snug text-stone-500 dark:text-stone-400">
            {copy}
          </div>
        </div>
        <div className="shrink-0">
          <ConnectionPill status={status} error={error} />
        </div>
      </div>
      <div className="sidepanel-scanner-actions grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onAddPhone}
          className="sidepanel-scanner-action liquid-glass-soft inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-full px-3 text-xs font-bold text-stone-700 transition hover:text-stone-950 active:scale-[0.99] dark:text-stone-200 dark:hover:text-stone-50"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Add iPhone</span>
        </button>
        <button
          type="button"
          onClick={connected ? onDisconnect : onForceRestart}
          disabled={creating}
          className="sidepanel-scanner-action liquid-glass-soft inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-full px-3 text-xs font-bold text-stone-700 transition hover:text-stone-950 active:scale-[0.99] disabled:opacity-40 dark:text-stone-200 dark:hover:text-stone-50"
        >
          {connected ? (
            <X className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <RefreshCw className={cn("h-3.5 w-3.5 shrink-0", creating && "animate-spin")} />
          )}
          <span className="truncate">{connected ? "Disconnect" : "Restart"}</span>
        </button>
      </div>
    </div>
  );
}

export function LoadingHistory() {
  return (
    <div className="liquid-glass-soft concentric-lg flex items-center justify-center gap-2 px-4 py-8 text-xs font-semibold text-stone-500 dark:text-stone-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading results
    </div>
  );
}

export function EmptyHistory() {
  return (
    <div className="sidepanel-empty-history liquid-glass-soft concentric-lg flex flex-col items-center border border-dashed border-stone-300/70 px-4 py-9 text-center dark:border-stone-700/70">
      <div className="liquid-glass-soft mb-3 flex h-12 w-12 items-center justify-center rounded-full text-stone-400 dark:text-stone-500">
        <Scan className="h-5 w-5" />
      </div>
      <p className="text-sm font-semibold text-stone-700 dark:text-stone-200">
        No results yet
      </p>
      <p className="mt-1 max-w-[260px] text-xs text-stone-500 dark:text-stone-400">
        Text captures, barcodes, and fully received photos appear in this timeline.
      </p>
    </div>
  );
}

export function ScanCard({
  group,
  now,
  removing,
  onCopy,
  onDelete,
}: {
  group: Extract<TimelineGroup, { type: "scan" }>;
  now: number;
  removing: boolean;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const scan = group.entries[0];
  const isText = group.kind === "text";
  const Icon = isText ? Type : ScanLine;
  return (
    <div className={cn("liquid-glass-soft concentric-lg min-w-0 overflow-hidden px-3 py-3", removing && "volt-item-exit")}>
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", isText ? "bg-amber-100/80 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : "bg-green-100/80 text-green-700 dark:bg-green-500/15 dark:text-green-300")}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-stone-900 dark:text-stone-100">
              {isText ? "Text capture" : "Barcode"}
            </div>
            <div className="truncate text-[10px] font-medium text-stone-500 dark:text-stone-400">
              {formatRelativeTime(group.capturedAt, now)}
            </div>
          </div>
        </div>
        <button type="button" onClick={onDelete} className="flex h-7 w-7 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-50" aria-label="Delete result">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-stone-200/70 dark:bg-stone-800/70 dark:ring-stone-700/70">
        <div className={cn("text-[13px] font-semibold leading-snug text-stone-950 dark:text-stone-50", isText ? "line-clamp-4 break-words" : "break-all font-mono")}>
          {scan.value}
        </div>
        <button type="button" onClick={onCopy} className="mt-2 inline-flex h-7 items-center gap-1 rounded-full bg-stone-100 px-2.5 text-[11px] font-bold text-stone-700 transition hover:bg-stone-200 dark:bg-stone-700 dark:text-stone-100 dark:hover:bg-stone-600">
          <Copy className="h-3 w-3" />
          Copy
        </button>
      </div>
    </div>
  );
}

export function PhotoBatchCard({
  group,
  now,
  collapsed,
  removingIds,
  selectedPhotoIds,
  onToggleCollapse,
  onOpenBatchFolder,
  onDeleteBatch,
  onDeletePhoto,
  onCopyPhoto,
  onDownloadPhoto,
  onPreviewPhoto,
  onSendPhoto,
  onDragStart,
  onBatchDragStart,
  onHover,
  onToggleSelection,
}: {
  group: Extract<TimelineGroup, { type: "photo" }>;
  now: number;
  collapsed: boolean;
  removingIds: Set<string>;
  selectedPhotoIds: Set<string>;
  onToggleCollapse: () => void;
  onOpenBatchFolder: () => void;
  onDeleteBatch: () => void;
  onDeletePhoto: (photoId: string) => void;
  onCopyPhoto: (photo: MobilePhoto) => void;
  onDownloadPhoto: (photo: MobilePhoto) => void;
  onPreviewPhoto: (photo: MobilePhoto) => void;
  onSendPhoto: (photo: MobilePhoto) => void;
  onDragStart: (event: React.DragEvent, photo: MobilePhoto) => void;
  onBatchDragStart: (event: React.DragEvent) => void;
  onHover: () => void;
  onToggleSelection: (photoId: string, shiftKey: boolean) => void;
}) {
  const collapsedPreviewEntries = group.entries.slice(0, 4);
  const visibleEntries = collapsed ? collapsedPreviewEntries : group.entries;
  const count = group.entries.length;
  return (
    <div className="liquid-glass-soft concentric-lg min-w-0 overflow-hidden">
      <div className="flex min-w-0 items-center justify-between gap-2 px-3 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-100/80 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
            <ImagePlus className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-stone-900 dark:text-stone-100">
              {count === 1 ? "Photo batch" : `${count} photo batch`}
            </div>
            <div className="truncate text-[10px] font-medium text-stone-500 dark:text-stone-400">
              {formatRelativeTime(group.endAt, now)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onToggleCollapse} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-stone-100 px-2.5 text-[11px] font-bold text-stone-700 transition hover:bg-stone-200 dark:bg-stone-700 dark:text-stone-100 dark:hover:bg-stone-600" aria-label={collapsed ? "Expand photo batch" : "Collapse photo batch"}>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", collapsed && "-rotate-90")} />
            {collapsed ? (count > 1 ? `+${count - 1}` : "Show") : "Hide"}
          </button>
          <button type="button" onClick={onOpenBatchFolder} className="flex h-7 w-7 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-50" aria-label="Open photo batch folder">
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onDeleteBatch} className="flex h-7 w-7 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-50" aria-label="Delete photo batch">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {collapsed ? (
        <CollapsedPhotoBatchPreview
          entries={visibleEntries}
          totalCount={count}
          selectedPhotoIds={selectedPhotoIds}
          removingIds={removingIds}
          onDragStart={onBatchDragStart}
          onHover={onHover}
          onToggleCollapse={onToggleCollapse}
        />
      ) : (
        <div className="grid grid-cols-2 gap-2 px-3 pb-3 pt-2">
          {visibleEntries.map((entry) => {
            const photo = photoFromResult(entry);
            return (
              <PhotoTile
                key={entry.id}
                photo={photo}
                selected={selectedPhotoIds.has(entry.id)}
                exiting={removingIds.has(entry.id)}
                onDelete={() => onDeletePhoto(entry.id)}
                onCopy={() => onCopyPhoto(photo)}
                onDownload={() => onDownloadPhoto(photo)}
                onPreview={() => onPreviewPhoto(photo)}
                onSend={() => onSendPhoto(photo)}
                onDragStart={(event) => onDragStart(event, photo)}
                onHover={onHover}
                onToggleSelection={(shiftKey) => onToggleSelection(entry.id, shiftKey)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function CollapsedPhotoBatchPreview({
  entries,
  totalCount,
  selectedPhotoIds,
  removingIds,
  onDragStart,
  onHover,
  onToggleCollapse,
}: {
  entries: HydratedMobileScannerPhotoResult[];
  totalCount: number;
  selectedPhotoIds: Set<string>;
  removingIds: Set<string>;
  onDragStart: (event: React.DragEvent) => void;
  onHover: () => void;
  onToggleCollapse: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onMouseEnter={onHover}
      onPointerDown={onHover}
      className="group mx-3 mb-3 mt-2 cursor-grab rounded-lg bg-stone-50/70 p-1 ring-1 ring-stone-200/70 active:cursor-grabbing dark:bg-stone-800/55 dark:ring-stone-700/70"
      aria-label={`Drag ${totalCount} photo batch`}
    >
      <div className="grid grid-cols-4 gap-1">
        {entries.map((entry, index) => {
          const photo = photoFromResult(entry);
          const hiddenCount = totalCount - entries.length;
          const showOverflow = index === entries.length - 1 && hiddenCount > 0;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleCollapse();
              }}
              className={cn(
                "relative aspect-square min-w-0 overflow-hidden rounded-md bg-stone-100 ring-1 ring-inset transition dark:bg-stone-900",
                selectedPhotoIds.has(entry.id) ? "ring-green-500 dark:ring-green-300" : "ring-stone-200/80 dark:ring-stone-700",
                removingIds.has(entry.id) && "volt-item-exit",
              )}
              aria-label="Expand photo batch"
            >
              {photo.dataUrl ? (
                <img src={photo.dataUrl} alt={photo.name} className="h-full w-full object-cover" draggable={false} />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-stone-500 dark:text-stone-400">
                  <Download className="h-4 w-4" />
                </div>
              )}
              {showOverflow ? (
                <span className="absolute inset-0 flex items-center justify-center bg-stone-950/62 text-xs font-bold text-white">
                  +{hiddenCount}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="pointer-events-none mt-1.5 flex items-center justify-between px-1 text-[10px] font-semibold text-stone-500 dark:text-stone-400">
        <span>Drag batch</span>
        <span>{totalCount} photos</span>
      </div>
    </div>
  );
}

function PhotoTile({
  photo,
  selected,
  exiting,
  onDelete,
  onCopy,
  onDownload,
  onPreview,
  onSend,
  onDragStart,
  onHover,
  onToggleSelection,
}: {
  photo: MobilePhoto;
  selected: boolean;
  exiting: boolean;
  onDelete: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onPreview: () => void;
  onSend: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onHover: () => void;
  onToggleSelection: (shiftKey: boolean) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onMouseEnter={onHover}
      onPointerDown={onHover}
      onClick={(event) => onToggleSelection(event.shiftKey)}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-lg bg-stone-50 ring-1 transition dark:bg-stone-800/70",
        selected ? "ring-2 ring-green-500 dark:ring-green-300" : "ring-stone-200/70 dark:ring-stone-700/70",
        exiting && "volt-item-exit",
        "cursor-grab active:cursor-grabbing",
      )}
    >
      <span className={cn("absolute left-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full border text-white shadow-sm transition", selected ? "border-green-500 bg-green-500" : "border-white/80 bg-stone-950/30 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")} aria-hidden="true">
        {selected ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
      {photo.dataUrl ? (
        <img src={photo.dataUrl} alt={photo.name} className="pointer-events-none h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-stone-100 px-3 text-center text-stone-500 dark:bg-stone-900 dark:text-stone-300">
          <Download className="h-7 w-7" />
          <span className="text-[11px] font-semibold">Saved to Downloads</span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-stone-900/85 via-stone-900/35 to-transparent px-2 pb-1.5 pt-6 text-[10px] text-white">
        <div className="truncate font-semibold">{photo.name}</div>
        <div className="truncate text-white/75">
          {[photo.width && photo.height ? `${photo.width}x${photo.height}` : "", formatPhotoSize(photo.size)].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="absolute right-1 top-1 flex flex-col gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <PhotoActionButton onClick={onPreview} label="Preview photo">
          <Eye className="h-3 w-3" />
        </PhotoActionButton>
        <PhotoActionButton onClick={onSend} label="Send to active tab">
          <Upload className="h-3 w-3" />
        </PhotoActionButton>
        <PhotoActionButton onClick={onCopy} label="Copy photo">
          <Copy className="h-3 w-3" />
        </PhotoActionButton>
        <PhotoActionButton onClick={onDownload} label="Download photo">
          <Download className="h-3 w-3" />
        </PhotoActionButton>
        <PhotoActionButton onClick={onDelete} label="Delete photo" danger>
          <X className="h-3 w-3" />
        </PhotoActionButton>
      </div>
    </div>
  );
}

function PhotoActionButton({
  onClick,
  label,
  children,
  danger,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={label}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-full backdrop-blur-md transition",
        danger ? "bg-red-500/85 text-white hover:bg-red-500" : "bg-white/85 text-stone-900 hover:bg-white",
      )}
    >
      {children}
    </button>
  );
}

export function UndoDeleteToast({
  label,
  onUndo,
}: {
  label: string;
  onUndo: () => void;
}) {
  return (
    <div className="absolute inset-x-3 bottom-3 z-20 flex items-center justify-between gap-3 rounded-lg bg-stone-950 px-3 py-2 text-xs font-semibold text-white shadow-lg">
      <span className="truncate">{label}</span>
      <button
        type="button"
        onClick={onUndo}
        className="rounded-md bg-white px-2 py-1 text-xs font-bold text-stone-950"
      >
        Undo
      </button>
    </div>
  );
}

export function PhotoPreviewDialog({
  photo,
  onClose,
  onCopy,
  onDownload,
}: {
  photo: MobilePhoto;
  onClose: () => void;
  onCopy: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-stone-950/92 p-3 text-white backdrop-blur-md">
      <div className="mb-3 flex flex-none items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{photo.name}</div>
          <div className="truncate text-xs text-white/60">
            {[photo.width && photo.height ? `${photo.width}x${photo.height}` : "", formatPhotoSize(photo.size)].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={onCopy} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20" aria-label="Copy photo">
            <Copy className="h-4 w-4" />
          </button>
          <button type="button" onClick={onDownload} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20" aria-label="Download photo">
            <Download className="h-4 w-4" />
          </button>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-stone-950 transition hover:bg-stone-200" aria-label="Close preview">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black">
        {photo.dataUrl ? (
          <img src={photo.dataUrl} alt={photo.name} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="text-sm font-semibold text-white/70">Preview unavailable</div>
        )}
      </div>
    </div>
  );
}
