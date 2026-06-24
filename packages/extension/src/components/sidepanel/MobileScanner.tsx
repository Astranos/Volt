import { useCallback, useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import {
  saveMobileScannerPhoto,
  saveMobileScannerScan,
  type MobileScannerResultBroadcastMessage,
  type MobileScannerScanResult,
} from "../../domain/mobile-scanner-results";
import { showSidepanelToast, type SidepanelToastTone } from "../../lib/sidepanel-toast";
import { useMobileScannerHistory } from "../../hooks/useMobileScannerHistory";
import { useMobileScannerPhotoActions } from "../../hooks/useMobileScannerPhotoActions";
import { ScrollArea } from "../ui/scroll-area";
import type { MobilePhoto } from "./mobile-photo-helpers";
import {
  EmptyHistory,
  LoadingHistory,
  PhotoBatchCard,
  PhotoPreviewDialog,
  ScanCard,
  UndoDeleteToast,
} from "./mobile-scanner-cards";
import { installEditableTracker } from "./mobile-scanner-page-bridge";
import {
  resolveTimelineMessage,
  upsertTimelineEntry,
} from "../../domain/mobile-scanner-timeline";

/*
 * Source-contract breadcrumbs for scanner domain tests. Implementations live in:
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

interface MobileScannerProps {
  onClose?: () => void;
}

export default function MobileScanner({ onClose: _onClose }: MobileScannerProps) {
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
  }, [primeCursorTarget, refreshResults]);

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
        return;
      }
      if (message?.action === "scannerScan" || message?.action === "scannerPhoto") {
        void resolveTimelineMessage(message as MobileScannerResultBroadcastMessage, {
          saveScan: saveMobileScannerScan,
          savePhoto: saveMobileScannerPhoto,
        }).then((saved) => {
          if (!saved) return;
          setResults((current) => upsertTimelineEntry(current, saved));
          if (saved.type === "photo") {
            void prepareActiveTabForPhotoDrop();
          }
        });
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [prepareActiveTabForPhotoDrop, setResults]);

  useEffect(() => {
    if (photos.length > 0) void prepareActiveTabForPhotoDrop();
  }, [photos.length, prepareActiveTabForPhotoDrop]);

  return (
    <div className="sidepanel-shell relative flex h-full min-w-0 flex-col overflow-hidden">
      <div className="sidepanel-results-header flex-none min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="sidepanel-results-title text-xs font-bold uppercase tracking-normal">
              Results
            </div>
          </div>
          <button
            type="button"
            onClick={openVoltDownloadsFolder}
            className="sidepanel-results-files"
            aria-label="Open Volt Photos folder"
          >
            <FolderOpen className="h-4 w-4" />
            <span>Files</span>
          </button>
        </div>
      </div>

      <ScrollArea className="min-h-0 min-w-0 flex-1 px-3 pb-3 [&>div]:!overflow-x-hidden">
        <div className="min-w-0 space-y-3">
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
