import assert from "node:assert/strict";
import test from "node:test";

import { deliverBrowserPhoto } from "./mobile-photo-delivery-ledger.ts";

test("browser photo delivery degrades cleanup tracking failure after download", async () => {
  let persisted = false;
  let cleanupError;
  const receipt = await deliverBrowserPhoto({
    photoInput: createPhoto(),
    downloadMobilePhoto: async () => ({
      success: true,
      downloadId: 42,
      filename: "Volt Photos/session/batch/photo.jpg",
    }),
    recordMobilePhotoDownload: async () => ({
      status: "failed",
      error: "storage_failed",
    }),
    onCleanupTrackingFailed: (error) => {
      cleanupError = error;
    },
    persistBrowserPhoto: async () => {
      persisted = true;
      return { success: true };
    },
  });

  assert.deepEqual(receipt, {
    success: true,
    photoId: "photo-1",
    photoBatchId: "batch-1",
    size: 4,
  });
  assert.equal(persisted, true);
  assert.equal(cleanupError, "storage_failed");
});

test("browser photo delivery stores downloaded metadata after cleanup tracking succeeds", async () => {
  let persistedPhoto;
  const receipt = await deliverBrowserPhoto({
    photoInput: createPhoto(),
    downloadMobilePhoto: async () => ({
      success: true,
      downloadId: 42,
      filename: "Volt Photos/session/batch/photo.jpg",
    }),
    recordMobilePhotoDownload: async () => ({ status: "tracked" }),
    persistBrowserPhoto: async (photo) => {
      persistedPhoto = photo;
      return { success: true };
    },
  });

  assert.deepEqual(receipt, {
    success: true,
    photoId: "photo-1",
    photoBatchId: "batch-1",
    size: 4,
  });
  assert.equal(persistedPhoto.downloadId, 42);
  assert.equal(persistedPhoto.downloadFilename, "Volt Photos/session/batch/photo.jpg");
});

test("browser photo delivery accepts receipt when cleanup is not applicable", async () => {
  const receipt = await deliverBrowserPhoto({
    photoInput: createPhoto(),
    downloadMobilePhoto: async () => ({
      success: true,
      downloadId: 42,
      filename: "Volt Photos/session/batch/photo.jpg",
    }),
    recordMobilePhotoDownload: async () => ({
      status: "not_applicable",
      reason: "auto_delete_disabled",
    }),
    persistBrowserPhoto: async () => ({ success: true }),
  });

  assert.equal(receipt.success, true);
});

function createPhoto() {
  return {
    id: "photo-1",
    kind: "photo",
    photoBatchId: "batch-1",
    name: "photo.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,ZmFrZQ==",
    size: 4,
    capturedAt: "2026-06-03T15:00:00.000Z",
  };
}
