export type PhotoCropFrame = {
  previewWidth: number;
  previewHeight: number;
  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;
};

export type PhotoDimensions = {
  width: number;
  height: number;
};

export type ImageManipulatorCropAction = {
  crop: {
    originX: number;
    originY: number;
    width: number;
    height: number;
  };
};

function isPositiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function centerSquareCropAction(photo: PhotoDimensions): ImageManipulatorCropAction {
  const cropSize = Math.max(1, Math.min(photo.width, photo.height));
  return {
    crop: {
      originX: Math.max(0, Math.floor((photo.width - cropSize) / 2)),
      originY: Math.max(0, Math.floor((photo.height - cropSize) / 2)),
      width: cropSize,
      height: cropSize,
    },
  };
}

export function cropActionForVisibleFrame(
  photo: PhotoDimensions,
  frame?: PhotoCropFrame | null
): ImageManipulatorCropAction {
  if (
    !isPositiveFinite(photo.width) ||
    !isPositiveFinite(photo.height) ||
    !frame ||
    !isPositiveFinite(frame.previewWidth) ||
    !isPositiveFinite(frame.previewHeight) ||
    !isPositiveFinite(frame.frameWidth) ||
    !isPositiveFinite(frame.frameHeight)
  ) {
    return centerSquareCropAction(photo);
  }

  const scale = Math.max(frame.previewWidth / photo.width, frame.previewHeight / photo.height);
  const displayedWidth = photo.width * scale;
  const displayedHeight = photo.height * scale;
  const offsetX = (frame.previewWidth - displayedWidth) / 2;
  const offsetY = (frame.previewHeight - displayedHeight) / 2;
  const originX = clamp((frame.frameX - offsetX) / scale, 0, photo.width - 1);
  const originY = clamp((frame.frameY - offsetY) / scale, 0, photo.height - 1);
  const maxWidth = photo.width - originX;
  const maxHeight = photo.height - originY;
  const width = clamp(frame.frameWidth / scale, 1, maxWidth);
  const height = clamp(frame.frameHeight / scale, 1, maxHeight);

  return {
    crop: {
      originX: Math.floor(originX),
      originY: Math.floor(originY),
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
    },
  };
}
