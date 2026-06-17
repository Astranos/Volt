import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  ImagePlus,
  Loader2,
  Plus,
  RefreshCw,
  Scan,
  ScanLine,
  Smartphone,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import type { ScannerConnectionStatus } from "../../../../scanner-protocol/src";
import {
  deleteMobileScannerResults,
  groupPhotoResultsByBatch,
  listMobileScannerResults,
  MOBILE_SCANNER_DELETE_UNDO_WINDOW_MS,
  purgeExpiredMobileScannerDeletedResults,
  restoreMobileScannerResults,
  saveMobileScannerPhoto,
  saveMobileScannerScan,
  type HydratedMobileScannerPhotoResult,
  type HydratedMobileScannerResult,
  type MobileScannerScanResult,
} from "../../domain/mobile-scanner-results";
import type { BarcodeMessage } from "../../domain/mobile-scanner-session";
import { cn } from "../../lib/utils";
import { showSidepanelToast, type SidepanelToastTone } from "../../lib/sidepanel-toast";
import { ConnectionPill } from "./mobile-shared";
import { ScrollArea } from "../ui/scroll-area";
import {
  PHOTO_DROP_MIME,
  blobToDataUrl,
  blobToFile,
  dataUrlToFile,
  dataUrlToPngBlob,
  formatPhotoSize,
  insertPhotosIntoPage,
  installPhotoDropBridge,
  normalizeImageFilename,
  type MobilePhoto,
} from "./mobile-photo-helpers";

const EXIT_ANIMATION_MS = 180;
const UNDO_WINDOW_MS = MOBILE_SCANNER_DELETE_UNDO_WINDOW_MS;

type MobileScannerState = {
  status: ScannerConnectionStatus;
  qrCodeUrl: string | null;
  error: string | null;
  connectedAt?: string | null;
  connectedPeerCount?: number;
  transferSummary?: string | null;
};

type TimelineEntry =
  | MobileScannerScanResult
  | HydratedMobileScannerPhotoResult;

type TimelineGroup =
  | {
      type: "scan";
      key: string;
      kind: "text" | "barcode";
      capturedAt: number;
      entries: MobileScannerScanResult[];
    }
  | {
      type: "photo";
      key: string;
      capturedAt: number;
      startAt: number;
      endAt: number;
      entries: HydratedMobileScannerPhotoResult[];
    };

async function photoToClipboardPngBlob(photo: MobilePhoto) {
  if (photo.dataUrl) return dataUrlToPngBlob(photo.dataUrl);
  if (photo.blob) return dataUrlToPngBlob(await blobToDataUrl(photo.blob));
  throw new Error("Photo bytes unavailable");
}

type DeletedSnapshot = {
  results: TimelineEntry[];
  timer: number;
  label: string;
};

