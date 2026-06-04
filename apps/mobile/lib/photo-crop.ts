export type PhotoCropFrame = {
  previewWidth: number;
  previewHeight: number;
  frameX: number;
  frameY: number;
  frameWidth: number;
  frameHeight: number;
  captureScale?: number;
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
  const requestedCaptureScale = frame.captureScale;
  const captureScale =
    typeof requestedCaptureScale === "number" && isPositiveFinite(requestedCaptureScale)
      ? clamp(requestedCaptureScale, 0.25, 1)
      : 1;
  const adjustedFrameWidth = frame.frameWidth * captureScale;
  const adjustedFrameHeight = frame.frameHeight * captureScale;
  const adjustedFrameX = frame.frameX + (frame.frameWidth - adjustedFrameWidth) / 2;
  const adjustedFrameY = frame.frameY + (frame.frameHeight - adjustedFrameHeight) / 2;

  const originX = clamp((adjustedFrameX - offsetX) / scale, 0, photo.width - 1);
  const originY = clamp((adjustedFrameY - offsetY) / scale, 0, photo.height - 1);
  const maxWidth = photo.width - originX;
  const maxHeight = photo.height - originY;
  const width = clamp(adjustedFrameWidth / scale, 1, maxWidth);
  const height = clamp(adjustedFrameHeight / scale, 1, maxHeight);

  return {
    crop: {
      originX: Math.floor(originX),
      originY: Math.floor(originY),
      width: Math.max(1, Math.floor(width)),
      height: Math.max(1, Math.floor(height)),
    },
  };
}
