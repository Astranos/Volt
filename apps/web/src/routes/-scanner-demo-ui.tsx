import { useMemo, type RefObject } from "react";
import {
  Camera,
  Copy,
  Download,
  Image as ImageIcon,
  Images,
  type LucideIcon,
  Type,
} from "lucide-react";

import type { CaptureItem, DemoStatus, PhotoItem } from "./scanner-demo";

type PairingDialogProps = {
  copyPairingUrl: () => Promise<void>;
  onClose: () => void;
  qrDataUrl: string | null;
  status: DemoStatus;
  statusLabel: (status: DemoStatus) => string;
};

export function PairingDialog({
  copyPairingUrl,
  onClose,
  qrDataUrl,
  status,
  statusLabel,
}: PairingDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/45 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pairing-dialog-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-[1.35rem] border border-zinc-200 bg-white shadow-2xl shadow-zinc-950/20">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-4 py-3">
          <div>
            <h2 id="pairing-dialog-title" className="text-base font-semibold text-zinc-950">
              Pair Volt on iPhone
            </h2>
            <p className="mt-1 text-sm leading-5 text-zinc-600">
              Scan this QR from the Volt app. This window closes when the phone starts connecting.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-[0.65rem] border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 hover:border-zinc-950"
          >
            Close
          </button>
        </div>
        <div className="p-4">
          <div className="grid aspect-square place-items-center rounded-[0.95rem] border border-zinc-200 bg-zinc-50 p-3">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt="Volt scanner pairing QR code" className="h-full w-full object-contain" />
            ) : (
              <Camera size={42} className="text-zinc-300" />
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-zinc-500">{statusLabel(status)}</span>
            <button
              type="button"
              onClick={() => void copyPairingUrl()}
              disabled={!qrDataUrl}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-[0.75rem] border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-800 hover:border-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Copy size={15} />
              Copy pairing link
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StatusText({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Icon size={13} className="shrink-0" />
      <span className="shrink-0 uppercase">{label}</span>
      <span className="min-w-0 truncate font-semibold text-zinc-800">{value}</span>
    </span>
  );
}

function copyText(value: string) {
  if (!value) return Promise.resolve();
  return navigator.clipboard.writeText(value);
}

function downloadUrl(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || "volt-photo.jpg";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function downloadPhotos(photos: PhotoItem[]) {
  for (const [index, photo] of photos.entries()) {
    window.setTimeout(() => downloadUrl(photo.objectUrl, photo.filename), index * 120);
  }
}

export function ResultsPanel({
  captures,
  onReviewInputChange,
  reviewInputRef,
  reviewInputValue,
}: {
  captures: CaptureItem[];
  onReviewInputChange: (value: string) => void;
  reviewInputRef: RefObject<HTMLTextAreaElement | null>;
  reviewInputValue: string;
}) {
  const allCaptureText = useMemo(() => captures.map((capture) => capture.value).join("\n"), [captures]);

  return (
    <div className="min-w-0 rounded-[1.1rem] border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Type size={16} />
          Text and barcode
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">{captures.length}</span>
          <button
            type="button"
            onClick={() => void copyText(allCaptureText || reviewInputValue)}
            disabled={!allCaptureText && !reviewInputValue}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[0.75rem] border border-zinc-300 bg-white px-2.5 text-xs font-semibold text-zinc-800 hover:border-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Copy size={13} />
            Copy all
          </button>
        </div>
      </div>
      <div className="border-b border-zinc-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="review-test-input" className="text-xs font-semibold uppercase text-zinc-500">
            Review input
          </label>
          <button
            type="button"
            onClick={() => void copyText(reviewInputValue)}
            disabled={!reviewInputValue}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[0.75rem] border border-zinc-300 bg-white px-2.5 text-xs font-semibold text-zinc-800 hover:border-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Copy size={13} />
            Copy
          </button>
        </div>
        <textarea
          ref={reviewInputRef}
          id="review-test-input"
          value={reviewInputValue}
          onChange={(event) => onReviewInputChange(event.target.value)}
          placeholder="Scanned text, barcodes, and dictation appear here."
          className="mt-2 min-h-24 w-full resize-y rounded-[0.85rem] border border-zinc-300 bg-white px-3 py-2 text-sm leading-6 text-zinc-950 outline-none focus:border-zinc-950"
        />
      </div>
      <div className="max-h-[34rem] overflow-auto p-3">
        {captures.length === 0 ? (
          <EmptyState label="No scanner results yet" />
        ) : (
          <div className="space-y-3">
            {captures.map((capture) => (
              <article key={`${capture.id}:${capture.capturedAt}`} className="rounded-[0.95rem] border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium capitalize text-zinc-700">{capture.kind}</span>
                    <time dateTime={capture.capturedAt}>{new Date(capture.capturedAt).toLocaleTimeString()}</time>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copyText(capture.value)}
                    className="inline-flex h-7 items-center justify-center gap-1.5 rounded-[0.65rem] border border-zinc-300 bg-white px-2 text-xs font-semibold text-zinc-800 hover:border-zinc-950"
                  >
                    <Copy size={12} />
                    Copy
                  </button>
                </div>
                <p className="mt-2 break-words text-sm font-medium leading-6 text-zinc-950">{capture.value}</p>
                {capture.format ? <p className="mt-2 text-xs text-zinc-500">{capture.format}</p> : null}
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function PhotosPanel({ photos }: { photos: PhotoItem[] }) {
  const photoBatches = useMemo(() => {
    const batches = new Map<string, PhotoItem[]>();
    for (const photo of photos) {
      const batch = batches.get(photo.photoBatchId) ?? [];
      batch.push(photo);
      batches.set(photo.photoBatchId, batch);
    }
    return Array.from(batches, ([id, items]) => ({ id, items }));
  }, [photos]);

  return (
    <div className="min-w-0 rounded-[1.1rem] border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ImageIcon size={16} />
          Photo batches
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">{photos.length}</span>
          <button
            type="button"
            onClick={() => downloadPhotos(photos)}
            disabled={photos.length === 0}
            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[0.75rem] border border-zinc-300 bg-white px-2.5 text-xs font-semibold text-zinc-800 hover:border-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={13} />
            Download all
          </button>
        </div>
      </div>
      <div className="max-h-[34rem] overflow-auto p-3">
        {photos.length === 0 ? (
          <EmptyState label="No photos received yet" />
        ) : (
          <div className="space-y-4">
            {photoBatches.map((batch) => (
              <article key={batch.id} className="rounded-[0.95rem] border border-zinc-200 bg-zinc-50 p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-zinc-950">
                    <Images size={15} />
                    <span className="truncate">Batch {batch.id.slice(-6)}</span>
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <span>{batch.items.length} photo{batch.items.length === 1 ? "" : "s"}</span>
                    <button
                      type="button"
                      onClick={() => downloadPhotos(batch.items)}
                      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[0.75rem] border border-zinc-300 bg-white px-2.5 text-xs font-semibold text-zinc-800 hover:border-zinc-950"
                    >
                      <Download size={13} />
                      Download batch
                    </button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {batch.items.map((photo) => (
                    <article key={photo.id} className="min-w-0 overflow-hidden rounded-[0.95rem] border border-zinc-200 bg-white">
                      <img src={photo.objectUrl} alt={photo.filename} className="aspect-[4/3] w-full bg-zinc-100 object-contain" />
                      <div className="space-y-2 p-3 text-xs text-zinc-500">
                        <div className="truncate text-sm font-semibold text-zinc-950">{photo.filename}</div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>{formatBytes(photo.size)}</span>
                          {photo.width && photo.height ? <span>{photo.width} x {photo.height}</span> : null}
                          <time dateTime={photo.capturedAt}>{new Date(photo.capturedAt).toLocaleString()}</time>
                        </div>
                        <button
                          type="button"
                          onClick={() => downloadUrl(photo.objectUrl, photo.filename)}
                          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-[0.75rem] border border-zinc-300 bg-white px-2.5 text-xs font-semibold text-zinc-800 hover:border-zinc-950"
                        >
                          <Download size={13} />
                          Download
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="grid min-h-40 place-items-center rounded-[0.95rem] border border-dashed border-zinc-300 bg-zinc-50 px-4 text-center text-sm text-zinc-500">
      {label}
    </div>
  );
}
