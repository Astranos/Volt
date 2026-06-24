import { useCallback } from "react";
import type React from "react";
import type { Dispatch, SetStateAction } from "react";
import type { HydratedMobileScannerPhotoResult } from "../domain/mobile-scanner-results";
import type { SidepanelToastTone } from "../lib/sidepanel-toast";
import {
  PHOTO_DROP_MIME,
  blobToDataUrl,
  blobToFile,
  dataUrlToFile,
  dataUrlToPngBlob,
  insertPhotosIntoPage,
  installPhotoDropBridge,
  normalizeImageFilename,
  type MobilePhoto,
} from "../components/sidepanel/mobile-photo-helpers";
import {
  firstDownloadedPhoto,
  photoFromResult,
  photoIdsFromBatchEntries,
  photosFromBatchEntries,
  resolvePhotoDragSelection,
} from "../domain/mobile-scanner-timeline";

async function photoToClipboardPngBlob(photo: MobilePhoto) {
  if (photo.dataUrl) return dataUrlToPngBlob(photo.dataUrl);
  if (photo.blob) return dataUrlToPngBlob(await blobToDataUrl(photo.blob));
  throw new Error("Photo bytes unavailable");
}

function setPhotoDragImage(event: React.DragEvent, photo: MobilePhoto) {
  if (!photo.dataUrl) return;
  const image = new Image();
  image.src = photo.dataUrl;
  image.alt = photo.name;
  image.className = "pointer-events-none fixed -left-[9999px] top-0 h-28 w-28 rounded-lg object-cover";
  document.body.append(image);
  event.dataTransfer.setDragImage(image, 56, 56);
  window.setTimeout(() => image.remove(), 0);
}

