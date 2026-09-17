import { Button } from "@base-ui/react/button";
import { Dialog } from "@base-ui/react/dialog";
import { ScrollArea } from "@base-ui/react/scroll-area";
import { ChevronLeft, ChevronRight, ImageOff, Maximize2, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { isPhotoDrag, nextPhoto, swipeDirection, type Point } from "./gallery";
import "./photo-viewer.css";
import "./thumbnail-scroll.css";

export function ProductGallery({
  images,
  title,
}: {
  images: string[];
  title: string;
}) {
  const [index, setIndex] = useState(0);
  const [enlarged, setEnlarged] = useState(false);
  const photoButton = useRef<HTMLButtonElement>(null);
  const suppressPhotoClick = useRef(false);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const mainStart = useRef<Point | null>(null);
  const stripStart = useRef<Point | null>(null);
  const suppressClickUntil = useRef(0);
  const selected = Math.min(index, Math.max(0, images.length - 1));
  const image = images[selected];
  const move = (direction: number) =>
    setIndex((value) => nextPhoto(value, direction, images.length));
  const startPhoto = (event: PointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0) {
      mainStart.current = null;
      suppressPhotoClick.current = true;
      return;
    }
    suppressPhotoClick.current = false;
    mainStart.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const trackPhoto = (event: PointerEvent<HTMLElement>) => {
    if (mainStart.current && isPhotoDrag(mainStart.current, { x: event.clientX, y: event.clientY }))
      suppressPhotoClick.current = true;
  };
  const finishPhoto = (event: PointerEvent<HTMLElement>) => {
    trackPhoto(event);
    if (!mainStart.current) return;
    const direction = swipeDirection(mainStart.current, { x: event.clientX, y: event.clientY });
    mainStart.current = null;
    if (direction) move(direction);
  };
  const cancelPhoto = () => {
    mainStart.current = null;
    suppressPhotoClick.current = true;
  };
  const finishStrip = (point: Point) => {
    if (!stripStart.current) return;
    const direction = swipeDirection(stripStart.current, point);
    const moved =
      Math.hypot(
        point.x - stripStart.current.x,
        point.y - stripStart.current.y,
      ) > 10;
    stripStart.current = null;
    if (moved) suppressClickUntil.current = Date.now() + 500;
    if (direction) move(direction);
  };
  useEffect(() => {
    const thumbnail = strip.current?.querySelector<HTMLButtonElement>(
      '[aria-pressed="true"]',
    );
    if (thumbnail && strip.current) {
      const left = thumbnail.offsetLeft;
      const right = left + thumbnail.offsetWidth;
      if (left < strip.current.scrollLeft) strip.current.scrollLeft = left;
      else if (right > strip.current.scrollLeft + strip.current.clientWidth)
        strip.current.scrollLeft = right - strip.current.clientWidth;
    }
  }, [selected]);
  return (
    <section
      className="product-gallery"
      aria-label="Product photos"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          move(event.key === "ArrowRight" ? 1 : -1);
        }
      }}
    >
      <button
        type="button"
        ref={photoButton}
        className="gallery-square gallery-enlarge"
        aria-label="Enlarge product photo"
        aria-haspopup="dialog"
        disabled={!image || image === failedImage}
        onPointerDown={startPhoto}
        onPointerMove={trackPhoto}
        onPointerUp={finishPhoto}
        onPointerCancel={cancelPhoto}
        onClick={(event) => {
          if (event.detail === 0 || !suppressPhotoClick.current) setEnlarged(true);
        }}
      >
        {image && image !== failedImage ? (
          <img
            src={image}
            alt={`${title}, photo ${selected + 1}`}
            draggable={false}
            onError={() => setFailedImage(image)}
          />
        ) : (
          <div className="gallery-placeholder">
            <ImageOff size={40} />
            <span>Photo unavailable</span>
          </div>
        )}
        {image && image !== failedImage && <span className="gallery-enlarge-icon" aria-hidden="true"><Maximize2 size={22} /></span>}
      </button>
      <Dialog.Root open={enlarged} onOpenChange={setEnlarged}>
        <Dialog.Portal>
          <Dialog.Backdrop className="photo-viewer-backdrop" />
          <Dialog.Popup className="photo-viewer" finalFocus={photoButton}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                event.stopPropagation();
                move(event.key === "ArrowRight" ? 1 : -1);
              }
            }}>
            <div className="photo-viewer-toolbar">
              <Dialog.Title className="sr-only">{title} photos</Dialog.Title>
              <Dialog.Description className="sr-only">Swipe left or right to change photo.</Dialog.Description>
              <span aria-live="polite" aria-atomic="true">Photo {selected + 1} of {images.length}</span>
              <Dialog.Close className="button secondary"><X size={22} /> Back to item</Dialog.Close>
            </div>
            <div className="photo-viewer-image" onPointerDown={startPhoto} onPointerMove={trackPhoto} onPointerUp={finishPhoto} onPointerCancel={cancelPhoto}>
              {image && image !== failedImage ? <img src={image} alt={`${title}, photo ${selected + 1}`} draggable={false} onError={() => setFailedImage(image)} /> : <span>Photo unavailable</span>}
            </div>
            {images.length > 1 && <div className="photo-viewer-navigation">
              <Button className="button secondary" aria-label="Previous enlarged photo" onClick={() => move(-1)}><ChevronLeft size={22} /> Previous</Button>
              <Button className="button secondary" aria-label="Next enlarged photo" onClick={() => move(1)}>Next <ChevronRight size={22} /></Button>
            </div>}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
      {images.length > 1 && (
        <>
          <div className="gallery-navigation">
            <Button
              className="button secondary icon-button"
              aria-label="Previous photo"
              onClick={() => move(-1)}
            >
              <ChevronLeft size={22} />
            </Button>
            <span aria-live="polite" aria-atomic="true">
              Photo {selected + 1} of {images.length}
            </span>
            <Button
              className="button secondary icon-button"
              aria-label="Next photo"
              onClick={() => move(1)}
            >
              <ChevronRight size={22} />
            </Button>
          </div>
          <ScrollArea.Root className="thumbnail-scroll-area">
          <ScrollArea.Viewport
            className="gallery-thumbnails"
            ref={strip}
            aria-label="Choose a photo"
            onTouchStart={(event) => {
              const touch = event.touches[0];
              if (touch && event.touches.length === 1)
                stripStart.current = { x: touch.clientX, y: touch.clientY };
              else stripStart.current = null;
            }}
            onTouchEnd={(event) => {
              const touch = event.changedTouches[0];
              if (touch) finishStrip({ x: touch.clientX, y: touch.clientY });
            }}
            onTouchCancel={() => {
              stripStart.current = null;
            }}
            onPointerDown={(event) => {
              if (event.pointerType !== "touch" && event.button === 0)
                stripStart.current = { x: event.clientX, y: event.clientY };
            }}
            onPointerUp={(event) => {
              if (event.pointerType !== "touch")
                finishStrip({ x: event.clientX, y: event.clientY });
            }}
            onPointerLeave={(event) => {
              if (event.pointerType !== "touch") stripStart.current = null;
            }}
            onClickCapture={(event) => {
              if (Date.now() < suppressClickUntil.current) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
          >
            <ScrollArea.Content className="thumbnail-scroll-content">
            {images.map((url, photo) => (
              <Button
                key={`${url}-${photo}`}
                className="gallery-thumbnail"
                aria-label={`View photo ${photo + 1}`}
                aria-pressed={selected === photo}
                onClick={() => setIndex(photo)}
              >
                <img src={url} alt="" draggable={false} loading="lazy" />
              </Button>
            ))}
            </ScrollArea.Content>
          </ScrollArea.Viewport>
          <ScrollArea.Scrollbar className="thumbnail-scrollbar" orientation="horizontal">
            <ScrollArea.Thumb className="thumbnail-scroll-thumb" />
          </ScrollArea.Scrollbar>
          </ScrollArea.Root>
        </>
      )}
    </section>
  );
}