function installEditableTracker() {
  const root = window as typeof window & {
    __voltLastEditable?: HTMLElement | null;
    __voltLastEditableSelection?: {
      start?: number | null;
      end?: number | null;
      isContentEditable?: boolean;
    } | null;
    __voltLastEditableRange?: Range | null;
    __voltLiveDictation?: {
      sessionId?: string;
      sourceLength?: number;
    } | null;
    __voltEditableTrackerInstalled?: boolean;
  };

  const isEditable = (element: Element | null): element is HTMLElement => {
    if (!(element instanceof HTMLElement)) return false;
    if (element.getAttribute("contenteditable") === "false") return false;
    const isDesignModeEditable =
      document.designMode?.toLowerCase() === "on" &&
      (element === document.body || element === document.documentElement);
    return (
      element.tagName === "INPUT" ||
      element.tagName === "TEXTAREA" ||
      element.isContentEditable ||
      isDesignModeEditable
    );
  };

  const describeEditable = (element: HTMLElement) => {
    const label =
      element.getAttribute("aria-label") ||
      element.getAttribute("placeholder") ||
      element.getAttribute("name") ||
      element.getAttribute("id") ||
      (document.designMode?.toLowerCase() === "on" &&
      (element === document.body || element === document.documentElement)
        ? "Rich text editor"
        : "") ||
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
          updatedAt: Date.now(),
        },
      });
    } catch (_error) {}
  };

  const track = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : document.activeElement;
    const editable =
      isEditable(element) ? element : isEditable(document.activeElement) ? document.activeElement : null;
    if (!editable) return;
    if (root.__voltLiveDictation && root.__voltLastEditable !== editable) {
      root.__voltLiveDictation = {
        sessionId: root.__voltLiveDictation.sessionId,
        sourceLength: root.__voltLiveDictation.sourceLength ?? 0,
      };
    }
    root.__voltLastEditable = editable;
    if (editable instanceof HTMLInputElement || editable instanceof HTMLTextAreaElement) {
      root.__voltLastEditableSelection = {
        start: editable.selectionStart,
        end: editable.selectionEnd,
        isContentEditable: false,
      };
      root.__voltLastEditableRange = null;
    } else {
      root.__voltLastEditableSelection = { isContentEditable: true };
      const selection = window.getSelection();
      root.__voltLastEditableRange =
        selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
    }
    notifyTarget(editable);
  };

  track(document.activeElement);

  if (root.__voltEditableTrackerInstalled) return;
  document.addEventListener("focusin", (event) => track(event.target), true);
  document.addEventListener("selectionchange", () => track(document.activeElement), true);
  document.addEventListener("keyup", (event) => track(event.target), true);
  document.addEventListener("pointerup", (event) => track(event.target), true);
  root.__voltEditableTrackerInstalled = true;
}

function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function formatRelativeTime(value: number, now: number) {
  const diff = now - value;
  if (diff < 45 * 1000) return "just now";
  if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.round(diff / 60000))}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.round(diff / 3600000)}h ago`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.round(diff / 86400000)}d ago`;
  return new Date(value).toLocaleDateString();
}

function createObjectUrl(blob: Blob | undefined) {
  return blob ? URL.createObjectURL(blob) : undefined;
}

