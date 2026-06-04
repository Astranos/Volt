import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Camera,
  Check,
  Copy,
  Download,
  ImagePlus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import QRCode from "qrcode";
import type { ScannerConnectionStatus } from "../../../../scanner-protocol/src";
import { cn } from "../../lib/utils";
import {
  IconChip,
  MobileToolHeader,
  PairingPlaceholder,
  PrimaryActionButton,
  QrPairingPanel,
  SecondaryActionButton,
} from "./mobile-shared";
import {
  PHOTO_DROP_MIME,
  dataUrlToFile,
  dataUrlToPngBlob,
  normalizeImageFilename,
  type MobilePhoto,
} from "./mobile-photo-helpers";

const STORAGE_KEY = "volt.mobilePhotos.photos";
const MAX_PHOTOS = 80;

type MobileScannerState = {
  status: ScannerConnectionStatus;
  qrCodeUrl: string | null;
  error: string | null;
};

function trimPhotosForStorage(photos: MobilePhoto[]) {
  return trimPhotosForState(photos).map(({ dataUrl, ...metadata }) => metadata);
}

function trimPhotosForState(photos: MobilePhoto[]) {
  const trimmed: MobilePhoto[] = [];

  for (const photo of photos.slice(0, MAX_PHOTOS)) {
    trimmed.push(photo);
  }

  return trimmed;
}

function installPhotoDropBridge(dropMime: string) {
  const root = window as typeof window & {
    __voltPhotoDropBridgeInstalled?: boolean;
  };

  if (root.__voltPhotoDropBridgeInstalled) return;

  const normalizeImageMimeTypeInPage = (mimeType: string) => {
    const normalized = mimeType.toLowerCase().trim();
    if (normalized === "image/jpg") return "image/jpeg";
    if (
      normalized === "image/jpeg" ||
      normalized === "image/png" ||
      normalized === "image/gif" ||
      normalized === "image/webp" ||
      normalized === "image/avif" ||
      normalized === "image/heic" ||
      normalized === "image/heif"
    ) {
      return normalized;
    }
    return "image/jpeg";
  };

  const extensionForMimeTypeInPage = (mimeType: string) => {
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/gif") return "gif";
    if (mimeType === "image/webp") return "webp";
    if (mimeType === "image/avif") return "avif";
    if (mimeType === "image/heic") return "heic";
    if (mimeType === "image/heif") return "heif";
    return "jpg";
  };

  const normalizeImageFilenameInPage = (filename: string, mimeType: string) => {
    const cleanName = filename.trim().replace(/[^\w.\-]+/g, "-") || "volt-photo";
    const extension = extensionForMimeTypeInPage(mimeType);
    if (/\.(avif|gif|heic|heif|jpe?g|png|webp)$/i.test(cleanName)) {
      return cleanName.replace(/\.(avif|gif|heic|heif|jpe?g|png|webp)$/i, `.${extension}`);
    }
    return `${cleanName}.${extension}`;
  };

  const dataUrlToFileInPage = (dataUrl: string, filename: string, mimeType: string) => {
    const [header, base64] = dataUrl.split(",");
    if (!header || !base64) return null;
    const headerMimeType = header.match(/^data:([^;]+)/)?.[1];
    const normalizedMimeType = normalizeImageMimeTypeInPage(headerMimeType || mimeType);
    const normalizedFilename = normalizeImageFilenameInPage(filename, normalizedMimeType);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], normalizedFilename, {
      type: normalizedMimeType,
      lastModified: Date.now(),
    });
  };

  const findFileInput = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : document.activeElement;
    const closestInput = element?.closest?.("input[type='file']");
    if (closestInput instanceof HTMLInputElement) return closestInput;

    const closestContainer = element?.closest?.("form, [role='button'], label, div");
    const localInput = closestContainer?.querySelector?.("input[type='file']");
    if (localInput instanceof HTMLInputElement) return localInput;

    return document.querySelector("input[type='file']") as HTMLInputElement | null;
  };

  document.addEventListener(
    "dragover",
    (event) => {
      const hasVoltPhotos = Array.from(event.dataTransfer?.types ?? []).includes(dropMime);
      if (!hasVoltPhotos) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    },
    true
  );

  document.addEventListener(
    "drop",
    (event) => {
      const rawPayload = event.dataTransfer?.getData(dropMime);
      if (!rawPayload) return;

      let photos: MobilePhoto[] = [];
      try {
        const parsed = JSON.parse(rawPayload);
        photos = Array.isArray(parsed) ? parsed : [];
      } catch (_err) {
        return;
      }

      const files = photos
        .filter((photo) => photo.dataUrl)
        .map((photo) => dataUrlToFileInPage(photo.dataUrl!, photo.name, photo.mimeType))
        .filter((file): file is File => Boolean(file));

      if (files.length === 0) return;

      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));

      event.preventDefault();
      event.stopPropagation();

      const target = event.target instanceof Element ? event.target : document.body;
      const fileInput = findFileInput(target);
      if (fileInput) {
        fileInput.files = transfer.files;
        fileInput.dispatchEvent(new Event("input", { bubbles: true }));
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      }

      target.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        })
      );
    },
    true
  );

  root.__voltPhotoDropBridgeInstalled = true;
}