export function useMobileScannerPhotoActions({
  photos,
  selectedPhotoIds,
  selectedPhotos,
  setSelectedPhotoIds,
  flashFeedback,
}: {
  photos: MobilePhoto[];
  selectedPhotoIds: Set<string>;
  selectedPhotos: MobilePhoto[];
  setSelectedPhotoIds: Dispatch<SetStateAction<Set<string>>>;
  flashFeedback: (message: string, tone?: SidepanelToastTone) => void;
}) {
  const prepareActiveTabForPhotoDrop = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: installPhotoDropBridge,
        args: [PHOTO_DROP_MIME],
      });
    } catch (_err) {
      // Native file drag can still work without the in-page bridge.
    }
  }, []);

  const copyPhoto = useCallback(
    async (photo: MobilePhoto) => {
      try {
        if ("ClipboardItem" in window && navigator.clipboard?.write) {
          const blob = await photoToClipboardPngBlob(photo);
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          flashFeedback("Photo copied");
          return;
        }
        await navigator.clipboard.writeText(normalizeImageFilename(photo.name, photo.mimeType));
        flashFeedback("Photo name copied");
      } catch (err) {
        console.warn("[Volt Mobile Scanner] Photo clipboard copy failed", err);
        flashFeedback("Could not copy photo", "error");
      }
    },
    [flashFeedback],
  );

  const downloadPhoto = useCallback(
    (photo: MobilePhoto) => {
      if (typeof photo.downloadId === "number") {
        chrome.downloads.show(photo.downloadId);
        return;
      }
      const url = photo.dataUrl ?? (photo.blob ? URL.createObjectURL(photo.blob) : null);
      if (!url) {
        flashFeedback("Photo bytes unavailable", "warning");
        return;
      }
      const link = document.createElement("a");
      link.href = url;
      link.download = normalizeImageFilename(photo.name, photo.mimeType);
      link.click();
    },
    [flashFeedback],
  );

  const openDownloadedPhotoFolder = useCallback(
    (photo: MobilePhoto | undefined, fallbackMessage: string) => {
      if (typeof photo?.downloadId === "number") {
        chrome.downloads.show(photo.downloadId);
        return;
      }
      chrome.downloads.showDefaultFolder();
      flashFeedback(fallbackMessage, "warning");
    },
    [flashFeedback],
  );

  const openVoltDownloadsFolder = useCallback(() => {
    openDownloadedPhotoFolder(
      firstDownloadedPhoto(photos),
      "No downloaded Volt photos yet",
    );
  }, [openDownloadedPhotoFolder, photos]);

  const openBatchDownloadsFolder = useCallback(
    (entries: HydratedMobileScannerPhotoResult[]) => {
      openDownloadedPhotoFolder(
        firstDownloadedPhoto(entries.map(photoFromResult)),
        "No downloaded photos in this batch",
      );
    },
    [openDownloadedPhotoFolder],
  );

  const getTransferDataUrl = useCallback(async (photo: MobilePhoto) => {
    if (photo.dataUrl?.startsWith("data:")) return photo.dataUrl;
    if (photo.blob) return blobToDataUrl(photo.blob);
    return null;
  }, []);

  const sendPhotosToTab = useCallback(
    async (photosToSend: MobilePhoto[]) => {
      const transferable = (
        await Promise.all(
          photosToSend.map(async (photo) => {
            const dataUrl = await getTransferDataUrl(photo);
            return dataUrl
              ? { dataUrl, name: photo.name, mimeType: photo.mimeType }
              : null;
          }),
        )
      ).filter((photo): photo is { dataUrl: string; name: string; mimeType: string } => Boolean(photo));

      if (transferable.length === 0) {
        flashFeedback("Photo bytes unavailable", "warning");
        return;
      }

      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          flashFeedback("No active tab", "warning");
          return;
        }
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: insertPhotosIntoPage,
          args: [transferable],
        });
        const payload = result?.result as { inserted?: boolean; reason?: string } | undefined;
        if (!payload?.inserted) {
          flashFeedback(
            payload?.reason === "no_file_input" ? "No upload field on this page" : "Could not insert photos",
            "warning",
          );
          return;
        }
        flashFeedback(transferable.length === 1 ? "Photo inserted" : `${transferable.length} photos inserted`);
      } catch (_err) {
        flashFeedback("Tab access denied", "error");
      }
    },
    [flashFeedback, getTransferDataUrl],
  );

  const writePhotoDragData = useCallback(
    (event: React.DragEvent, sourcePhotos: MobilePhoto[]) => {
      const bridgePayload = sourcePhotos
        .filter((item) => item.dataUrl?.startsWith("data:"))
        .map((item) => ({
          dataUrl: item.dataUrl!,
          name: item.name,
          mimeType: item.mimeType,
        }));
      const files = sourcePhotos
        .map((item) => {
          if (item.blob) return blobToFile(item.blob, item.name, item.mimeType);
          if (item.dataUrl?.startsWith("data:")) return dataUrlToFile(item.dataUrl, item.name, item.mimeType);
          return null;
        })
        .filter((file): file is File => Boolean(file));

      if (bridgePayload.length === 0 && files.length === 0) {
        event.preventDefault();
        flashFeedback("Photo bytes unavailable", "warning");
        return;
      }

      event.dataTransfer.effectAllowed = "copy";
      setPhotoDragImage(event, sourcePhotos[0]);
      files.forEach((file) => {
        try {
          event.dataTransfer.items.add(file);
        } catch (_err) {}
      });
      if (bridgePayload.length > 0) {
        event.dataTransfer.setData(PHOTO_DROP_MIME, JSON.stringify(bridgePayload));
        event.dataTransfer.setData("text/uri-list", bridgePayload.map((item) => item.dataUrl).join("\n"));
        event.dataTransfer.setData(
          "text/html",
          bridgePayload.map((item) => `<img src="${item.dataUrl}" alt="${item.name}">`).join(""),
        );
      }
    },
    [flashFeedback],
  );

  const dragPhotos = useCallback(
    (event: React.DragEvent, photo: MobilePhoto) => {
      void prepareActiveTabForPhotoDrop();
      const selection = resolvePhotoDragSelection({
        photo,
        selectedPhotoIds,
        selectedPhotos,
      });
      if (selection.selectedPhotoIds !== selectedPhotoIds) {
        setSelectedPhotoIds(selection.selectedPhotoIds);
      }
      writePhotoDragData(event, selection.sourcePhotos);
    },
    [prepareActiveTabForPhotoDrop, selectedPhotoIds, selectedPhotos, setSelectedPhotoIds, writePhotoDragData],
  );

  const dragPhotoBatch = useCallback(
    (event: React.DragEvent, entries: HydratedMobileScannerPhotoResult[]) => {
      void prepareActiveTabForPhotoDrop();
      setSelectedPhotoIds(new Set(photoIdsFromBatchEntries(entries)));
      writePhotoDragData(event, photosFromBatchEntries(entries));
    },
    [prepareActiveTabForPhotoDrop, setSelectedPhotoIds, writePhotoDragData],
  );

  return {
    prepareActiveTabForPhotoDrop,
    copyPhoto,
    downloadPhoto,
    openVoltDownloadsFolder,
    openBatchDownloadsFolder,
    sendPhotosToTab,
    dragPhotos,
    dragPhotoBatch,
  };
}
