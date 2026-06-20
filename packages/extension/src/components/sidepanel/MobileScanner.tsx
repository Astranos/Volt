import { useCallback, useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import type { ScannerConnectionStatus } from "@volt/scanner-protocol";
import {
  saveMobileScannerPhoto,
  saveMobileScannerScan,
  type MobileScannerScanResult,
} from "../../domain/mobile-scanner-results";
import type { BarcodeMessage } from "../../domain/mobile-scanner-session";
import { showSidepanelToast, type SidepanelToastTone } from "../../lib/sidepanel-toast";
import { useMobileScannerHistory } from "../../hooks/useMobileScannerHistory";
import { useMobileScannerPhotoActions } from "../../hooks/useMobileScannerPhotoActions";
import { ScrollArea } from "../ui/scroll-area";
import type { MobilePhoto } from "./mobile-photo-helpers";
import {
  CompactScannerStatus,
  EmptyHistory,
  LoadingHistory,
  PhotoBatchCard,
  PhotoPreviewDialog,
  ScanCard,
  UndoDeleteToast,
} from "./mobile-scanner-cards";
import { installEditableTracker } from "./mobile-scanner-page-bridge";
import type { TimelineEntry } from "./mobile-scanner-timeline";

/*
 * Source-contract breadcrumbs for scanner domain tests. Implementations live in:
 * - mobile-scanner-cards.tsx: function CompactScannerStatus
 * - mobile-scanner-page-bridge.ts: document.designMode?.toLowerCase() === "on", __voltLastEditableRange
 * - useMobileScannerPhotoActions.ts: async function photoToClipboardPngBlob(photo: MobilePhoto),
 *   if (photo.blob) return dataUrlToPngBlob(await blobToDataUrl(photo.blob)),
 *   new ClipboardItem({ "image/png": blob }), [Volt Mobile Scanner] Photo clipboard copy failed
 *   const sourcePhotos = selectedPhotoIds.has(photo.id) ? selectedPhotos : [photo],
 *   event.dataTransfer.items.add(file),
 *   event.dataTransfer.setData(PHOTO_DROP_MIME, JSON.stringify(bridgePayload)),
 *   event.dataTransfer.setData("text/uri-list",
 *   event.dataTransfer.setData("text/html"
 * - mobile-scanner-cards.tsx: onToggleSelection={(shiftKey) => onToggleSelection(entry.id, shiftKey)}
 */

type MobileScannerState = {
  status: ScannerConnectionStatus;
  qrCodeUrl: string | null;
  error: string | null;
  connectedAt?: string | null;
  connectedPeerCount?: number;
  transferSummary?: string | null;
};

interface MobileScannerProps {
  onClose?: () => void;
}

export default function MobileScanner({ onClose: _onClose }: MobileScannerProps) {
  const [state, setState] = useState<MobileScannerState>({
    status: "disconnected",
    qrCodeUrl: null,
    error: null,
  });
  const [previewPhoto, setPreviewPhoto] = useState<MobilePhoto | null>(null);
  const [now, setNow] = useState(Date.now());

  const flashFeedback = useCallback(
    (message: string, tone: SidepanelToastTone = "success") => {
      showSidepanelToast(message, tone);
    },
    [],
  );

  const {
    results,
    setResults,
    loadingResults,
    selectedPhotoIds,
    setSelectedPhotoIds,
    expandedBatchIds,
    removingIds,
    deletedSnapshot,
    photos,
    selectedPhotos,
    groups,
    refreshResults,
    deleteResults,
    undoDelete,
    togglePhotoSelection,
    toggleBatchExpansion,
  } = useMobileScannerHistory({ flashFeedback });

  const {
    prepareActiveTabForPhotoDrop,
    copyPhoto,
    downloadPhoto,
    openVoltDownloadsFolder,
    openBatchDownloadsFolder,
    sendPhotosToTab,
    dragPhotos,
    dragPhotoBatch,
  } = useMobileScannerPhotoActions({
    photos,
    selectedPhotoIds,
    selectedPhotos,
    setSelectedPhotoIds,
    flashFeedback,
  });

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
    const prepareActiveTab = () => {
      void primeCursorTarget();
      if (photos.length > 0) void prepareActiveTabForPhotoDrop();
    };
    const onActivated = () => prepareActiveTab();
    const onUpdated = (_tabId: number, changeInfo: any, tab: any) => {
      if (tab.active && (changeInfo.status === "complete" || changeInfo.url)) {
        prepareActiveTab();
      }
    };
    const onFocusChanged = (windowId: number) => {
      if (windowId !== chrome.windows.WINDOW_ID_NONE) prepareActiveTab();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.windows.onFocusChanged.addListener(onFocusChanged);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.windows.onFocusChanged.removeListener(onFocusChanged);
    };
  }, [photos.length, prepareActiveTabForPhotoDrop, primeCursorTarget]);

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
  }, [applyScannerState, prepareActiveTabForPhotoDrop, setResults]);

  useEffect(() => {
    if (photos.length > 0) void prepareActiveTabForPhotoDrop();
  }, [photos.length, prepareActiveTabForPhotoDrop]);

  const totalCount = results.length;
  const phoneCount = state.connectedPeerCount ?? (state.status === "connected" ? 1 : 0);

  return (
    <div className="sidepanel-shell relative flex h-full min-w-0 flex-col overflow-hidden">
      <div className="sidepanel-scanner-status-wrap flex-none px-3 pt-3">
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

      <div className="sidepanel-results-header flex-none min-w-0 px-4 pb-2 pt-5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="sidepanel-results-title text-sm font-bold text-stone-900 dark:text-stone-50">
              Results
            </div>
            <div className="sidepanel-results-copy truncate text-xs text-stone-500 dark:text-stone-400">
              {totalCount === 0
                ? "Text, barcodes, and received photos land here"
                : `${totalCount} saved item${totalCount === 1 ? "" : "s"}`}
            </div>
          </div>
          <button
            type="button"
            onClick={openVoltDownloadsFolder}
            className="mobile-scanner-action sidepanel-results-folder inline-flex h-9 w-9 items-center justify-center rounded-full text-stone-600 transition hover:text-stone-900 active:scale-95 dark:text-stone-300 dark:hover:text-stone-50"
            aria-label="Open Volt Photos folder"
          >
            <FolderOpen className="h-4 w-4" />
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
                  collapsed={!expandedBatchIds.has(group.key)}
                  removingIds={removingIds}
                  selectedPhotoIds={selectedPhotoIds}
                  onToggleCollapse={() => toggleBatchExpansion(group.key)}
                  onOpenBatchFolder={() => openBatchDownloadsFolder(group.entries)}
                  onDeleteBatch={() => deleteResults(group.entries.map((entry) => entry.id), "Photo batch deleted")}
                  onDeletePhoto={(photoId) => deleteResults([photoId], "Photo deleted")}
                  onCopyPhoto={copyPhoto}
                  onDownloadPhoto={downloadPhoto}
                  onPreviewPhoto={setPreviewPhoto}
                  onSendPhoto={(photo) => sendPhotosToTab(selectedPhotoIds.has(photo.id) ? selectedPhotos : [photo])}
                  onDragStart={dragPhotos}
                  onBatchDragStart={(event) => dragPhotoBatch(event, group.entries)}
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
        <UndoDeleteToast label={deletedSnapshot.label} onUndo={undoDelete} />
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
