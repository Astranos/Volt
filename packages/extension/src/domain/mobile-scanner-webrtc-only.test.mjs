import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMobilePhotoDownloadFilename,
  normalizeImageFilename,
  normalizeImageMimeType,
  normalizeMobilePhoto,
  PHOTO_DROP_MIME,
} from "./mobile-photo.ts";

test("offscreen scanner is WebRTC-only and has no HTTPS relay session path", () => {
  const photo = normalizeMobilePhoto({
    id: "scan-1",
    dataUrl: "data:image/jpeg;base64,ZmFrZQ==",
    mimeType: "image/jpeg",
    capturedAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(photo.kind, "photo");
  assert.equal("relaySessionId" in photo, false);
  assert.equal("relayUrl" in photo, false);
});

test("offscreen scanner does not poll signaling for relay results or photo manifests", () => {
  assert.equal(normalizeImageMimeType("image/png"), "image/png");
  assert.equal(normalizeImageMimeType("application/json"), "image/jpeg");
  assert.equal(normalizeImageFilename("photo.txt", "image/png"), "photo.txt.png");
});

test("unified Mobile Scanner can drag the selected photo batch", () => {
  const photo = normalizeMobilePhoto({
    id: "photo-1",
    dataUrl: "data:image/jpeg;base64,ZmFrZQ==",
    mimeType: "image/jpeg",
    capturedAt: "2026-01-01T00:00:00.000Z",
    batchId: "batch-1",
    batchIndex: 2,
  });
  const payload = {
    kind: "volt-mobile-photos",
    photos: [photo],
    mime: PHOTO_DROP_MIME,
  };

  assert.equal(payload.photos.length, 1);
  assert.equal(payload.photos[0].id, "photo-1");
  assert.equal(payload.mime, "application/x-volt-mobile-photos");
  assert.match(buildMobilePhotoDownloadFilename(photo), /unbatched/);
});

test("photo drag bridge sends scanner photos as Shopify-compatible files", async () => {
  const photo = normalizeMobilePhoto({
    id: "photo-1",
    dataUrl: "data:image/png;base64,ZmFrZQ==",
    mimeType: "image/png",
    name: "scanner-photo.png",
  });

  assert.equal(photo.mimeType, "image/png");
  assert.equal(normalizeImageFilename(photo.name, "image/jpeg"), "scanner-photo.jpg");
});

test("persisted scanner photos hydrate data URLs for reliable page drag payloads", () => {
  const photo = normalizeMobilePhoto({
    id: "photo-1",
    dataUrl: "data:image/png;base64,ZmFrZQ==",
    mimeType: "image/png",
    capturedAt: "2026-01-01T00:00:00.000Z",
  });

  assert.equal(photo.dataUrl, "data:image/png;base64,ZmFrZQ==");
});

test("unified Mobile Scanner copies photos with a browser-safe image type", () => {
  assert.equal(normalizeImageMimeType("image/png"), "image/png");
  assert.equal(normalizeImageMimeType("image/jpg"), "image/jpeg");
});
