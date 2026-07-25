import { useCallback, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";

import { usePhotoUrl, type usePhotoUrls } from "../../lib/use-workspace";
import {
  formatBytes,
  formatClockTime,
  isPhotoPending,
  type TimelineResult,
} from "../../lib/workspace";
import { PhotoSurface } from "./capture-tiles";

export function PhotoLightbox({
  index,
  onClose,
  onDelete,
  onNavigate,
  onRestore,
  photos,
  resolvePhoto,
}: {
  index: number;
  onClose: () => void;
  onDelete: (result: TimelineResult) => void;
  onNavigate: (index: number) => void;
  onRestore: (result: TimelineResult) => void;
  photos: TimelineResult[];
  resolvePhoto: ReturnType<typeof usePhotoUrls>;
}) {
  const current = photos[index];
  const pending = current ? isPhotoPending(current) : false;
  const photo = usePhotoUrl(
    resolvePhoto,
    current && !pending ? current.batchId : null,
    current && !pending ? current.id : null,
  );
  const dialog = useRef<HTMLDivElement | null>(null);

  const step = useCallback(
    (delta: number) => {
      if (photos.length === 0) return;
      onNavigate((index + delta + photos.length) % photos.length);
    },
    [index, onNavigate, photos.length],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, step]);

  // The lightbox owns the viewport, and the keyboard, while it is open. Moving
  // focus in and handing it back on close keeps arrow keys working without
  // stranding a keyboard user behind the overlay.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  if (!current) return null;
  const deleted = current.deliveryState === "deleted";

  return (
    <AnimatePresence>
      <motion.div
        ref={dialog}
        tabIndex={-1}
        className="fixed inset-0 z-50 flex flex-col bg-zinc-950/92 outline-none backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        role="dialog"
        aria-modal="true"
        aria-label="Capture photo"
      >
        <header className="flex items-center justify-between gap-4 px-4 py-3.5 text-white sm:px-6">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {formatClockTime(current.createdAt)}
            </p>
            <p className="truncate text-xs text-zinc-400">
              {formatBytes(current.byteCount)} · {index + 1} of {photos.length}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <LightboxAction
              disabled={photo.status !== "ready"}
              label="Open original"
              onClick={() => {
                if (photo.url) window.open(photo.url, "_blank", "noopener");
              }}
            >
              <Download size={16} />
            </LightboxAction>
            {deleted ? (
              <LightboxAction
                label="Restore photo"
                onClick={() => onRestore(current)}
              >
                <RotateCcw size={16} />
              </LightboxAction>
            ) : (
              <LightboxAction
                label="Delete photo"
                onClick={() => onDelete(current)}
              >
                <Trash2 size={16} />
              </LightboxAction>
            )}
            <LightboxAction label="Close" onClick={onClose}>
              <X size={16} />
            </LightboxAction>
          </div>
        </header>

        <div
          className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-16"
          // Clicking the surround, but not the photo itself, dismisses.
          onClick={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          {photos.length > 1 ? (
            <LightboxArrow side="left" onClick={() => step(-1)}>
              <ChevronLeft size={20} />
            </LightboxArrow>
          ) : null}

          <motion.div
            key={current.id}
            className="flex max-h-full max-w-5xl items-center justify-center overflow-hidden rounded-[1.2rem]"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <PhotoSurface
              alt="Capture photo"
              className="max-h-[78vh] w-auto max-w-full object-contain"
              pending={pending}
              photo={photo}
            />
          </motion.div>

          {photos.length > 1 ? (
            <LightboxArrow side="right" onClick={() => step(1)}>
              <ChevronRight size={20} />
            </LightboxArrow>
          ) : null}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function LightboxAction({
  children,
  disabled = false,
  label,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid size-9 place-items-center rounded-[0.7rem] border border-white/15 text-zinc-300 hover:border-white/40 hover:text-white disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function LightboxArrow({
  children,
  onClick,
  side,
}: {
  children: React.ReactNode;
  onClick: () => void;
  side: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous photo" : "Next photo"}
      className={`absolute top-1/2 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20 ${
        side === "left" ? "left-2 sm:left-5" : "right-2 sm:right-5"
      }`}
    >
      {children}
    </button>
  );
}