function hydratePhotoRuntime(photo: MobilePhoto) {
  const runtimeUrl = photo.dataUrl ?? createObjectUrl(photo.blob);
  return runtimeUrl ? { ...photo, dataUrl: runtimeUrl } : photo;
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

function buildTimelineGroups(results: TimelineEntry[]): TimelineGroup[] {
  const scans = results
    .filter((result): result is MobileScannerScanResult => result.type === "scan")
    .map((result): TimelineGroup => ({
      type: "scan",
      key: result.id,
      kind: result.kind,
      capturedAt: timestamp(result.capturedAt),
      entries: [result],
    }));
  const photoGroups = groupPhotoResultsByBatch(
    results.filter(
      (result): result is HydratedMobileScannerPhotoResult =>
        result.type === "photo",
    ),
  ).map((group): TimelineGroup => ({
    type: "photo",
    key: group.photoBatchId,
    capturedAt: group.endAt,
    startAt: group.startAt,
    endAt: group.endAt,
    entries: group.entries as HydratedMobileScannerPhotoResult[],
  }));

  return [...scans, ...photoGroups].sort((a, b) => b.capturedAt - a.capturedAt);
}

function photoFromResult(result: HydratedMobileScannerPhotoResult) {
  return hydratePhotoRuntime(result.photo);
}

interface MobileScannerProps {
  onClose?: () => void;
}

export default function MobileScanner({ onClose: _onClose }: MobileScannerProps) {
  const [state, setState] = useState<MobileScannerState>({
    status: "disconnected",
    qrCodeUrl: null,
    error: null,
  });
  const [results, setResults] = useState<TimelineEntry[]>([]);
  const [loadingResults, setLoadingResults] = useState(true);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set());
  const [collapsedBatchIds, setCollapsedBatchIds] = useState<Set<string>>(new Set());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [previewPhoto, setPreviewPhoto] = useState<MobilePhoto | null>(null);
  const [deletedSnapshot, setDeletedSnapshot] = useState<DeletedSnapshot | null>(null);
  const [now, setNow] = useState(Date.now());
  const lastSelectedPhotoId = useRef<string | null>(null);

  const photoResults = useMemo(
    () =>
      results.filter(
        (result): result is HydratedMobileScannerPhotoResult =>
          result.type === "photo",
      ),
    [results],
  );
  const photos = useMemo(() => photoResults.map(photoFromResult), [photoResults]);
  const photoOrder = useMemo(() => photoResults.map((result) => result.id), [photoResults]);
  const selectedPhotos = useMemo(
    () => photos.filter((photo) => selectedPhotoIds.has(photo.id)),
    [photos, selectedPhotoIds],
  );
  const groups = useMemo(() => buildTimelineGroups(results), [results]);

  const flashFeedback = useCallback(
    (message: string, tone: SidepanelToastTone = "success") => {
      showSidepanelToast(message, tone);
    },
    [],
  );

  const refreshResults = useCallback(async () => {
    const loaded = await listMobileScannerResults();
    setResults(loaded as TimelineEntry[]);
    setLoadingResults(false);
  }, []);

  const applyScannerState = useCallback((nextState?: Partial<MobileScannerState> | null) => {
    if (!nextState) return;
    setState((current) => ({
      ...current,
      ...nextState,
      error: nextState.error ?? null,
    }));
  }, []);

  const primeCursorTarget = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: installEditableTracker,
      });
    } catch (_err) {
      // Restricted Chrome pages fall back to sidepanel-only capture.
    }
  }, []);

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

  const openPairingPopup = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "openMobileCapturePopup",
        mode: "photo",
      });
      if (response?.state) applyScannerState(response.state);
      if (response?.error) flashFeedback(response.error, "error");
    } catch (error) {
      flashFeedback(error instanceof Error ? error.message : "Could not open pairing popup", "error");
    }
  }, [applyScannerState, flashFeedback]);

  const restartPairing = useCallback(async () => {
    setState((current) => ({ ...current, status: "creating", error: null }));
    try {
      const response = await chrome.runtime.sendMessage({ action: "scannerStart", force: true });
      if (response?.state) applyScannerState(response.state);
      if (response?.error) flashFeedback(response.error, "error");
    } catch (_err) {
      flashFeedback("Could not restart scanner session", "error");
    }
  }, [applyScannerState, flashFeedback]);

  const disconnect = useCallback(async () => {
    const response = await chrome.runtime.sendMessage({ action: "scannerDisconnect" });
    if (response?.state) applyScannerState(response.state);
  }, [applyScannerState]);

  const deleteResults = useCallback(
    (ids: string[], label: string) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      const snapshot = results.filter((result) => idSet.has(result.id));
      if (snapshot.length === 0) return;
      setRemovingIds((current) => new Set([...current, ...ids]));
      window.setTimeout(() => {
        setResults((current) => current.filter((result) => !idSet.has(result.id)));
        setSelectedPhotoIds((current) => {
          const next = new Set(current);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        void deleteMobileScannerResults(ids);
        if (deletedSnapshot?.timer) window.clearTimeout(deletedSnapshot.timer);
        const timer = window.setTimeout(() => {
          setDeletedSnapshot(null);
          void purgeExpiredMobileScannerDeletedResults();
        }, UNDO_WINDOW_MS);
        setDeletedSnapshot({ results: snapshot, timer, label });
        setRemovingIds((current) => {
          const next = new Set(current);
          ids.forEach((id) => next.delete(id));
          return next;
        });
      }, EXIT_ANIMATION_MS);
    },
    [deletedSnapshot, results],
  );

  const undoDelete = useCallback(async () => {
    if (!deletedSnapshot) return;
    window.clearTimeout(deletedSnapshot.timer);
    await restoreMobileScannerResults(deletedSnapshot.results);
    setDeletedSnapshot(null);
    await refreshResults();
    flashFeedback("Restored");
  }, [deletedSnapshot, flashFeedback, refreshResults]);

  const togglePhotoSelection = useCallback(
    (id: string, shiftKey = false) => {
      setSelectedPhotoIds((current) => {
        const next = new Set(current);
        if (shiftKey && lastSelectedPhotoId.current) {
          const anchorIndex = photoOrder.indexOf(lastSelectedPhotoId.current);
          const targetIndex = photoOrder.indexOf(id);
          if (anchorIndex >= 0 && targetIndex >= 0) {
            const [start, end] = [anchorIndex, targetIndex].sort((a, b) => a - b);
            photoOrder.slice(start, end + 1).forEach((photoId) => next.add(photoId));
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      lastSelectedPhotoId.current = id;
    },
    [photoOrder],
  );

  const copyScan = useCallback(
    async (scan: MobileScannerScanResult) => {
      try {
        await navigator.clipboard.writeText(scan.value);
        flashFeedback(scan.kind === "text" ? "Text copied" : "Barcode copied");
      } catch (_err) {
        flashFeedback("Clipboard write failed", "error");
      }
    },
    [flashFeedback],
  );

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

  const dragPhotos = useCallback(
    (event: React.DragEvent, photo: MobilePhoto) => {
      void prepareActiveTabForPhotoDrop();
      const sourcePhotos = selectedPhotoIds.has(photo.id) ? selectedPhotos : [photo];
      if (!selectedPhotoIds.has(photo.id)) setSelectedPhotoIds(new Set([photo.id]));

      const files = sourcePhotos
        .map((item) => {
          if (item.blob) return blobToFile(item.blob, item.name, item.mimeType);
          if (item.dataUrl?.startsWith("data:")) return dataUrlToFile(item.dataUrl, item.name, item.mimeType);
          return null;
        })
        .filter((file): file is File => Boolean(file));

      if (files.length === 0) {
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
      const bridgePayload = sourcePhotos
        .filter((item) => item.dataUrl?.startsWith("data:"))
        .map((item) => ({
          dataUrl: item.dataUrl!,
          name: item.name,
          mimeType: item.mimeType,
        }));
      if (bridgePayload.length > 0) {
        event.dataTransfer.setData(PHOTO_DROP_MIME, JSON.stringify(bridgePayload));
        event.dataTransfer.setData("text/uri-list", bridgePayload.map((item) => item.dataUrl).join("\n"));
        event.dataTransfer.setData(
          "text/html",
          bridgePayload.map((item) => `<img src="${item.dataUrl}" alt="${item.name}">`).join(""),
        );
      }
    },
    [flashFeedback, prepareActiveTabForPhotoDrop, selectedPhotoIds, selectedPhotos],
  );

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    void refreshResults();
    void primeCursorTarget();
    void chrome.runtime
      .sendMessage({ action: "scannerGetState" })
      .then((response) => applyScannerState(response?.state))
      .catch(() => applyScannerState({ status: "disconnected", qrCodeUrl: null, error: null }));
  }, [applyScannerState, primeCursorTarget, refreshResults]);

  useEffect(() => {
    const onActivated = () => void primeCursorTarget();
    const onUpdated = (_tabId: number, changeInfo: any, tab: any) => {
      if (changeInfo.status === "complete" && tab.active) void primeCursorTarget();
    };
    const onFocusChanged = (windowId: number) => {
      if (windowId !== chrome.windows.WINDOW_ID_NONE) void primeCursorTarget();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(onFocusChanged);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(onFocusChanged);
    };
  }, [primeCursorTarget]);

  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message?.action === "scannerStateChanged") {
        applyScannerState(message.state);
        return;
      }
      if (message?.action === "scannerScan") {
        void saveMobileScannerScan(message.scan as BarcodeMessage & { id?: string }).then((saved) => {
          if (!saved) return;
          setResults((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
        });
        return;
      }
      if (message?.action === "scannerPhoto") {
        void saveMobileScannerPhoto(message.photo).then((saved) => {
          if (!saved) return;
          setResults((current) => [saved, ...current.filter((item) => item.id !== saved.id)] as TimelineEntry[]);
          void prepareActiveTabForPhotoDrop();
        });
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [applyScannerState, prepareActiveTabForPhotoDrop]);

  useEffect(() => {
    if (photos.length > 0) void prepareActiveTabForPhotoDrop();
  }, [photos.length, prepareActiveTabForPhotoDrop]);

  useEffect(() => {
    return () => {
      if (deletedSnapshot?.timer) window.clearTimeout(deletedSnapshot.timer);
      photos.forEach((photo) => {
        if (photo.dataUrl?.startsWith("blob:")) URL.revokeObjectURL(photo.dataUrl);
      });
    };
  }, [deletedSnapshot, photos]);

  const totalCount = results.length;
  const phoneCount = state.connectedPeerCount ?? (state.status === "connected" ? 1 : 0);

  return (
    <div className="sidepanel-shell relative flex h-full min-w-0 flex-col overflow-hidden">
      <div className="flex-none px-3 pt-3">
        <CompactScannerStatus
          status={state.status}
          error={state.error}
          phoneCount={phoneCount}
          transferSummary={state.transferSummary}
          onAddPhone={openPairingPopup}
          onForceRestart={restartPairing}
          onDisconnect={disconnect}
        />
      </div>

      <div className="flex-none min-w-0 px-4 pb-2 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-stone-900 dark:text-stone-50">
              Results
            </div>
            <div className="truncate text-xs text-stone-500 dark:text-stone-400">
              {totalCount === 0
                ? "Text, barcodes, and received photos land here"
                : `${totalCount} saved item${totalCount === 1 ? "" : "s"}`}
            </div>
          </div>
          <button
            type="button"
            onClick={openPairingPopup}
            className="liquid-glass-soft inline-flex h-9 w-9 items-center justify-center rounded-full text-stone-600 transition hover:text-stone-900 active:scale-95 dark:text-stone-300 dark:hover:text-stone-50"
            aria-label="Add phone"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1 px-3 pb-3 [&>div]:!overflow-x-hidden">
        <div className="min-w-0 space-y-3 pt-1">
          {loadingResults ? (
            <LoadingHistory />
          ) : groups.length === 0 ? (
            <EmptyHistory />
          ) : (
            groups.map((group) =>
              group.type === "photo" ? (
                <PhotoBatchCard
                  key={group.key}
                  group={group}
                  now={now}
                  collapsed={collapsedBatchIds.has(group.key)}
                  removingIds={removingIds}
                  selectedPhotoIds={selectedPhotoIds}
                  onToggleCollapse={() =>
                    setCollapsedBatchIds((current) => {
                      const next = new Set(current);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })
                  }
                  onDeleteBatch={() => deleteResults(group.entries.map((entry) => entry.id), "Photo batch deleted")}
                  onDeletePhoto={(photoId) => deleteResults([photoId], "Photo deleted")}
                  onCopyPhoto={copyPhoto}
                  onDownloadPhoto={downloadPhoto}
                  onPreviewPhoto={setPreviewPhoto}
                  onSendPhoto={(photo) => sendPhotosToTab(selectedPhotoIds.has(photo.id) ? selectedPhotos : [photo])}
                  onDragStart={dragPhotos}
                  onHover={prepareActiveTabForPhotoDrop}
                  onToggleSelection={togglePhotoSelection}
                />
              ) : (
                <ScanCard
                  key={group.key}
                  group={group}
                  now={now}
                  removing={removingIds.has(group.key)}
                  onCopy={() => copyScan(group.entries[0])}
                  onDelete={() => deleteResults([group.key], "Result deleted")}
                />
              ),
            )
          )}
        </div>
      </ScrollArea>

      {deletedSnapshot ? (
        <div className="absolute inset-x-3 bottom-3 z-20 flex items-center justify-between gap-3 rounded-lg bg-stone-950 px-3 py-2 text-xs font-semibold text-white shadow-lg">
          <span className="truncate">{deletedSnapshot.label}</span>
          <button
            type="button"
            onClick={undoDelete}
            className="rounded-md bg-white px-2 py-1 text-xs font-bold text-stone-950"
          >
            Undo
          </button>
        </div>
      ) : null}

      {previewPhoto ? (
        <PhotoPreviewDialog
          photo={previewPhoto}
          onClose={() => setPreviewPhoto(null)}
          onCopy={() => copyPhoto(previewPhoto)}
          onDownload={() => downloadPhoto(previewPhoto)}
        />
      ) : null}
    </div>
  );
}

function CompactScannerStatus({
  status,
  error,
  phoneCount,
  transferSummary,
  onAddPhone,
  onForceRestart,
  onDisconnect,
}: {
  status: ScannerConnectionStatus;
  error: string | null;
  phoneCount: number;
  transferSummary?: string | null;
  onAddPhone: () => void;
  onForceRestart: () => void;
  onDisconnect: () => void;
}) {
  const connected = status === "connected";
  const creating = status === "creating";
  const copy = connected
    ? `${phoneCount} phone${phoneCount === 1 ? "" : "s"} connected${transferSummary ? ` · ${transferSummary}` : ""}`
    : status === "waiting"
      ? "Pairing popup is ready for iPhone."
      : creating
        ? "Preparing mobile scanner session."
        : status === "error"
          ? (error ?? "Scanner session needs attention.")
          : "Open the pairing popup to add an iPhone.";

  return (
    <div className="liquid-glass concentric-xl flex min-w-0 flex-col gap-3 px-3.5 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="liquid-glass-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-green-700 dark:text-green-300">
          <Smartphone className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold leading-tight text-stone-900 dark:text-stone-50">
            Mobile Scanner
          </div>
          <div className="mt-1 text-xs font-medium leading-snug text-stone-500 dark:text-stone-400">
            {copy}
          </div>
        </div>
        <div className="shrink-0">
          <ConnectionPill status={status} error={error} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onAddPhone}
          className="liquid-glass-soft inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-full px-3 text-xs font-bold text-stone-700 transition hover:text-stone-950 active:scale-[0.99] dark:text-stone-200 dark:hover:text-stone-50"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Add iPhone</span>
        </button>
        <button
          type="button"
          onClick={connected ? onDisconnect : onForceRestart}
          disabled={creating}
          className="liquid-glass-soft inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-full px-3 text-xs font-bold text-stone-700 transition hover:text-stone-950 active:scale-[0.99] disabled:opacity-40 dark:text-stone-200 dark:hover:text-stone-50"
        >
          {connected ? (
            <X className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <RefreshCw className={cn("h-3.5 w-3.5 shrink-0", creating && "animate-spin")} />
          )}
          <span className="truncate">{connected ? "Disconnect" : "Restart"}</span>
        </button>
      </div>
    </div>
  );
}

function LoadingHistory() {
  return (
    <div className="liquid-glass-soft concentric-lg flex items-center justify-center gap-2 px-4 py-8 text-xs font-semibold text-stone-500 dark:text-stone-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading results
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
        No results yet
      </p>
      <p className="mt-1 max-w-[260px] text-xs text-stone-500 dark:text-stone-400">
        Text captures, barcodes, and fully received photos appear in this timeline.
      </p>
    </div>
  );
}

function ScanCard({
  group,
  now,
  removing,
  onCopy,
  onDelete,
}: {
  group: Extract<TimelineGroup, { type: "scan" }>;
  now: number;
  removing: boolean;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const scan = group.entries[0];
  const isText = group.kind === "text";
  const Icon = isText ? Type : ScanLine;
  return (
    <div className={cn("liquid-glass-soft concentric-lg min-w-0 overflow-hidden px-3 py-3", removing && "volt-item-exit")}>
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", isText ? "bg-amber-100/80 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" : "bg-green-100/80 text-green-700 dark:bg-green-500/15 dark:text-green-300")}>
            <Icon className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-stone-900 dark:text-stone-100">
              {isText ? "Text capture" : "Barcode"}
            </div>
            <div className="truncate text-[10px] font-medium text-stone-500 dark:text-stone-400">
              {formatRelativeTime(group.capturedAt, now)}
            </div>
          </div>
        </div>
        <button type="button" onClick={onDelete} className="flex h-7 w-7 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-50" aria-label="Delete result">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="rounded-lg bg-white/80 px-3 py-2 ring-1 ring-stone-200/70 dark:bg-stone-800/70 dark:ring-stone-700/70">
        <div className={cn("text-[13px] font-semibold leading-snug text-stone-950 dark:text-stone-50", isText ? "line-clamp-4 break-words" : "break-all font-mono")}>
          {scan.value}
        </div>
        <button type="button" onClick={onCopy} className="mt-2 inline-flex h-7 items-center gap-1 rounded-full bg-stone-100 px-2.5 text-[11px] font-bold text-stone-700 transition hover:bg-stone-200 dark:bg-stone-700 dark:text-stone-100 dark:hover:bg-stone-600">
          <Copy className="h-3 w-3" />
          Copy
        </button>
      </div>
    </div>
  );
}

function PhotoBatchCard({
  group,
  now,
  collapsed,
  removingIds,
  selectedPhotoIds,
  onToggleCollapse,
  onDeleteBatch,
  onDeletePhoto,
  onCopyPhoto,
  onDownloadPhoto,
  onPreviewPhoto,
  onSendPhoto,
  onDragStart,
  onHover,
  onToggleSelection,
}: {
  group: Extract<TimelineGroup, { type: "photo" }>;
  now: number;
  collapsed: boolean;
  removingIds: Set<string>;
  selectedPhotoIds: Set<string>;
  onToggleCollapse: () => void;
  onDeleteBatch: () => void;
  onDeletePhoto: (photoId: string) => void;
  onCopyPhoto: (photo: MobilePhoto) => void;
  onDownloadPhoto: (photo: MobilePhoto) => void;
  onPreviewPhoto: (photo: MobilePhoto) => void;
  onSendPhoto: (photo: MobilePhoto) => void;
  onDragStart: (event: React.DragEvent, photo: MobilePhoto) => void;
  onHover: () => void;
  onToggleSelection: (photoId: string, shiftKey: boolean) => void;
}) {
  const visibleEntries = collapsed ? group.entries.slice(0, 1) : group.entries;
  const count = group.entries.length;
  return (
    <div className="liquid-glass-soft concentric-lg min-w-0 overflow-hidden">
      <div className="flex min-w-0 items-center justify-between gap-2 px-3 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-100/80 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
            <ImagePlus className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-stone-900 dark:text-stone-100">
              {count === 1 ? "Photo batch" : `${count} photo batch`}
            </div>
            <div className="truncate text-[10px] font-medium text-stone-500 dark:text-stone-400">
              {formatRelativeTime(group.endAt, now)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {count > 1 ? (
            <button type="button" onClick={onToggleCollapse} className="inline-flex h-7 items-center gap-1 rounded-full bg-stone-100 px-2 text-[10px] font-bold text-stone-700 transition hover:bg-stone-200 dark:bg-stone-700 dark:text-stone-100 dark:hover:bg-stone-600" aria-label={collapsed ? "Expand photo batch" : "Collapse photo batch"}>
              <ChevronDown className={cn("h-3 w-3 transition-transform", collapsed && "-rotate-90")} />
              {collapsed ? `+${count - 1}` : "Hide"}
            </button>
          ) : null}
          <button type="button" onClick={onDeleteBatch} className="flex h-7 w-7 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-200 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-50" aria-label="Delete photo batch">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className={cn("grid gap-2 px-3 pb-3 pt-2", collapsed ? "grid-cols-1" : "grid-cols-2")}>
        {visibleEntries.map((entry) => {
          const photo = photoFromResult(entry);
          return (
            <PhotoTile
              key={entry.id}
              photo={photo}
              selected={selectedPhotoIds.has(entry.id)}
              exiting={removingIds.has(entry.id)}
              onDelete={() => onDeletePhoto(entry.id)}
              onCopy={() => onCopyPhoto(photo)}
              onDownload={() => onDownloadPhoto(photo)}
              onPreview={() => onPreviewPhoto(photo)}
              onSend={() => onSendPhoto(photo)}
              onDragStart={(event) => onDragStart(event, photo)}
              onHover={onHover}
              onToggleSelection={(shiftKey) => onToggleSelection(entry.id, shiftKey)}
            />
          );
        })}
      </div>
    </div>
  );
}

function PhotoTile({
  photo,
  selected,
  exiting,
  onDelete,
  onCopy,
  onDownload,
  onPreview,
  onSend,
  onDragStart,
  onHover,
  onToggleSelection,
}: {
  photo: MobilePhoto;
  selected: boolean;
  exiting: boolean;
  onDelete: () => void;
  onCopy: () => void;
  onDownload: () => void;
  onPreview: () => void;
  onSend: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onHover: () => void;
  onToggleSelection: (shiftKey: boolean) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onMouseEnter={onHover}
      onPointerDown={onHover}
      onClick={(event) => onToggleSelection(event.shiftKey)}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-lg bg-stone-50 ring-1 transition dark:bg-stone-800/70",
        selected ? "ring-2 ring-green-500 dark:ring-green-300" : "ring-stone-200/70 dark:ring-stone-700/70",
        exiting && "volt-item-exit",
        "cursor-grab active:cursor-grabbing",
      )}
    >
      <span className={cn("absolute left-1 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-full border text-white shadow-sm transition", selected ? "border-green-500 bg-green-500" : "border-white/80 bg-stone-950/30 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100")} aria-hidden="true">
        {selected ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
      {photo.dataUrl ? (
        <img src={photo.dataUrl} alt={photo.name} className="pointer-events-none h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-stone-100 px-3 text-center text-stone-500 dark:bg-stone-900 dark:text-stone-300">
          <Download className="h-7 w-7" />
          <span className="text-[11px] font-semibold">Saved to Downloads</span>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-stone-900/85 via-stone-900/35 to-transparent px-2 pb-1.5 pt-6 text-[10px] text-white">
        <div className="truncate font-semibold">{photo.name}</div>
        <div className="truncate text-white/75">
          {[photo.width && photo.height ? `${photo.width}x${photo.height}` : "", formatPhotoSize(photo.size)].filter(Boolean).join(" · ")}
        </div>
      </div>
      <div className="absolute right-1 top-1 flex flex-col gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <PhotoActionButton onClick={onPreview} label="Preview photo">
          <Eye className="h-3 w-3" />
        </PhotoActionButton>
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
        danger ? "bg-red-500/85 text-white hover:bg-red-500" : "bg-white/85 text-stone-900 hover:bg-white",
      )}
    >
      {children}
    </button>
  );
}

function PhotoPreviewDialog({
  photo,
  onClose,
  onCopy,
  onDownload,
}: {
  photo: MobilePhoto;
  onClose: () => void;
  onCopy: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-stone-950/92 p-3 text-white backdrop-blur-md">
      <div className="mb-3 flex flex-none items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{photo.name}</div>
          <div className="truncate text-xs text-white/60">
            {[photo.width && photo.height ? `${photo.width}x${photo.height}` : "", formatPhotoSize(photo.size)].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" onClick={onCopy} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20" aria-label="Copy photo">
            <Copy className="h-4 w-4" />
          </button>
          <button type="button" onClick={onDownload} className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20" aria-label="Download photo">
            <Download className="h-4 w-4" />
          </button>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-stone-950 transition hover:bg-stone-200" aria-label="Close preview">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg bg-black">
        {photo.dataUrl ? (
          <img src={photo.dataUrl} alt={photo.name} className="max-h-full max-w-full object-contain" />
        ) : (
          <div className="text-sm font-semibold text-white/70">Preview unavailable</div>
        )}
      </div>
    </div>
  );
}
