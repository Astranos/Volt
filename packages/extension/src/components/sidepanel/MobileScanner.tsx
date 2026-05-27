import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  ImagePlus,
  Loader2,
  QrCode,
  RefreshCw,
  Scan,
  ScanLine,
  Smartphone,
  Trash2,
  Type,
  Upload,
  X,
  Check,
} from "lucide-react";
import QRCode from "qrcode";
import { cn } from "../../lib/utils";
import { ConnectionPill } from "./mobile-shared";
import { ScrollArea } from "../ui/scroll-area";
import {
  showSidepanelToast,
  type SidepanelToastTone,
} from "../../lib/sidepanel-toast";
import {
  PHOTO_DROP_MIME,
  dataUrlToFile,
  dataUrlToPngBlob,
  formatPhotoSize,
  insertPhotosIntoPage,
  installPhotoDropBridge,
  normalizeImageFilename,
  type MobilePhoto,
} from "./mobile-photo-helpers";
import type {
  BarcodeMessage,
  ScannerConnectionStatus,
} from "../../../../scanner-protocol/src";

const SCAN_STORAGE_KEY = "volt.mobileScanner.scans";
const PHOTO_STORAGE_KEY = "volt.mobilePhotos.photos";
const MAX_SCANS = 100;
const MAX_PHOTOS = 80;
const CLUSTER_WINDOW_MS = 3 * 60 * 1000;
const EXIT_ANIMATION_MS = 200;

type MobileScannerState = {
  status: ScannerConnectionStatus;
  qrCodeUrl: string | null;
  error: string | null;
};

type ScanRecord = BarcodeMessage & {
  id: string;
  copied?: boolean;
};

type ScanEntry = {
  type: "scan";
  id: string;
  createdAt: number;
  scan: ScanRecord;
};

type PhotoEntry = {
  type: "photo";
  id: string;
  createdAt: number;
  photo: MobilePhoto;
};

type HistoryEntry = ScanEntry | PhotoEntry;

type ClusterKind = "text" | "barcode" | "photo";

type Cluster = {
  key: string;
  kind: ClusterKind;
  startAt: number;
  endAt: number;
  entries: HistoryEntry[];
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

function installEditableTracker() {
  const root = window as typeof window & {
    __voltLastEditable?: HTMLElement | null;
    __voltEditableTrackerInstalled?: boolean;
  };

  const isEditable = (element: Element | null): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false;
    return (
      element.tagName === "INPUT" ||
      element.tagName === "TEXTAREA" ||
      element.isContentEditable
    );
  };

  const describeEditable = (element: HTMLElement) => {
    const label =
      element.getAttribute("aria-label") ||
      element.getAttribute("placeholder") ||
      element.getAttribute("name") ||
      element.getAttribute("id") ||
      (element.tagName === "TEXTAREA"
        ? "Textarea"
        : element.isContentEditable
          ? "Editable text"
          : "Text input");
    return String(label).slice(0, 120);
  };

  const notifyTarget = (element: HTMLElement) => {
    try {
      chrome.runtime.sendMessage({
        action: "mobileCursorTargetChanged",
        target: {
          browser: "Chrome",
          tabTitle: document.title || "Current tab",
          url: location.href,
          cursor: describeEditable(element),
        },
      });
    } catch (_error) {}
  };

  if (isEditable(document.activeElement)) {
    root.__voltLastEditable = document.activeElement;
    notifyTarget(document.activeElement);
  }

  if (root.__voltEditableTrackerInstalled) return;

  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      const editableTarget = target instanceof Element ? target : null;
      if (isEditable(editableTarget)) {
        root.__voltLastEditable = editableTarget;
        notifyTarget(editableTarget);
      }
    },
    true,
  );
  root.__voltEditableTrackerInstalled = true;
}

function entryTimestamp(entry: HistoryEntry): number {
  if (entry.type === "scan") {
    const raw = entry.scan.scannedAt;
    return raw ? new Date(raw).getTime() || entry.createdAt : entry.createdAt;
  }
  const raw = entry.photo.capturedAt;
  return raw ? new Date(raw).getTime() || entry.createdAt : entry.createdAt;
}

function entryClusterKind(entry: HistoryEntry): ClusterKind {
  if (entry.type === "photo") return "photo";
  return entry.scan.kind === "text" ? "text" : "barcode";
}

function buildClusters(entries: HistoryEntry[]): Cluster[] {
  const sorted = [...entries].sort(
    (a, b) => entryTimestamp(b) - entryTimestamp(a),
  );
  const clusters: Cluster[] = [];
  for (const entry of sorted) {
    const kind = entryClusterKind(entry);
    const ts = entryTimestamp(entry);
    const current = clusters[clusters.length - 1];
    if (
      current &&
      current.kind === kind &&
      Math.abs(current.endAt - ts) <= CLUSTER_WINDOW_MS
    ) {
      current.entries.push(entry);
      current.startAt = Math.min(current.startAt, ts);
      current.endAt = Math.max(current.endAt, ts);
    } else {
      clusters.push({
        key: `${kind}-${entry.id}`,
        kind,
        startAt: ts,
        endAt: ts,
        entries: [entry],
      });
    }
  }
  return clusters;
}

