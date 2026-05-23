import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle,
  Download,
  ImagePlus,
  Loader2,
  QrCode,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import QRCode from "qrcode";
import { Button } from "../ui/button";
import type { ScannerConnectionStatus } from "../../../../scanner-protocol/src";

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
      color: { dark: "#05070a", light: "#ffffff" },
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

  const startSession = useCallback(async () => {
    setStatus("creating");
    setError(null);
    const response = await chrome.runtime.sendMessage({ action: "scannerStart" });
    if (response?.state) applyScannerState(response.state);
    if (response?.error) {
      setStatus("error");
      setError(response.error);
    }
  }, [applyScannerState]);

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
  const selectedCount = selectedIds.size;

  return (
    <div className="flex h-full flex-col overflow-hidden p-4">
      <div className="mb-3 text-center">
        <div className="flex items-center justify-center gap-2 text-lg font-semibold">
          <ImagePlus className="h-5 w-5" />
          Mobile Photos
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Uses the same paired Volt app session as Mobile Scanner
        </p>
      </div>

      <div className="mb-3 flex items-center justify-center gap-2">
        {status === "creating" && <><Loader2 className="h-4 w-4 animate-spin text-blue-500" /><span className="text-sm text-blue-500">Setting up...</span></>}
        {status === "waiting" && <><QrCode className="h-4 w-4 text-yellow-500" /><span className="text-sm text-yellow-500">Waiting for Volt app</span></>}
        {status === "connected" && <><CheckCircle className="h-4 w-4 text-green-500" /><span className="text-sm text-green-500">Connected</span></>}
        {status === "disconnected" && <><XCircle className="h-4 w-4 text-gray-500" /><span className="text-sm text-gray-500">Disconnected</span></>}
        {status === "error" && <><XCircle className="h-4 w-4 text-red-500" /><span className="text-sm text-red-500">{error}</span></>}
      </div>

      {showQr ? (
        <div className="mb-3 flex flex-col items-center">
          <div className="relative w-full max-w-[260px] rounded-lg bg-white p-3 shadow-lg">
            <img src={qrDataUrl} alt="Scan this QR code to pair the Volt mobile app" className="aspect-square w-full" />
            <div className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
              <img src={chrome.runtime.getURL("/assets/icons/logo-128.png")} alt="" aria-hidden="true" className="h-full w-full object-contain" />
            </div>
          </div>
          <p className="mt-2 max-w-[280px] text-center text-xs text-muted-foreground">
            Scan this QR with Volt, then use the Photos tab on the phone.
          </p>
        </div>
      ) : null}

      <div className="mb-3 flex gap-2">
        {status === "connected" ? (
          <Button onClick={unpair} variant="outline" className="flex-1">
            <RefreshCw className="mr-2 h-4 w-4" />
            Disconnect
          </Button>
        ) : (
          <Button onClick={startSession} variant="outline" className="flex-1">
            <RefreshCw className="mr-2 h-4 w-4" />
            Restart Pairing
          </Button>
        )}
        <Button variant="outline" size="icon" onClick={clearPhotos} disabled={!photos.length} title="Clear photos">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Photos</div>
          <div className="text-xs text-muted-foreground">
            {photos.length} received{selectedCount ? `, ${selectedCount} selected` : ""}
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={downloadSelected} disabled={!selectedCount}>
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={deleteSelected} disabled={!selectedCount}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {photos.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Captured phone photos will appear here. Select one or more, then drag them into a page photo uploader.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {photos.map((photo) => {
              const selected = selectedIds.has(photo.id);
              return (
                <button
                  key={photo.id}
                  type="button"
                  draggable
                  onClick={() => togglePhoto(photo.id)}
                  onDragStart={(event) => handleDragStart(event, photo)}
                  className={[
                    "group relative overflow-hidden rounded-lg border bg-card p-0 text-left shadow-sm transition",
                    selected ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/60",
                  ].join(" ")}
                >
                  <img src={photo.dataUrl} alt={photo.name} className="aspect-square w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-black/55 px-2 py-1 text-[11px] text-white">
                    <div className="truncate font-medium">{photo.name}</div>
                    <div className="truncate opacity-80">
                      {[photo.width && photo.height ? `${photo.width}x${photo.height}` : "", formatSize(photo.size)]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <span className={["absolute right-2 top-2 h-4 w-4 rounded-full border-2 border-white", selected ? "bg-primary" : "bg-black/30"].join(" ")} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
