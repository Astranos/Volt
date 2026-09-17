import { Button } from "@base-ui/react/button";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { nextPhoto, swipeDirection, type Point } from "./gallery";

export function ProductGallery({
  images,
  title,
}: {
  images: string[];
  title: string;
}) {
  const [index, setIndex] = useState(0);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const mainStart = useRef<Point | null>(null);
  const stripStart = useRef<Point | null>(null);
  const suppressClickUntil = useRef(0);
  const selected = Math.min(index, Math.max(0, images.length - 1));
  const image = images[selected];
  const move = (direction: number) =>
    setIndex((value) => nextPhoto(value, direction, images.length));
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
      <div
        className="gallery-square"
        tabIndex={0}
        role="group"
        aria-label="Product photo. Use left and right arrow keys to change photo."
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) return;
          mainStart.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          if (mainStart.current) {
            const direction = swipeDirection(mainStart.current, {
              x: event.clientX,
              y: event.clientY,
            });
            mainStart.current = null;
            if (direction) move(direction);
          }
        }}
        onPointerCancel={() => {
          mainStart.current = null;
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
      </div>
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
          <div
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
          </div>
        </>
      )}
    </section>
  );
}
