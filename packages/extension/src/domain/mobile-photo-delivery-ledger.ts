import { normalizeMobilePhoto, type MobilePhoto } from "./mobile-photo.ts";

export type BrowserPhotoDeliveryError =
  | "invalid_photo"
  | "download_failed"
  | "storage_failed";

export type BrowserPhotoDeliveryReceipt =
  | {
      success: true;
      photoId: string;
      photoBatchId?: string;
      size: number;
    }
  | {
      success: false;
      error: BrowserPhotoDeliveryError;
      detail?: string;
      retryable: true;
    };

export type DownloadedMobilePhoto = {
  downloadId: number;
  filename: string;
};

export type MobilePhotoDownloadCleanupReceipt =
  | { status: "tracked" }
  | {
      status: "not_applicable";
      reason: "auto_delete_disabled" | "non_volt_filename" | "cleanup_unavailable";
    }
  | { status: "failed"; error?: string };

export type MobilePhotoDownloadReceipt =
  | ({ success: true } & DownloadedMobilePhoto)
  | { success: false; error?: string };

type BrowserPhotoDeliveryLedgerOptions = {
  downloadMobilePhoto: (photo: MobilePhoto) => Promise<MobilePhotoDownloadReceipt>;
  persistBrowserPhoto: (photo: MobilePhoto) => Promise<{ success: boolean; error?: string }>;
  recordMobilePhotoDownload?: (
    download: DownloadedMobilePhoto,
  ) => Promise<MobilePhotoDownloadCleanupReceipt>;
  onCleanupTrackingFailed?: (error?: string) => void;
};

export function normalizeBrowserPhotoDeliveryReceipt(
  receipt: BrowserPhotoDeliveryReceipt | boolean,
  fallback: { photoId: string; photoBatchId?: string; size: number },
): BrowserPhotoDeliveryReceipt {
  if (typeof receipt !== "boolean") return receipt;
  return receipt
    ? {
        success: true,
        photoId: fallback.photoId,
        photoBatchId: fallback.photoBatchId,
        size: fallback.size,
      }
    : {
        success: false,
        error: "storage_failed",
        detail: "Chrome could not store the photo.",
        retryable: true,
      };
}

export async function deliverBrowserPhoto({
  photoInput,
  downloadMobilePhoto,
  persistBrowserPhoto,
  recordMobilePhotoDownload,
  onCleanupTrackingFailed,
}: BrowserPhotoDeliveryLedgerOptions & {
  photoInput: unknown;
}): Promise<BrowserPhotoDeliveryReceipt> {
  const photo = normalizeMobilePhoto(photoInput);
  if (!photo) {
    return {
      success: false,
      error: "invalid_photo",
      detail: "Chrome received an invalid photo payload.",
      retryable: true,
    };
  }

  const download = await downloadMobilePhoto(photo);
  if (!download.success) {
    return {
      success: false,
      error: "download_failed",
      detail: download.error || "Chrome could not download the photo.",
      retryable: true,
    };
  }

  const cleanupReceipt = recordMobilePhotoDownload
    ? await recordMobilePhotoDownload({
        downloadId: download.downloadId,
        filename: download.filename,
      })
    : ({ status: "not_applicable", reason: "cleanup_unavailable" } as const);
  if (cleanupReceipt.status === "failed") {
    onCleanupTrackingFailed?.(cleanupReceipt.error);
  }

  const browserPhoto = {
    ...photo,
    downloadId: download.downloadId,
    downloadFilename: download.filename,
  };
  const persisted = await persistBrowserPhoto(browserPhoto);
  if (!persisted.success) {
    return {
      success: false,
      error: "storage_failed",
      detail: persisted.error || "Chrome could not store the photo.",
      retryable: true,
    };
  }

  return {
    success: true,
    photoId: photo.id,
    photoBatchId: photo.photoBatchId,
    size: Math.max(1, photo.size),
  };
}