function formatRelativeTime(timestamp: number, now: number) {
  const diff = now - timestamp;
  if (diff < 45 * 1000) return "just now";
  if (diff < 60 * 60 * 1000) {
    const mins = Math.max(1, Math.round(diff / 60000));
    return `${mins}m ago`;
  }
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.round(diff / (60 * 60 * 1000));
    return `${hours}h ago`;
  }
  if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.round(diff / (24 * 60 * 60 * 1000));
    return `${days}d ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}

interface MobileScannerProps {
  onClose?: () => void;
}

export default function MobileScanner({ onClose: _onClose }: MobileScannerProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<ScannerConnectionStatus>("disconnected");
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [photos, setPhotos] = useState<MobilePhoto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [enteringIds, setEnteringIds] = useState<Set<string>>(new Set());
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(
    new Set(),
  );
  const [collapsedClusters, setCollapsedClusters] = useState<Set<string>>(
    new Set(),
  );
  const [now, setNow] = useState(() => Date.now());
  const initialEntriesLoaded = useRef(false);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  const generateQrCode = useCallback(async (url: string) => {
    return QRCode.toDataURL(url, {
      width: 768,
      margin: 3,
      errorCorrectionLevel: "H",
      color: { dark: "#1c1917", light: "#ffffff" },
    });
  }, []);

  const persistScans = useCallback((nextScans: ScanRecord[]) => {
    void chrome.storage.local.set({ [SCAN_STORAGE_KEY]: nextScans });
  }, []);

  const persistPhotos = useCallback((nextPhotos: MobilePhoto[]) => {
    void chrome.storage.local.set({ [PHOTO_STORAGE_KEY]: trimPhotosForStorage(nextPhotos) });
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
    [generateQrCode],
  );

  const markEntering = useCallback((id: string) => {
    setEnteringIds((curr) => {
      const next = new Set(curr);
      next.add(id);
      return next;
    });
    window.setTimeout(() => {
      setEnteringIds((curr) => {
        if (!curr.has(id)) return curr;
        const next = new Set(curr);
        next.delete(id);
        return next;
      });
    }, 320);
  }, []);

  const addScan = useCallback(
    (message: BarcodeMessage) => {
      const scan: ScanRecord = {
        ...message,
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        kind: message.kind ?? "barcode",
        scannedAt: message.scannedAt ?? new Date().toISOString(),
      };

      setScans((current) => {
        const next = [scan, ...current].slice(0, MAX_SCANS);
        persistScans(next);
        return next;
      });
      markEntering(scan.id);
    },
    [markEntering, persistScans],
  );

  const addPhoto = useCallback(
    (photo: MobilePhoto) => {
      setPhotos((current) => {
        const next = trimPhotosForState([
          photo,
          ...current.filter((item) => item.id !== photo.id),
        ]);
        persistPhotos(next);
        return next;
      });
      markEntering(photo.id);
    },
    [markEntering, persistPhotos],
  );

  const selectedPhotos = useMemo(
    () => photos.filter((photo) => selectedPhotoIds.has(photo.id)),
    [photos, selectedPhotoIds],
  );

  const togglePhotoSelection = useCallback((id: string) => {
    setSelectedPhotoIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const primeCursorTarget = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: installEditableTracker,
      });
    } catch (_err) {
      // restricted page – dictation falls back to clipboard
    }
  }, []);

  const prepareActiveTabForPhotoDrop = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: installPhotoDropBridge,
        args: [PHOTO_DROP_MIME],
      });
    } catch (_err) {
      // restricted page – native drag payload still works
    }
  }, []);

  const startSession = useCallback(
    async (force = false) => {
      setStatus("creating");
      setError(null);
      const response = await chrome.runtime.sendMessage({
        action: "scannerStart",
        force,
      });
      if (response?.state) applyScannerState(response.state);
      if (response?.error) {
        setStatus("error");
        setError(response.error);
      }
    },
    [applyScannerState],
  );

  const unpair = useCallback(() => {
    void chrome.runtime
      .sendMessage({ action: "scannerDisconnect" })
      .then((response) => {
        if (response?.state) applyScannerState(response.state);
      });
  }, [applyScannerState]);

  const removeWithAnimation = useCallback(
    (id: string, commit: () => void) => {
      setRemovingIds((curr) => {
        const next = new Set(curr);
        next.add(id);
        return next;
      });
      window.setTimeout(() => {
        commit();
        setRemovingIds((curr) => {
          if (!curr.has(id)) return curr;
          const next = new Set(curr);
          next.delete(id);
          return next;
        });
      }, EXIT_ANIMATION_MS);
    },
    [],
  );

  const deleteScan = useCallback(
    (id: string) => {
      removeWithAnimation(id, () => {
        setScans((curr) => {
          const next = curr.filter((s) => s.id !== id);
          persistScans(next);
          return next;
        });
      });
    },
    [persistScans, removeWithAnimation],
  );

  const deletePhoto = useCallback(
    (id: string) => {
      removeWithAnimation(id, () => {
        setPhotos((curr) => {
          const next = curr.filter((p) => p.id !== id);
          persistPhotos(next);
          return next;
        });
        setSelectedPhotoIds((curr) => {
          if (!curr.has(id)) return curr;
          const next = new Set(curr);
          next.delete(id);
          return next;
        });
      });
    },
    [persistPhotos, removeWithAnimation],
  );

  const deleteCluster = useCallback(
    (cluster: Cluster) => {
      const ids = new Set(cluster.entries.map((e) => e.id));
      setRemovingIds((curr) => {
        const next = new Set(curr);
        ids.forEach((id) => next.add(id));
        return next;
      });
      window.setTimeout(() => {
        if (cluster.kind === "photo") {
          setPhotos((curr) => {
            const next = curr.filter((p) => !ids.has(p.id));
            persistPhotos(next);
            return next;
          });
          setSelectedPhotoIds((curr) => {
            const next = new Set(curr);
            ids.forEach((id) => next.delete(id));
            return next;
          });
        } else {
          setScans((curr) => {
            const next = curr.filter((s) => !ids.has(s.id));
            persistScans(next);
            return next;
          });
        }
        setRemovingIds((curr) => {
          const next = new Set(curr);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }, EXIT_ANIMATION_MS);
    },
    [persistPhotos, persistScans],
  );

  const clearAll = useCallback(() => {
    const allIds = new Set<string>([
      ...scans.map((s) => s.id),
      ...photos.map((p) => p.id),
    ]);
    if (allIds.size === 0) return;
    setRemovingIds((curr) => {
      const next = new Set(curr);
      allIds.forEach((id) => next.add(id));
      return next;
    });
    window.setTimeout(() => {
      setScans([]);
      setPhotos([]);
      setSelectedPhotoIds(new Set());
      persistScans([]);
      persistPhotos([]);
      setRemovingIds(new Set());
    }, EXIT_ANIMATION_MS);
  }, [persistPhotos, persistScans, photos, scans]);

  const flashFeedback = useCallback(
    (message: string, tone: SidepanelToastTone = "success") => {
      showSidepanelToast(message, tone);
    },
    [],
  );

  const copyScan = useCallback(
    async (scan: ScanRecord) => {
      try {
        await navigator.clipboard.writeText(scan.barcode);
        setScans((curr) =>
          curr.map((item) =>
            item.id === scan.id ? { ...item, copied: true } : item,
          ),
        );
        flashFeedback(
          scan.kind === "text"
            ? "Text snippet copied!"
            : "Code stashed in clipboard",
        );
      } catch (_err) {
        flashFeedback("Clipboard wouldn't budge", "error");
      }
    },
    [flashFeedback],
  );

  const copyPhoto = useCallback(
    async (photo: MobilePhoto) => {
      try {
        if (!photo.dataUrl) {
          await navigator.clipboard.writeText(photo.downloadFilename ?? photo.name);
          flashFeedback("Saved photo path copied");
          return;
        }
        if ("ClipboardItem" in window && navigator.clipboard?.write) {
          const blob = await dataUrlToPngBlob(photo.dataUrl);
          await navigator.clipboard.write([
            new ClipboardItem({ "image/png": blob }),
          ]);
          flashFeedback("Photo on the clipboard");
          return;
        }
        await navigator.clipboard.writeText(
          normalizeImageFilename(photo.name, photo.mimeType),
        );
        flashFeedback("Photo name copied");
      } catch (_err) {
        flashFeedback("Couldn't copy that photo", "error");
      }
    },
    [flashFeedback],
  );

  const downloadPhoto = useCallback((photo: MobilePhoto) => {
    if (typeof photo.downloadId === "number") {
      chrome.downloads.show(photo.downloadId);
      flashFeedback("Showing saved photo");
      return;
    }
    if (!photo.dataUrl) {
      flashFeedback("Photo is already saved in Downloads", "warning");
      return;
    }
    const link = document.createElement("a");
    link.href = photo.dataUrl;
    link.download = normalizeImageFilename(photo.name, photo.mimeType);
    link.click();
  }, [flashFeedback]);

  const sendPhotosToTab = useCallback(
    async (photosToSend: MobilePhoto[]) => {
      try {
        const transferablePhotos = photosToSend.filter((photo) => photo.dataUrl);
        if (!transferablePhotos.length) {
          flashFeedback("Photo is already saved in Downloads", "warning");
          return;
        }
        const [tab] = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab?.id) {
          flashFeedback("No active tab to receive it", "warning");
          return;
        }
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: insertPhotosIntoPage,
          args: [
            transferablePhotos.map((photo) => ({
              dataUrl: photo.dataUrl!,
              name: photo.name,
              mimeType: photo.mimeType,
            })),
          ],
        });
        const payload = result?.result as
          | { inserted?: boolean; reason?: string }
          | undefined;
        if (!payload?.inserted) {
          flashFeedback(
            payload?.reason === "no_file_input"
              ? "No upload field on this page"
              : "Couldn't drop the photo",
            "warning",
          );
          return;
        }
        flashFeedback(
          transferablePhotos.length === 1
            ? "Photo dropped into the page!"
            : `${transferablePhotos.length} photos dropped into the page!`,
        );
      } catch (_err) {
        flashFeedback("Tab access denied", "error");
      }
    },
    [flashFeedback],
  );

  const sendPhotoToTab = useCallback(
    async (photo: MobilePhoto) => {
      const photosToSend = selectedPhotoIds.has(photo.id)
        ? selectedPhotos
        : [photo];
      await sendPhotosToTab(photosToSend);
    },
    [selectedPhotoIds, selectedPhotos, sendPhotosToTab],
  );

  const handlePhotoDragStart = useCallback(
    (event: React.DragEvent, photo: MobilePhoto) => {
      void prepareActiveTabForPhotoDrop();
      const dragPhotos = selectedPhotoIds.has(photo.id) ? selectedPhotos : [photo];
      const transferablePhotos = dragPhotos.filter((item) => item.dataUrl);
      if (!transferablePhotos.length) {
        event.preventDefault();
        flashFeedback("Photo is already saved in Downloads", "warning");
        return;
      }
      if (!selectedPhotoIds.has(photo.id)) {
        setSelectedPhotoIds(new Set([photo.id]));
      }
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(PHOTO_DROP_MIME, JSON.stringify(transferablePhotos));
      const files = transferablePhotos
        .map((item) => dataUrlToFile(item.dataUrl!, item.name, item.mimeType))
        .filter((file): file is File => Boolean(file));
      for (const file of files) {
        try {
          event.dataTransfer.items.add(file);
        } catch (_err) {
          // some extension drag contexts reject programmatic file items
        }
      }
      event.dataTransfer.setData(
        "text/uri-list",
        transferablePhotos.map((item) => item.dataUrl!).join("\n"),
      );
      event.dataTransfer.setData(
        "text/html",
        transferablePhotos
          .map((item) => `<img src="${item.dataUrl}" alt="${item.name}">`)
          .join(""),
      );
      event.dataTransfer.setData(
        "text/plain",
        transferablePhotos.map((item) => item.name).join("\n"),
      );
    },
    [flashFeedback, prepareActiveTabForPhotoDrop, selectedPhotoIds, selectedPhotos],
  );

  const toggleCluster = useCallback((key: string) => {
    setCollapsedClusters((curr) => {
      const next = new Set(curr);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    void chrome.storage.local
      .get([SCAN_STORAGE_KEY, PHOTO_STORAGE_KEY])
      .then((stored) => {
        const savedScans = stored[SCAN_STORAGE_KEY];
        if (Array.isArray(savedScans)) setScans(savedScans);
        const savedPhotos = stored[PHOTO_STORAGE_KEY];
        if (Array.isArray(savedPhotos)) setPhotos(savedPhotos);
        initialEntriesLoaded.current = true;
      });

    void primeCursorTarget();
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
  }, [applyScannerState, primeCursorTarget, startSession]);

  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message?.action === "scannerStateChanged") {
        applyScannerState(message.state);
      } else if (message?.action === "scannerScan") {
        addScan(message.scan);
      } else if (message?.action === "scannerPhoto") {
        addPhoto(message.photo);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [addPhoto, addScan, applyScannerState]);

  useEffect(() => {
    if (photos.length === 0) return;
    void prepareActiveTabForPhotoDrop();
  }, [photos.length, prepareActiveTabForPhotoDrop]);

  // Auto-regenerate session whenever no session is active. The brief delay
  // avoids fighting with intentional rapid state transitions (e.g. on mount).
  useEffect(() => {
    if (status !== "disconnected") return;
    const handle = window.setTimeout(() => {
      void startSession(true);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [status, startSession]);

  const entries = useMemo<HistoryEntry[]>(() => {
    const scanEntries: HistoryEntry[] = scans.map((scan) => ({
      type: "scan",
      id: scan.id,
      createdAt: scan.scannedAt
        ? new Date(scan.scannedAt).getTime() || Date.now()
        : Date.now(),
      scan,
    }));
    const photoEntries: HistoryEntry[] = photos.map((photo) => ({
      type: "photo",
      id: photo.id,
      createdAt: photo.capturedAt
        ? new Date(photo.capturedAt).getTime() || Date.now()
        : Date.now(),
      photo,
    }));
    return [...scanEntries, ...photoEntries];
  }, [photos, scans]);

  const clusters = useMemo(() => buildClusters(entries), [entries]);

  const totalCount = entries.length;

  return (
    <div className="sidepanel-shell relative flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex-none px-3 pt-3">
        <UnifiedPairingCard
          status={status}
          qrDataUrl={qrDataUrl}
          error={error}
          onForceRestart={() => startSession(true)}
          onDisconnect={unpair}
        />
      </div>

      <div className="flex-none min-w-0 px-4 pb-2 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-stone-900 dark:text-stone-50">
              History
            </div>
            <div className="truncate text-xs text-stone-500 dark:text-stone-400">
              {totalCount === 0
                ? "Captures and photos land here"
                : `${totalCount} item${totalCount === 1 ? "" : "s"} from this browser`}
            </div>
          </div>
          <button
            type="button"
            onClick={clearAll}
            disabled={totalCount === 0}
            aria-label="Clear history"
            className="liquid-glass-soft inline-flex h-9 w-9 items-center justify-center rounded-full text-stone-600 transition hover:text-stone-900 active:scale-95 disabled:opacity-40 dark:text-stone-300 dark:hover:text-stone-50"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1 px-3 pb-3 [&>div]:!overflow-x-hidden">
        <div className="min-w-0 space-y-3 pt-1">
          {clusters.length === 0 ? (
            <EmptyHistory />
          ) : (
            clusters.map((cluster) => (
              <ClusterCard
                key={cluster.key}
                cluster={cluster}
                now={now}
                removingIds={removingIds}
                enteringIds={enteringIds}
                collapsed={collapsedClusters.has(cluster.key)}
                onToggleCollapse={() => toggleCluster(cluster.key)}
                onDeleteCluster={() => deleteCluster(cluster)}
                onDeleteScan={deleteScan}
                onDeletePhoto={deletePhoto}
                onCopyScan={copyScan}
                onCopyPhoto={copyPhoto}
                onDownloadPhoto={downloadPhoto}
                onSendPhoto={sendPhotoToTab}
                onPhotoDragStart={handlePhotoDragStart}
                onPhotoHover={prepareActiveTabForPhotoDrop}
                selectedPhotoIds={selectedPhotoIds}
                onTogglePhotoSelection={togglePhotoSelection}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function UnifiedPairingCard({
  status,
  qrDataUrl,
  error,
  onForceRestart,
  onDisconnect,
}: {
  status: ScannerConnectionStatus;
  qrDataUrl: string | null;
  error: string | null;
  onForceRestart: () => void;
  onDisconnect: () => void;
}) {
  const showQr = Boolean(qrDataUrl) && (status === "waiting" || status === "connected");
  const isCreating = status === "creating";
  const connected = status === "connected";
  const hasError = status === "error";
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    if (!showQr) setQrOpen(false);
  }, [showQr]);

  const statusCopy = connected
    ? "Ready for captures · QR available"
    : showQr
      ? "Waiting for iPhone"
      : isCreating
        ? "Preparing pairing…"
        : hasError
          ? (error ?? "Pairing failed")
          : "Generating a new session…";

  return (
    <div className={cn(
      "liquid-glass concentric-xl min-w-0 overflow-hidden",
      connected ? "p-2.5" : "p-3.5",
    )}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn(
            "liquid-glass-soft flex shrink-0 items-center justify-center rounded-full text-green-700 dark:text-green-300",
            connected ? "h-8 w-8" : "h-9 w-9",
          )}>
            <Smartphone className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-stone-900 dark:text-stone-50">
              Volt App Clip
            </div>
            <div className="truncate text-[11px] font-medium text-stone-500 dark:text-stone-400">
              {statusCopy}
            </div>
          </div>
        </div>
        <div className="min-w-0 shrink">
          {connected ? (
            <button
              type="button"
              onClick={onDisconnect}
              aria-label="Pair a different iPhone"
              className="liquid-glass-soft inline-flex h-8 w-8 items-center justify-center rounded-full text-stone-600 transition hover:bg-white/70 hover:text-stone-900 active:scale-95 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-stone-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          ) : (
            <ConnectionPill status={status} error={error} />
          )}
        </div>
      </div>

      {showQr ? (
        <>
          <PairingQrAction
            connected={connected}
            onOpen={() => setQrOpen(true)}
          />
          <div className="mt-3">
            <button
              type="button"
              onClick={onForceRestart}
              className="liquid-glass-soft inline-flex h-9 w-full items-center justify-center gap-2 rounded-full text-xs font-bold text-stone-600 transition hover:text-stone-900 active:scale-[0.99] dark:text-stone-300 dark:hover:text-stone-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Generate a new QR
            </button>
          </div>
          {qrOpen && qrDataUrl ? (
            <PairingQrOverlay
              connected={connected}
              qrDataUrl={qrDataUrl}
              onClose={() => setQrOpen(false)}
            />
          ) : null}
        </>
      ) : !connected ? (
        <PairingSlot
          status={status}
          qrDataUrl={qrDataUrl}
          error={error}
        />
      ) : null}
    </div>
  );
}

function PairingQrAction({
  connected,
  onOpen,
}: {
  connected: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="mt-3 rounded-2xl border border-stone-200/70 bg-white/45 p-3 dark:border-stone-700/70 dark:bg-white/[0.04]">
      <div className="flex items-center gap-3">
        <span className="liquid-glass-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-green-700 dark:text-green-300">
          <QrCode className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold text-stone-800 dark:text-stone-100">
            Pairing QR
          </div>
          <p className="mt-0.5 text-[11px] font-medium leading-4 text-stone-500 dark:text-stone-400">
            {connected
              ? "Available for reconnecting this session."
              : "Open it when you are ready to scan."}
          </p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="liquid-glass-soft inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full px-3 text-xs font-bold text-stone-700 transition hover:text-stone-950 active:scale-[0.98] dark:text-stone-200 dark:hover:text-stone-50"
        >
          <QrCode className="h-3.5 w-3.5" />
          Show
        </button>
      </div>
    </div>
  );
}

function PairingQrOverlay({
  connected,
  qrDataUrl,
  onClose,
}: {
  connected: boolean;
  qrDataUrl: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-stone-950/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Pair iPhone with Volt App Clip"
      onClick={onClose}
    >
      <div
        className="liquid-glass concentric-xl w-full max-w-[300px] p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-stone-900 dark:text-stone-50">
              Pair iPhone
            </div>
            <div className="truncate text-[11px] font-medium text-stone-500 dark:text-stone-400">
              {connected ? "Reconnect to this session" : "Scan to open Volt"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close pairing QR"
            className="liquid-glass-soft inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-600 transition hover:text-stone-950 active:scale-95 dark:text-stone-300 dark:hover:text-stone-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <QrPanel
          qrDataUrl={qrDataUrl}
          hint={
            connected
              ? "Scan this QR to reopen or pair the iPhone to this session."
              : "Scan with the iPhone Camera app to open Volt."
          }
        />
      </div>
    </div>
  );
}

function PairingSlot({
  status,
  qrDataUrl,
  error,
}: {
  status: ScannerConnectionStatus;
  qrDataUrl: string | null;
  error: string | null;
}) {
  const showQr = Boolean(qrDataUrl) && (status === "waiting" || status === "connected");
  const isCreating = status === "creating";
  const connected = status === "connected";
  const hasError = status === "error";
  const isDisconnected = status === "disconnected";

  // Defer the actual unmount of the QR by one frame so the exit fade plays.
  const slotKey = showQr
    ? "qr"
    : connected
      ? "connected"
      : isCreating || isDisconnected
        ? "loading"
        : hasError
          ? "error"
          : "loading";

  return (
    <div className="relative mt-3 flex h-[248px] items-center justify-center overflow-hidden">
      {slotKey === "qr" && qrDataUrl ? (
        <SlotFader key="qr">
          <QrPanel
            qrDataUrl={qrDataUrl}
            hint={
              connected
                ? "Scan this QR to reopen or pair the iPhone to this session."
                : "Scan with the iPhone Camera app to open Volt."
            }
          />
        </SlotFader>
      ) : null}

      {slotKey === "connected" ? (
        <SlotFader key="connected">
          <ConnectedPanel />
        </SlotFader>
      ) : null}

      {slotKey === "loading" ? (
        <SlotFader key="loading">
          <LoadingPanel />
        </SlotFader>
      ) : null}

      {slotKey === "error" ? (
        <SlotFader key="error">
          <ErrorPanel error={error} />
        </SlotFader>
      ) : null}
    </div>
  );
}

function SlotFader({ children }: { children: React.ReactNode }) {
  return (
    <div className="volt-fade-in absolute inset-0 flex w-full items-center justify-center">
      {children}
    </div>
  );
}

function QrPanel({
  qrDataUrl,
  hint,
}: {
  qrDataUrl: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-full max-w-[200px] overflow-hidden rounded-2xl bg-white p-2.5 ring-1 ring-stone-200 dark:ring-stone-700">
        <img
          src={qrDataUrl}
          alt="Scan this QR code with the iPhone Camera"
          className="aspect-square w-full rounded-xl"
        />
        <div className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-white p-1.5 ring-1 ring-stone-200">
          <img
            src={chrome.runtime.getURL("/assets/icons/logo-128.png")}
            alt=""
            aria-hidden="true"
            className="h-full w-full object-contain"
          />
        </div>
      </div>
      <p className="mt-2.5 max-w-[220px] text-center text-[11px] font-medium text-stone-500 dark:text-stone-400">
        {hint}
      </p>
    </div>
  );
}

function ConnectedPanel() {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative">
        <span className="absolute inset-0 rounded-full bg-green-500/30 blur-md" />
        <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-white shadow-lg shadow-green-700/30 dark:bg-green-400 dark:text-green-950">
          <CheckCircle2 className="h-7 w-7" />
        </span>
      </div>
      <div className="mt-3 text-sm font-bold text-stone-900 dark:text-stone-50">
        iPhone paired
      </div>
      <p className="mt-1 max-w-[220px] text-[11px] font-medium text-stone-500 dark:text-stone-400">
        Capture from the App Clip and results land in the history.
      </p>
    </div>
  );
}

function LoadingPanel() {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </span>
      <div className="mt-3 text-sm font-bold text-stone-700 dark:text-stone-200">
        Preparing pairing
      </div>
      <p className="mt-1 max-w-[220px] text-[11px] font-medium text-stone-500 dark:text-stone-400">
        A fresh QR code will appear in a moment.
      </p>
    </div>
  );
}

function ErrorPanel({ error }: { error: string | null }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-300">
        <X className="h-7 w-7" />
      </span>
      <div className="mt-3 text-sm font-bold text-stone-900 dark:text-stone-50">
        Could not pair
      </div>
      <p className="mt-1 max-w-[240px] text-[11px] font-medium text-stone-500 dark:text-stone-400">
        {error ?? "Tap “Generate a new QR” to retry."}
      </p>
    </div>
  );
}

function EmptyHistory() {
  return (
    <div className="liquid-glass-soft concentric-lg flex flex-col items-center border border-dashed border-stone-300/70 px-4 py-9 text-center dark:border-stone-700/70">
      <div className="liquid-glass-soft mb-3 flex h-12 w-12 items-center justify-center rounded-full text-stone-400 dark:text-stone-500">
        <Scan className="h-5 w-5" />
      </div>
      <p className="text-sm font-semibold text-stone-700 dark:text-stone-200">
        Nothing here yet
      </p>
      <p className="mt-1 max-w-[260px] text-xs text-stone-500 dark:text-stone-400">
        Scan a barcode, capture text, dictate, or send a photo from iPhone.
        Everything appears in this unified feed.
      </p>
    </div>
  );
}

const CLUSTER_META: Record<
  ClusterKind,
  {
    label: (count: number) => string;
    icon: React.ComponentType<{ className?: string }>;
    accent: string;
    badgeBg: string;
  }
> = {
  text: {
    label: (n) => (n === 1 ? "Text capture" : `${n} text captures`),
    icon: Type,
    accent: "text-amber-700 dark:text-amber-300",
    badgeBg: "bg-amber-100/80 dark:bg-amber-500/15",
  },
  barcode: {
    label: (n) => (n === 1 ? "Barcode" : `${n} barcodes`),
    icon: ScanLine,
    accent: "text-green-700 dark:text-green-300",
    badgeBg: "bg-green-100/80 dark:bg-green-500/15",
  },
  photo: {
    label: (n) => (n === 1 ? "Photo" : `${n} photos`),
    icon: ImagePlus,
    accent: "text-orange-700 dark:text-orange-300",
    badgeBg: "bg-orange-100/80 dark:bg-orange-500/15",
  },
};

function ClusterCard({
  cluster,
  now,
  removingIds,
  enteringIds,
  selectedPhotoIds,
  collapsed,
  onToggleCollapse,
  onDeleteCluster,
  onDeleteScan,
  onDeletePhoto,
  onCopyScan,
  onCopyPhoto,
  onDownloadPhoto,
  onSendPhoto,
  onPhotoDragStart,
  onPhotoHover,
  onTogglePhotoSelection,
}: {
  cluster: Cluster;
  now: number;
  removingIds: Set<string>;
  enteringIds: Set<string>;
  selectedPhotoIds: Set<string>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onDeleteCluster: () => void;
  onDeleteScan: (id: string) => void;
  onDeletePhoto: (id: string) => void;
  onCopyScan: (scan: ScanRecord) => void;
  onCopyPhoto: (photo: MobilePhoto) => void;
  onDownloadPhoto: (photo: MobilePhoto) => void;
  onSendPhoto: (photo: MobilePhoto) => void;
  onPhotoDragStart: (event: React.DragEvent, photo: MobilePhoto) => void;
  onPhotoHover: () => void;
  onTogglePhotoSelection: (id: string) => void;
}) {
  const meta = CLUSTER_META[cluster.kind];
  const Icon = meta.icon;
  const count = cluster.entries.length;
  const collapsible = count > 2;
  const isCollapsed = collapsible && collapsed;
  const visibleEntries = isCollapsed ? cluster.entries.slice(0, 1) : cluster.entries;
  const allEntriesRemoving = cluster.entries.every((entry) =>
    removingIds.has(entry.id),
  );
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const enterOnMount = cluster.entries.some((entry) =>
    enteringIds.has(entry.id),
  );
  useEffect(() => {
    if (!enterOnMount) return;
    const node = wrapperRef.current;
    if (!node) return;
    node.classList.add("volt-item-enter");
    const handle = window.setTimeout(() => {
      node.classList.remove("volt-item-enter");
    }, 320);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "liquid-glass-soft concentric-lg min-w-0 max-w-full overflow-hidden",
        allEntriesRemoving && "volt-item-exit",
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 px-3 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
              meta.badgeBg,
              meta.accent,
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-stone-900 dark:text-stone-100">
              {meta.label(count)}
            </div>
            <div className="truncate text-[10px] font-medium text-stone-500 dark:text-stone-400">
              {formatRelativeTime(cluster.endAt, now)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {collapsible ? (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-stone-100 px-2 text-[10px] font-bold text-stone-700 transition hover:bg-stone-200 dark:bg-stone-700 dark:text-stone-100 dark:hover:bg-stone-600"
              aria-label={isCollapsed ? "Expand group" : "Collapse group"}
            >
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  isCollapsed && "-rotate-90",
                )}
              />
              {isCollapsed ? `+${count - 1}` : "Hide"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDeleteCluster}
            className="flex h-7 w-7 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-50"
            aria-label="Delete this group"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="min-w-0 px-3 pb-3 pt-2">
        {cluster.kind === "photo" ? (
          <div
            className={cn(
              "grid gap-2",
              isCollapsed ? "grid-cols-1" : "grid-cols-2",
            )}
          >
            {visibleEntries.map((entry) =>
              entry.type === "photo" ? (
                <PhotoEntryCard
                  key={entry.id}
                  photo={entry.photo}
                  selected={selectedPhotoIds.has(entry.photo.id)}
                  exiting={removingIds.has(entry.id)}
                  entering={enteringIds.has(entry.id)}
                  onDelete={() => onDeletePhoto(entry.id)}
                  onCopy={() => onCopyPhoto(entry.photo)}
                  onDownload={() => onDownloadPhoto(entry.photo)}
                  onSend={() => onSendPhoto(entry.photo)}
                  onToggleSelected={() => onTogglePhotoSelection(entry.photo.id)}
                  onDragStart={(event) => onPhotoDragStart(event, entry.photo)}
                  onHover={onPhotoHover}
                />
              ) : null,
            )}
          </div>
        ) : (
          <div className="min-w-0 space-y-1.5">
            {visibleEntries.map((entry) =>
              entry.type === "scan" ? (
                <ScanEntryRow
                  key={entry.id}
                  scan={entry.scan}
                  exiting={removingIds.has(entry.id)}
                  entering={enteringIds.has(entry.id)}
                  onCopy={() => onCopyScan(entry.scan)}
                  onDelete={() => onDeleteScan(entry.id)}
                />
              ) : null,
            )}
          </div>
        )}

        {isCollapsed ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-full py-1.5 text-[11px] font-bold text-stone-500 transition hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
          >
            Show {count - 1} more
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ScanEntryRow({
  scan,
  exiting,
  entering,
  onCopy,
  onDelete,
}: {
  scan: ScanRecord;
  exiting: boolean;
  entering: boolean;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const isText = scan.kind === "text";

  return (
    <div
      className={cn(
        "group flex min-w-0 max-w-full flex-col gap-2 rounded-2xl bg-white/80 px-3 py-2 ring-1 ring-stone-200/70 transition dark:bg-stone-800/70 dark:ring-stone-700/70 min-[360px]:flex-row min-[360px]:items-start",
        entering && "volt-item-enter",
        exiting && "volt-item-exit",
      )}
    >
      <div className="min-w-0 max-w-full flex-1">
        <div
          className={cn(
            "text-[13px] font-semibold leading-snug text-stone-950 dark:text-stone-50",
            isText
              ? "line-clamp-3 break-words"
              : "break-all font-mono tracking-tight min-[360px]:truncate",
          )}
          title={scan.barcode}
        >
          {scan.barcode}
        </div>
        {scan.format ? (
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-stone-500 dark:text-stone-400">
            {scan.format}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-1 pt-0.5">
        <button
          type="button"
          onClick={onCopy}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-bold transition",
            scan.copied
              ? "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200"
              : "bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-700 dark:text-stone-100 dark:hover:bg-stone-600",
          )}
          aria-label={scan.copied ? "Copied" : "Copy"}
        >
          {scan.copied ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {scan.copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex h-7 w-7 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-50"
          aria-label="Delete"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function PhotoEntryCard({
  photo,
  selected,
  exiting,
  entering,
  onDelete,
  onCopy,
  onDownload,
  onSend,
  onToggleSelected,
  onDragStart,
  onHover,
}: {
  photo: MobilePhoto;
  selected: boolean;
  exiting: boolean;
  entering: boolean;
  onDelete: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onSend: () => void;
  onToggleSelected: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onHover: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onMouseEnter={onHover}
      onPointerDown={onHover}
      onClick={onToggleSelected}
      className={cn(
        "group relative overflow-hidden rounded-2xl bg-stone-50 ring-1 transition dark:bg-stone-800/70",
        selected
          ? "ring-2 ring-green-500 dark:ring-green-300"
          : "ring-stone-200/70 dark:ring-stone-700/70",
        entering && "volt-item-enter",
        exiting && "volt-item-exit",
        "cursor-grab active:cursor-grabbing",
      )}
    >
      <span
        className={cn(
          "absolute left-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full border text-white shadow-sm transition",
          selected
            ? "border-green-500 bg-green-500"
            : "border-white/80 bg-stone-950/30 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
        )}
        aria-hidden="true"
      >
        {selected ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
      {photo.dataUrl ? (
        <img
          src={photo.dataUrl}
          alt={photo.name}
          className="aspect-square w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-stone-100 px-3 text-center text-stone-500 dark:bg-stone-900 dark:text-stone-300">
          <Download className="h-7 w-7" />
          <span className="text-[11px] font-semibold">Saved to Downloads</span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-stone-900/85 via-stone-900/35 to-transparent px-2 pb-1.5 pt-6 text-[10px] text-white">
        <div className="truncate font-semibold">{photo.name}</div>
        <div className="truncate text-white/75">
          {[
            photo.width && photo.height
              ? `${photo.width}×${photo.height}`
              : "",
            formatPhotoSize(photo.size),
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

      <div className="absolute right-1 top-1 flex flex-col gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <PhotoActionButton onClick={onSend} label="Send to active tab">
          <Upload className="h-3 w-3" />
        </PhotoActionButton>
        <PhotoActionButton onClick={onCopy} label="Copy photo">
          <Copy className="h-3 w-3" />
        </PhotoActionButton>
        <PhotoActionButton onClick={onDownload} label="Download photo">
          <Download className="h-3 w-3" />
        </PhotoActionButton>
        <PhotoActionButton onClick={onDelete} label="Delete photo" danger>
          <X className="h-3 w-3" />
        </PhotoActionButton>
      </div>
    </div>
  );
}

function PhotoActionButton({
  onClick,
  label,
  children,
  danger,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      aria-label={label}
      className={cn(
        "flex h-6 w-6 items-center justify-center rounded-full backdrop-blur-md transition",
        danger
          ? "bg-red-500/85 text-white hover:bg-red-500"
          : "bg-white/85 text-stone-900 hover:bg-white",
      )}
    >
      {children}
    </button>
  );
}