async function insertPhotosIntoPage(photos: MobilePhoto[]) {
  const normalizeImageMimeTypeInPage = (mimeType: string) => {
    const normalized = mimeType.toLowerCase().trim();
    if (normalized === "image/jpg") return "image/jpeg";
    if (
      normalized === "image/jpeg" ||
      normalized === "image/png" ||
      normalized === "image/gif" ||
      normalized === "image/webp" ||
      normalized === "image/avif" ||
      normalized === "image/heic" ||
      normalized === "image/heif"
    ) {
      return normalized;
    }
    return "image/jpeg";
  };

  const extensionForMimeTypeInPage = (mimeType: string) => {
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/gif") return "gif";
    if (mimeType === "image/webp") return "webp";
    if (mimeType === "image/avif") return "avif";
    if (mimeType === "image/heic") return "heic";
    if (mimeType === "image/heif") return "heif";
    return "jpg";
  };

  const normalizeImageFilenameInPage = (filename: string, mimeType: string) => {
    const cleanName = filename.trim().replace(/[^\w.\-]+/g, "-") || "volt-photo";
    const extension = extensionForMimeTypeInPage(mimeType);
    if (/\.(avif|gif|heic|heif|jpe?g|png|webp)$/i.test(cleanName)) {
      return cleanName.replace(/\.(avif|gif|heic|heif|jpe?g|png|webp)$/i, `.${extension}`);
    }
    return `${cleanName}.${extension}`;
  };

  const dataUrlToFileInPage = (dataUrl: string, filename: string, mimeType: string) => {
    const [header, base64] = dataUrl.split(",");
    if (!header || !base64) return null;
    const headerMimeType = header.match(/^data:([^;]+)/)?.[1];
    const normalizedMimeType = normalizeImageMimeTypeInPage(headerMimeType || mimeType);
    const normalizedFilename = normalizeImageFilenameInPage(filename, normalizedMimeType);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], normalizedFilename, {
      type: normalizedMimeType,
      lastModified: Date.now(),
    });
  };

  const dataUrlToShopifyJpegFile = async (dataUrl: string, filename: string) => {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image decode failed"));
    });
    image.src = dataUrl;
    await loaded;

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) {
      throw new Error("Image canvas failed");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });
    if (!blob) throw new Error("JPEG conversion failed");

    return new File([blob], normalizeImageFilenameInPage(filename, "image/jpeg"), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  };

  const isVisible = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  };

  const activeElement = document.activeElement;
  const focusedInput =
    activeElement instanceof HTMLInputElement && activeElement.type === "file"
      ? activeElement
      : null;
  const fileInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>("input[type='file']")
  );
  const acceptsImages = (input: HTMLInputElement) => {
    const accept = input.accept.toLowerCase();
    return (
      !accept ||
      accept.includes("image") ||
      accept.includes(".jpg") ||
      accept.includes(".jpeg") ||
      accept.includes(".png") ||
      accept.includes(".webp")
    );
  };
  const shopifyMediaInput = fileInputs.find((input) => {
    const field = [
      input.accept,
      input.name,
      input.id,
      input.getAttribute("aria-label") ?? "",
      input.closest("[data-testid], [data-polaris-dropzone], form, section")?.textContent ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return (
      acceptsImages(input) &&
      (field.includes("image") ||
        field.includes("media") ||
        field.includes("photo") ||
        field.includes("file upload"))
    );
  });
  const fileInput =
    focusedInput ??
    shopifyMediaInput ??
    fileInputs.find((input) => acceptsImages(input) && input.multiple && isVisible(input)) ??
    fileInputs.find((input) => acceptsImages(input) && isVisible(input)) ??
    fileInputs.find((input) => acceptsImages(input) && input.multiple) ??
    fileInputs.find(acceptsImages) ??
    fileInputs.find((input) => input.multiple && isVisible(input)) ??
    fileInputs.find((input) => isVisible(input)) ??
    fileInputs.find((input) => input.multiple) ??
    fileInputs[0] ??
    null;

  const isShopifyAdmin = location.hostname === "admin.shopify.com" ||
    location.hostname.endsWith(".myshopify.com");
  const files = (
    isShopifyAdmin
      ? await Promise.all(
          photos.filter((photo) => photo.dataUrl).map((photo) =>
            dataUrlToShopifyJpegFile(photo.dataUrl!, photo.name).catch(() =>
              dataUrlToFileInPage(photo.dataUrl!, photo.name, photo.mimeType)
            )
          )
        )
      : photos.filter((photo) => photo.dataUrl).map((photo) =>
          dataUrlToFileInPage(photo.dataUrl!, photo.name, photo.mimeType)
        )
  ).filter((file): file is File => Boolean(file));

  if (!fileInput || files.length === 0) {
    return { inserted: false, reason: fileInput ? "no_files" : "no_file_input" };
  }

  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  fileInput.files = transfer.files;

  const eventOptions = { bubbles: true, cancelable: true };
  fileInput.dispatchEvent(new Event("input", eventOptions));
  fileInput.dispatchEvent(new Event("change", eventOptions));

  const dropTarget =
    fileInput.closest("label, form, [role='button'], [data-testid], div") ??
    document.body;
  dropTarget.dispatchEvent(
    new DragEvent("drop", {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
    })
  );

  return { inserted: true, count: files.length };
}

function formatSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MobilePhotos({
  embedded = false,
  showConnectionControls = true,
}: {
  embedded?: boolean;
  showConnectionControls?: boolean;
} = {}) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ScannerConnectionStatus>("disconnected");
  const [photos, setPhotos] = useState<MobilePhoto[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const selectedPhotos = useMemo(
    () => photos.filter((photo) => selectedIds.has(photo.id)),
    [photos, selectedIds]
  );

  const generateQrCode = useCallback(async (url: string) => {
    return QRCode.toDataURL(url, {
      width: 768,
      margin: 3,
      errorCorrectionLevel: "H",
      color: { dark: "#1c1917", light: "#ffffff" },
    });
  }, []);

  const persistPhotos = useCallback((nextPhotos: MobilePhoto[]) => {
    void chrome.storage.local.set({ [STORAGE_KEY]: trimPhotosForStorage(nextPhotos) });
  }, []);

  const applyScannerState = useCallback(
    (state: Partial<MobileScannerState> | null | undefined) => {
      if (!state) return;
      if (state.status) setStatus(state.status);
      setError(state.error ?? null);

      if (!state.qrCodeUrl) {
        setQrDataUrl(null);
        return;
      }

      void generateQrCode(state.qrCodeUrl).then(setQrDataUrl);
    },
    [generateQrCode]
  );

  const startSession = useCallback(
    async (force = false) => {
      setStatus("creating");
      setError(null);
      const response = await chrome.runtime.sendMessage({ action: "scannerStart", force });
      if (response?.state) applyScannerState(response.state);
      if (response?.error) {
        setStatus("error");
        setError(response.error);
      }
    },
    [applyScannerState]
  );

  const unpair = useCallback(() => {
    void chrome.runtime
      .sendMessage({ action: "scannerDisconnect" })
      .then((response) => {
        if (response?.state) applyScannerState(response.state);
      });
  }, [applyScannerState]);

  const addPhoto = useCallback((photo: MobilePhoto) => {
    setPhotos((current) => {
      const next = trimPhotosForState([photo, ...current.filter((item) => item.id !== photo.id)]);
      return next;
    });
  }, []);

  const togglePhoto = useCallback((id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearPhotos = useCallback(() => {
    setPhotos([]);
    setSelectedIds(new Set());
    persistPhotos([]);
  }, [persistPhotos]);

  const deleteSelected = useCallback(() => {
    setPhotos((current) => {
      const next = current.filter((photo) => !selectedIds.has(photo.id));
      persistPhotos(next);
      return next;
    });
    setSelectedIds(new Set());
  }, [persistPhotos, selectedIds]);

  const downloadSelected = useCallback(() => {
    for (const photo of selectedPhotos) {
      if (typeof photo.downloadId === "number") {
        chrome.downloads.show(photo.downloadId);
        continue;
      }
      if (!photo.dataUrl) continue;
      const link = document.createElement("a");
      link.href = photo.dataUrl;
      link.download = photo.name;
      link.click();
    }
  }, [selectedPhotos]);

  const copySelected = useCallback(async () => {
    if (selectedPhotos.length === 0) return;

    const transferablePhotos = selectedPhotos.filter((photo) => photo.dataUrl);
    if (transferablePhotos.length === 0) {
      setError("Selected photos are already saved in Downloads.");
      return;
    }

    const html = transferablePhotos
      .map((photo) => {
        const alt = photo.name.replace(/"/g, "&quot;");
        return `<img src="${photo.dataUrl}" alt="${alt}">`;
      })
      .join("");
    const plainText = transferablePhotos
      .map((photo) => normalizeImageFilename(photo.name, photo.mimeType))
      .join("\n");

    try {
      if ("ClipboardItem" in window && navigator.clipboard?.write) {
        if (transferablePhotos.length === 1) {
          const pngBlob = await dataUrlToPngBlob(transferablePhotos[0].dataUrl!);
          await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
          setError(null);
          return;
        }

        const clipboardData: Record<string, Blob> = {
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" }),
        };

        await navigator.clipboard.write([new ClipboardItem(clipboardData)]);
        setError(null);
        return;
      }

      await navigator.clipboard.writeText(plainText);
      setError(null);
    } catch (err) {
      console.warn("[Volt Mobile Photos] Clipboard copy failed", err);
      try {
        await navigator.clipboard.writeText(plainText);
        setError(null);
      } catch (fallbackErr) {
        console.warn("[Volt Mobile Photos] Clipboard text fallback failed", fallbackErr);
        setError("Could not copy selected photos.");
      }
    }
  }, [selectedPhotos]);

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
      // Restricted Chrome pages cannot be scripted; the native browser drag payload still remains.
    }
  }, []);

  const sendSelectedToActiveTab = useCallback(async () => {
    if (selectedPhotos.length === 0) return;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setError("No active tab found for photo upload.");
        return;
      }

      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: insertPhotosIntoPage,
        args: [selectedPhotos.filter((photo) => photo.dataUrl)],
      });

      const payload = result?.result as
        | { inserted?: boolean; reason?: string; count?: number }
        | undefined;

      if (!payload?.inserted) {
        setError(
          payload?.reason === "no_file_input"
            ? "No file upload input was found on the active tab."
            : "Could not send the selected photos to the active tab."
        );
        return;
      }

      setError(null);
    } catch (_err) {
      setError("Could not access the active tab for photo upload.");
    }
  }, [selectedPhotos]);

  const handleDragStart = useCallback(
    (event: React.DragEvent, photo: MobilePhoto) => {
      const dragPhotos = selectedIds.has(photo.id) ? selectedPhotos : [photo];
      const transferablePhotos = dragPhotos.filter((item) => item.dataUrl);
      if (!transferablePhotos.length) {
        event.preventDefault();
        setError("Selected photos are already saved in Downloads.");
        return;
      }
      if (!selectedIds.has(photo.id)) setSelectedIds(new Set([photo.id]));
      void prepareActiveTabForPhotoDrop();

      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(PHOTO_DROP_MIME, JSON.stringify(transferablePhotos));
      transferablePhotos.forEach((item) => {
        const file = dataUrlToFile(item.dataUrl!, item.name, item.mimeType);
        if (!file) return;
        try {
          event.dataTransfer.items.add(file);
        } catch (_err) {
          // Some Chrome extension drag contexts reject programmatic file items.
        }
      });
      event.dataTransfer.setData("text/uri-list", transferablePhotos.map((item) => item.dataUrl!).join("\n"));
      event.dataTransfer.setData(
        "text/html",
        transferablePhotos.map((item) => `<img src="${item.dataUrl}" alt="${item.name}">`).join("")
      );
      event.dataTransfer.setData("text/plain", transferablePhotos.map((item) => item.name).join("\n"));
    },
    [prepareActiveTabForPhotoDrop, selectedIds, selectedPhotos]
  );

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY).then((stored) => {
      const saved = stored[STORAGE_KEY];
      if (Array.isArray(saved)) setPhotos(saved);
    });

    if (showConnectionControls) {
      void chrome.runtime
        .sendMessage({ action: "scannerGetState" })
        .then((response) => {
          const state = response?.state as MobileScannerState | undefined;
          applyScannerState(state);
          if (!state || state.status === "disconnected" || state.status === "error") {
            void startSession();
          }
        })
        .catch(() => {
          void startSession();
        });
    }
  }, [applyScannerState, showConnectionControls, startSession]);

  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message?.action === "scannerStateChanged") {
        applyScannerState(message.state);
      } else if (message?.action === "scannerPhoto") {
        addPhoto(message.photo);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [addPhoto, applyScannerState]);

  useEffect(() => {
    if (photos.length === 0) return;
    void prepareActiveTabForPhotoDrop();
  }, [photos.length, prepareActiveTabForPhotoDrop]);

  const showQr = status === "waiting" && qrDataUrl;
  const isCreating = status === "creating";
  const selectedCount = selectedIds.size;
  const connected = status === "connected";

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden",
        embedded ? "bg-transparent" : "sidepanel-shell h-full",
      )}
    >
      {embedded ? null : (
        <MobileToolHeader
          icon={<ImagePlus className="h-4 w-4" />}
          title="Mobile Photos"
          subtitle="Capture from paired Volt app"
          status={status}
          error={error}
        />
      )}

      <div className={cn("min-h-0 flex-1 overflow-y-auto pb-5", embedded ? "px-0 pt-0" : "px-4 pt-4")}>
        {showConnectionControls && showQr ? (
          <div className="mb-5">
            <QrPairingPanel
              qrDataUrl={qrDataUrl}
              hint="Scan with Volt, then open the Photos tab on the phone."
            />
          </div>
        ) : showConnectionControls && isCreating ? (
          <div className="mb-5 flex justify-center">
            <PairingPlaceholder label="Setting up secure pairing…" />
          </div>
        ) : null}

        {showConnectionControls ? <div className="flex gap-2">
          {connected ? (
            <SecondaryActionButton onClick={unpair} className="flex-1">
              <RefreshCw className="h-4 w-4" />
              Disconnect
            </SecondaryActionButton>
          ) : (
            <PrimaryActionButton onClick={() => startSession(true)} className="flex-1">
              <RefreshCw className="h-4 w-4" />
              Restart pairing
            </PrimaryActionButton>
          )}
          {photos.length > 0 ? (
            <SecondaryActionButton
              onClick={clearPhotos}
              aria-label="Clear all photos"
              className="h-11! w-11! px-0!"
            >
              <Trash2 className="h-4 w-4" />
            </SecondaryActionButton>
          ) : null}
        </div> : null}

        <div className={cn("flex items-center justify-between", showConnectionControls ? "mt-6" : "mt-0")}>
          <div>
            <div className="text-sm font-bold text-stone-900">Photos</div>
            <div className="text-xs text-stone-500">
              {photos.length} received{selectedCount ? `, ${selectedCount} selected` : ""}
            </div>
          </div>
          <div className="flex gap-1">
            <IconChip
              onClick={copySelected}
              disabled={!selectedCount}
              aria-label="Copy selected"
            >
              <Copy className="h-4 w-4" />
            </IconChip>
            <IconChip
              onClick={sendSelectedToActiveTab}
              disabled={!selectedCount}
              aria-label="Send selected to active tab"
            >
              <Upload className="h-4 w-4" />
            </IconChip>
            <IconChip
              onClick={downloadSelected}
              disabled={!selectedCount}
              aria-label="Download selected"
            >
              <Download className="h-4 w-4" />
            </IconChip>
            <IconChip
              onClick={deleteSelected}
              disabled={!selectedCount}
              aria-label="Delete selected"
            >
              <Trash2 className="h-4 w-4" />
            </IconChip>
          </div>
        </div>

        <div className="mt-3">
          {photos.length === 0 ? (
            <div className="liquid-glass-soft concentric-lg flex flex-col items-center border-dashed border-stone-300 px-4 py-9 text-center">
              <div className="liquid-glass-soft mb-3 flex h-12 w-12 items-center justify-center rounded-full text-stone-400">
                <Camera className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-stone-700">No photos yet</p>
              <p className="mt-1 max-w-[260px] text-xs text-stone-500">
                Captured phone photos appear here. Select one or more, then drag them into a page photo uploader.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {photos.map((photo) => {
                const selected = selectedIds.has(photo.id);
                return (
                  <button
                    key={photo.id}
                    type="button"
                    draggable
                    onClick={() => togglePhoto(photo.id)}
                    onPointerDown={() => void prepareActiveTabForPhotoDrop()}
                    onMouseEnter={() => void prepareActiveTabForPhotoDrop()}
                    onDragStart={(event) => handleDragStart(event, photo)}
                    className={cn(
                      "liquid-glass-soft concentric-lg group relative overflow-hidden p-0 text-left transition",
                      "ring-1 ring-white/60 hover:ring-green-500/60",
                      selected && "ring-2 ring-green-500 ring-offset-2 ring-offset-white",
                    )}
                  >
                    {photo.dataUrl ? (
                      <img
                        src={photo.dataUrl}
                        alt={photo.name}
                        className="aspect-square w-full object-cover"
                      />
                    ) : (
                      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-stone-100 px-3 text-center text-stone-500">
                        <Download className="h-7 w-7" />
                        <span className="text-[11px] font-semibold">Saved to Downloads</span>
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-stone-900/80 via-stone-900/40 to-transparent px-2.5 pb-1.5 pt-3 text-[11px] text-white">
                      <div className="truncate font-semibold">{photo.name}</div>
                      <div className="truncate opacity-80">
                        {[
                          photo.width && photo.height ? `${photo.width}×${photo.height}` : "",
                          formatSize(photo.size),
                          photo.status === "download_failed"
                            ? "Retryable"
                            : photo.downloadFilename || photo.status === "browser_received"
                              ? "Downloaded"
                              : photo.status === "available_to_browser"
                                ? "Downloading"
                                : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white transition",
                        selected ? "bg-green-500" : "bg-stone-900/40 backdrop-blur-sm",
                      )}
                    >
                      {selected ? <Check className="h-3 w-3 stroke-3 text-white" /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
