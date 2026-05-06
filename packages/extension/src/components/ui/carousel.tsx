"use client";

import { cn } from "../../lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as React from "react";

interface CarouselProps {
  images: Array<{ url: string; altText: string | null }>;
  className?: string;
  showThumbnails?: boolean;
}

export function Carousel({
  images,
  className,
  showThumbnails = true,
}: CarouselProps) {
  const [currentIndex, setCurrentIndex] = React.useState(0);

  const next = () => {
    setCurrentIndex(prev => (prev + 1) % images.length);
  };

  const previous = () => {
    setCurrentIndex(prev => (prev - 1 + images.length) % images.length);
  };

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };

  if (!images || images.length === 0) {
    return (
      <div
        className={cn(
          "w-full bg-gray-100 rounded-lg border border-gray-200 flex items-center justify-center",
          className
        )}
      >
        <span className="text-gray-400">No images available</span>
      </div>
    );
  }

  if (images.length === 1) {
    return (
      <div className={cn("w-full", className)}>
        <img
          src={images[0].url}
          alt={images[0].altText || "Product image"}
          className="w-full h-auto rounded-lg border border-gray-200"
        />
      </div>
    );
  }

  return (
    <div className={cn("relative w-full", className)}>
      {/* Main Image */}
      <div className="relative w-full rounded-lg border border-gray-200 overflow-hidden">
        <img
          src={images[currentIndex].url}
          alt={
            images[currentIndex].altText || `Product image ${currentIndex + 1}`
          }
          className="w-full h-auto"
        />

        {/* Navigation Arrows */}
        <button
          onClick={e => {
            e.stopPropagation();
            previous();
          }}
          className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-2 rounded-full transition-colors"
          aria-label="Previous image"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <button
          onClick={e => {
            e.stopPropagation();
            next();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-2 rounded-full transition-colors"
          aria-label="Next image"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Image Counter */}
      <div className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
        {currentIndex + 1} / {images.length}
      </div>

      {/* Thumbnail Navigation */}
      {showThumbnails && images.length > 1 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
          {images.map((image, index) => (
            <button
              key={index}
              onClick={e => {
                e.stopPropagation();
                goToSlide(index);
              }}
              className={cn(
                "flex-shrink-0 w-16 h-16 rounded border-2 transition-all",
                index === currentIndex
                  ? "border-green-500 ring-2 ring-green-200"
                  : "border-gray-200 hover:border-gray-300"
              )}
            >
              <img
                src={image.url}
                alt={image.altText || `Thumbnail ${index + 1}`}
                className="w-full h-full object-cover rounded"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
