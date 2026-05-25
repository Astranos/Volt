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
  Images,
  Loader2,
  Mic,
  RefreshCw,
  Scan,
  ScanLine,
  Smartphone,
  TextCursorInput,
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
  mode: MobileCaptureMode | null;
};

type MobileCaptureMode = "ocr" | "barcode" | "dictation" | "photo";

const MODE_LABELS: Record<MobileCaptureMode, string> = {
  ocr: "Text OCR",
  barcode: "Barcode",
  dictation: "Dictation",
  photo: "Photos",
};

const MODE_OPTIONS: Array<{
  value: MobileCaptureMode;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "ocr", label: "Text", description: "OCR", icon: TextCursorInput },
  { value: "barcode", label: "Code", description: "UPC", icon: ScanLine },
  { value: "dictation", label: "Voice", description: "Speak", icon: Mic },
  { value: "photo", label: "Photos", description: "Upload", icon: Images },
];

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
  const [mode, setMode] = useState<MobileCaptureMode | null>("ocr");
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [enteringIds, setEnteringIds] = useState<Set<string>>(new Set());
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
    void chrome.storage.local.set({ [PHOTO_STORAGE_KEY]: nextPhotos });
  }, []);

  const applyScannerState = useCallback(
    (state: Partial<MobileScannerState> | null | undefined) => {
      if (!state) return;
      if (state.status) setStatus(state.status);
      if ("mode" in state) setMode(state.mode ?? "ocr");
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
        const next = [
          photo,
          ...current.filter((item) => item.id !== photo.id),
        ].slice(0, MAX_PHOTOS);
        persistPhotos(next);
        return next;
      });
      markEntering(photo.id);
    },
    [markEntering, persistPhotos],
  );

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
    async (force = false, nextMode = mode) => {
      setStatus("creating");
      setError(null);
      const response = await chrome.runtime.sendMessage({
        action: nextMode ? "scannerStartForMode" : "scannerStart",
        force,
        mode: nextMode,
      });
      if (response?.state) applyScannerState(response.state);
      if (response?.error) {
        setStatus("error");
        setError(response.error);
      }
    },
    [applyScannerState, mode],
  );

  const selectMode = useCallback(
    (nextMode: MobileCaptureMode) => {
      if (mode === nextMode) return;
      setMode(nextMode);
      void startSession(true, nextMode);
    },
    [mode, startSession],
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
    const link = document.createElement("a");
    link.href = photo.dataUrl;
    link.download = normalizeImageFilename(photo.name, photo.mimeType);
    link.click();
  }, []);

  const sendPhotoToTab = useCallback(
    async (photo: MobilePhoto) => {
      try {
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
          args: [[{ dataUrl: photo.dataUrl, name: photo.name, mimeType: photo.mimeType }]],
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
        flashFeedback("Photo dropped into the page!");
      } catch (_err) {
        flashFeedback("Tab access denied", "error");
      }
    },
    [flashFeedback],
  );

  const handlePhotoDragStart = useCallback(
    (event: React.DragEvent, photo: MobilePhoto) => {
      void prepareActiveTabForPhotoDrop();
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(PHOTO_DROP_MIME, JSON.stringify([photo]));
      const file = dataUrlToFile(photo.dataUrl, photo.name, photo.mimeType);
      if (file) {
        try {
          event.dataTransfer.items.add(file);
        } catch (_err) {
          // some extension drag contexts reject programmatic file items
        }
      }
      event.dataTransfer.setData("text/uri-list", photo.dataUrl);
      event.dataTransfer.setData(
        "text/html",
        `<img src="${photo.dataUrl}" alt="${photo.name}">`,
      );
      event.dataTransfer.setData("text/plain", photo.name);
    },
    [prepareActiveTabForPhotoDrop],
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
  const modeLabel = mode ? MODE_LABELS[mode] : null;
  const selectedModeIndex = Math.max(
    0,
    MODE_OPTIONS.findIndex((option) => option.value === mode),
  );

  return (
    <div className="sidepanel-shell relative flex h-full flex-col overflow-hidden">
      <div className="flex-none px-3 pt-3">
        <UnifiedPairingCard
          mode={mode}
          modeLabel={modeLabel}
          status={status}
          qrDataUrl={qrDataUrl}
          error={error}
          selectedModeIndex={selectedModeIndex}
          onSelectMode={selectMode}
          onForceRestart={() => startSession(true)}
          onDisconnect={unpair}
        />
      </div>

      <div className="flex-none px-4 pb-2 pt-5">
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

      <ScrollArea className="min-h-0 flex-1 px-3 pb-3">
        <div className="space-y-3 pt-1">
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
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function UnifiedPairingCard({
  mode,
  modeLabel,
  status,
  qrDataUrl,
  error,
  selectedModeIndex,
  onSelectMode,
  onForceRestart,
  onDisconnect,
}: {
  mode: MobileCaptureMode | null;
  modeLabel: string | null;
  status: ScannerConnectionStatus;
  qrDataUrl: string | null;
  error: string | null;
  selectedModeIndex: number;
  onSelectMode: (next: MobileCaptureMode) => void;
  onForceRestart: () => void;
  onDisconnect: () => void;
}) {
  const showQr = status === "waiting" && qrDataUrl;
  const isCreating = status === "creating";
  const connected = status === "connected";
  const hasError = status === "error";

  const statusCopy = connected
    ? `Ready for ${modeLabel ?? "App Clip"} captures`
    : showQr
      ? "Waiting for iPhone"
      : isCreating
        ? "Preparing pairing…"
        : hasError
          ? (error ?? "Pairing failed")
          : "Generating a new session…";

  return (
    <div className="liquid-glass concentric-xl overflow-hidden p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="liquid-glass-soft flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-green-700 dark:text-green-300">
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
        <ConnectionPill status={status} error={error} />
      </div>

      <ModeTabNav
        options={MODE_OPTIONS}
        selectedIndex={selectedModeIndex}
        value={mode}
        onSelect={onSelectMode}
      />

      <PairingSlot
        status={status}
        qrDataUrl={qrDataUrl}
        modeLabel={modeLabel}
        error={error}
      />

      <div className="mt-3">
        {connected ? (
          <button
            type="button"
            onClick={onDisconnect}
            className="liquid-glass-soft inline-flex h-9 w-full items-center justify-center gap-2 rounded-full text-xs font-bold text-stone-700 transition hover:bg-white/70 active:scale-[0.99] dark:text-stone-200 dark:hover:bg-white/10"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Pair a different iPhone
          </button>
        ) : (
          <button
            type="button"
            onClick={onForceRestart}
            className="liquid-glass-soft inline-flex h-9 w-full items-center justify-center gap-2 rounded-full text-xs font-bold text-stone-600 transition hover:text-stone-900 active:scale-[0.99] dark:text-stone-300 dark:hover:text-stone-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Generate a new QR
          </button>
        )}
      </div>
    </div>
  );
}

function ModeTabNav({
  options,
  selectedIndex,
  value,
  onSelect,
}: {
  options: typeof MODE_OPTIONS;
  selectedIndex: number;
  value: MobileCaptureMode | null;
  onSelect: (next: MobileCaptureMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Capture mode"
      className="liquid-glass-soft relative mt-4 flex h-12 rounded-2xl p-1"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1 bottom-1 rounded-xl bg-white/85 shadow-sm shadow-stone-900/10 ring-1 ring-stone-200/70 transition-transform duration-300 ease-out dark:bg-stone-700/70 dark:shadow-black/40 dark:ring-stone-600/60"
        style={{
          left: "0.25rem",
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(calc(${selectedIndex} * 100%))`,
        }}
      />
      {options.map((option) => {
        const Icon = option.icon;
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(option.value)}
            className={cn(
              "relative z-[1] flex flex-1 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-center transition active:scale-[0.97]",
              selected
                ? "text-stone-950 dark:text-stone-50"
                : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="max-w-full truncate text-[11px] font-bold leading-none">
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PairingSlot({
  status,
  qrDataUrl,
  modeLabel,
  error,
}: {
  status: ScannerConnectionStatus;
  qrDataUrl: string | null;
  modeLabel: string | null;
  error: string | null;
}) {
  const showQr = status === "waiting" && qrDataUrl;
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
              modeLabel
                ? `Scan with the iPhone Camera app for ${modeLabel}.`
                : "Scan with the iPhone Camera app to open Volt."
            }
          />
        </SlotFader>
      ) : null}

      {slotKey === "connected" ? (
        <SlotFader key="connected">
          <ConnectedPanel modeLabel={modeLabel} />
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

function ConnectedPanel({ modeLabel }: { modeLabel: string | null }) {
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
        {modeLabel
          ? `Capture in ${modeLabel} mode — switching here syncs the App Clip.`
          : "Capture from the App Clip and results land in the history."}
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
}: {
  cluster: Cluster;
  now: number;
  removingIds: Set<string>;
  enteringIds: Set<string>;
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
        "liquid-glass-soft concentric-lg overflow-hidden",
        allEntriesRemoving && "volt-item-exit",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3">
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

      <div className="px-3 pb-3 pt-2">
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
                  exiting={removingIds.has(entry.id)}
                  entering={enteringIds.has(entry.id)}
                  onDelete={() => onDeletePhoto(entry.id)}
                  onCopy={() => onCopyPhoto(entry.photo)}
                  onDownload={() => onDownloadPhoto(entry.photo)}
                  onSend={() => onSendPhoto(entry.photo)}
                  onDragStart={(event) => onPhotoDragStart(event, entry.photo)}
                  onHover={onPhotoHover}
                />
              ) : null,
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
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
        "group flex items-start gap-2 rounded-2xl bg-white/80 px-3 py-2 ring-1 ring-stone-200/70 transition dark:bg-stone-800/70 dark:ring-stone-700/70",
        entering && "volt-item-enter",
        exiting && "volt-item-exit",
      )}
    >
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-[13px] font-semibold leading-snug text-stone-950 dark:text-stone-50",
            isText
              ? "line-clamp-3 break-words"
              : "truncate font-mono tracking-tight",
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
      <div className="flex shrink-0 items-center gap-1 pt-0.5">
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
  exiting,
  entering,
  onDelete,
  onCopy,
  onDownload,
  onSend,
  onDragStart,
  onHover,
}: {
  photo: MobilePhoto;
  exiting: boolean;
  entering: boolean;
  onDelete: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onSend: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onHover: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onMouseEnter={onHover}
      onPointerDown={onHover}
      className={cn(
        "group relative overflow-hidden rounded-2xl bg-stone-50 ring-1 ring-stone-200/70 transition dark:bg-stone-800/70 dark:ring-stone-700/70",
        entering && "volt-item-enter",
        exiting && "volt-item-exit",
        "cursor-grab active:cursor-grabbing",
      )}
    >
      <img
        src={photo.dataUrl}
        alt={photo.name}
        className="aspect-square w-full object-cover"
        draggable={false}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-stone-900/85 via-stone-900/35 to-transparent px-2 pb-1.5 pt-6 text-[10px] text-white">
        <div className="truncate font-semibold">{photo.name}</div>
        <div className="truncate text-white/75">
          {[
            photo.width && photo.height
              ? `${photo.width}×${photo.height}`
              : "",
            formatPhotoSize(photo.size),
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
