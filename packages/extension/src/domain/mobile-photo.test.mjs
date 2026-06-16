import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMobilePhotoDownloadFilename,
  normalizeImageFilename,
  normalizeImageMimeType,
  normalizeMobilePhoto,
} from "./mobile-photo.ts";

test("normalizeImageMimeType accepts supported browser image types", () => {
  assert.equal(normalizeImageMimeType(" image/jpg "), "image/jpeg");
  assert.equal(normalizeImageMimeType("image/webp"), "image/webp");
  assert.equal(normalizeImageMimeType("application/octet-stream"), "image/jpeg");
});

test("normalizeImageFilename keeps the filename extension aligned with the mime type", () => {
  assert.equal(normalizeImageFilename("Shelf Photo.PNG", "image/jpeg"), "Shelf-Photo.jpg");
  assert.equal(normalizeImageFilename("scan", "image/heic"), "scan.heic");
});

test("normalizeMobilePhoto validates and completes captured photo metadata", () => {
  const photo = normalizeMobilePhoto({
    id: "photo-1",
    name: "raw name.webp",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,abc",
    size: "123",
    width: 640.8,
    height: 480.2,
    sessionId: "session-1",
  });

  assert.equal(photo?.kind, "photo");
  assert.equal(photo?.name, "raw-name.png");
  assert.equal(photo?.mimeType, "image/png");
  assert.equal(photo?.size, 123);
  assert.equal(photo?.width, 640);
  assert.equal(photo?.height, 480);
  assert.ok(photo?.capturedAt);
});

test("buildMobilePhotoDownloadFilename groups photos by scanner session and batch", () => {
  assert.equal(
    buildMobilePhotoDownloadFilename({
      id: "photo-1",
      name: "front label",
      mimeType: "image/webp",
      photoBatchId: "batch/456",
      sessionId: "abc/123",
    }),
    "Volt Photos/abc-123/batch-456/front-label.webp"
  );
});
