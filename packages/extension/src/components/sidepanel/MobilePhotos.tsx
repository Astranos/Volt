import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Camera,
  Check,
  Download,
  ImagePlus,
  RefreshCw,
  Trash2,
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

const STORAGE_KEY = "volt.mobilePhotos.photos";

type MobileScannerState = {
  status: ScannerConnectionStatus;
  qrCodeUrl: string | null;
  error: string | null;
};

type MobilePhoto = {
  id: string;
  kind: "photo";
  name: string;
  mimeType: string;
  dataUrl: string;
  size: number;
  width?: number;
  height?: number;
  capturedAt?: string;
};

function dataUrlToFile(dataUrl: string, filename: string, mimeType: string) {
  const [header, base64] = dataUrl.split(",");
  if (!header || !base64) return null;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], filename, { type: mimeType });
}

function formatSize(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MobilePhotos() {
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
    void chrome.storage.local.set({ [STORAGE_KEY]: nextPhotos });
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
      const next = [photo, ...current.filter((item) => item.id !== photo.id)].slice(0, 80);
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
      const link = document.createElement("a");
      link.href = photo.dataUrl;
      link.download = photo.name;
      link.click();
    }
  }, [selectedPhotos]);

  const handleDragStart = useCallback(
    (event: React.DragEvent, photo: MobilePhoto) => {
      const dragPhotos = selectedIds.has(photo.id) ? selectedPhotos : [photo];
      if (!selectedIds.has(photo.id)) setSelectedIds(new Set([photo.id]));

      event.dataTransfer.effectAllowed = "copy";
      dragPhotos.forEach((item) => {
        const file = dataUrlToFile(item.dataUrl, item.name, item.mimeType);
        if (file) event.dataTransfer.items.add(file);
      });
      event.dataTransfer.setData("text/uri-list", dragPhotos.map((item) => item.dataUrl).join("\n"));
      event.dataTransfer.setData(
        "text/html",
        dragPhotos.map((item) => `<img src="${item.dataUrl}" alt="${item.name}">`).join("")
      );
      event.dataTransfer.setData("text/plain", dragPhotos.map((item) => item.name).join("\n"));
    },
    [selectedIds, selectedPhotos]
  );

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY).then((stored) => {
      const saved = stored[STORAGE_KEY];
      if (Array.isArray(saved)) setPhotos(saved);
    });

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
  }, [applyScannerState, startSession]);

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

  const showQr = status === "waiting" && qrDataUrl;
  const isCreating = status === "creating";
  const selectedCount = selectedIds.size;
  const connected = status === "connected";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <MobileToolHeader
        icon={<ImagePlus className="h-4 w-4" />}
        title="Mobile Photos"
        subtitle="Capture from paired Volt app"
        status={status}
        error={error}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-4">
        {showQr ? (
          <div className="mb-5">
            <QrPairingPanel
              qrDataUrl={qrDataUrl}
              hint="Scan with Volt, then open the Photos tab on the phone."
            />
          </div>
        ) : isCreating ? (
          <div className="mb-5 flex justify-center">
            <PairingPlaceholder label="Setting up secure pairing…" />
          </div>
        ) : null}

        <div className="flex gap-2">
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
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-stone-900">Photos</div>
            <div className="text-xs text-stone-500">
              {photos.length} received{selectedCount ? `, ${selectedCount} selected` : ""}
            </div>
          </div>
          <div className="flex gap-1">
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
            <div className="flex flex-col items-center rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-9 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-stone-400 ring-1 ring-stone-200">
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
                    onDragStart={(event) => handleDragStart(event, photo)}
                    className={cn(
                      "group relative overflow-hidden rounded-2xl bg-stone-100 p-0 text-left shadow-sm transition",
                      "ring-1 ring-stone-200 hover:ring-green-500/60",
                      selected && "ring-2 ring-green-500 ring-offset-2 ring-offset-white",
                    )}
                  >
                    <img
                      src={photo.dataUrl}
                      alt={photo.name}
                      className="aspect-square w-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-stone-900/80 via-stone-900/40 to-transparent px-2.5 pb-1.5 pt-3 text-[11px] text-white">
                      <div className="truncate font-semibold">{photo.name}</div>
                      <div className="truncate opacity-80">
                        {[
                          photo.width && photo.height ? `${photo.width}×${photo.height}` : "",
                          formatSize(photo.size),
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
