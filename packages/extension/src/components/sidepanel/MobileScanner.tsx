import { useCallback, useEffect, useRef, useState } from "react";
import { Smartphone } from "lucide-react";
import {
  saveMobileScannerPhoto,
  saveMobileScannerScan,
  type MobileScannerResultBroadcastMessage,
  type MobileScannerScanResult,
} from "../../domain/mobile-scanner-results";
import { showSidepanelToast, type SidepanelToastTone } from "../../lib/sidepanel-toast";
import { useCloudWorkspaceSnapshot } from "../../hooks/useCloudWorkspaceSnapshot";
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
import { cloudResultIds } from "../../cloud-scanner/workspace-hydration";
import { useSidepanelSignedIn } from "../access/ExtensionAccess";

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
  const isSignedIn = useSidepanelSignedIn();
  const cloudWorkspace = useCloudWorkspaceSnapshot();
  const [now, setNow] = useState(Date.now());
  const lastCloudDeletedIds = useRef<string[]>([]);

  const flashFeedback = useCallback(
    (message: string, tone: SidepanelToastTone = "success") => {
      showSidepanelToast(message, tone);
    },
    [],
  );

  const {
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
    sendPhotosToTab,
    dragPhotos,
    dragPhotoBatch,
  } = useMobileScannerPhotoActions({
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

  const deleteSyncedResults = useCallback(async (ids: string[], label: string) => {
    const cloudIds = await cloudResultIds(ids);
    if (cloudIds.length > 0) {
      const response: unknown = await chrome.runtime.sendMessage({
        action: "workspaceDeleteResults",
        resultIds: cloudIds,
      });
      if (!response || typeof response !== "object" || (response as { success?: unknown }).success !== true) {
        flashFeedback("Could not delete cloud results", "error");
        return;
      }
    }
    lastCloudDeletedIds.current = cloudIds;
    deleteResults(ids, label);
  }, [deleteResults, flashFeedback]);

  const undoSyncedDelete = useCallback(async () => {
    const cloudIds = lastCloudDeletedIds.current;
    if (cloudIds.length > 0) {
      const response: unknown = await chrome.runtime.sendMessage({
        action: "workspaceRestoreResults",
        resultIds: cloudIds,
      });
      if (!response || typeof response !== "object" || (response as { success?: unknown }).success !== true) {
        flashFeedback("Could not restore cloud results", "error");
        return;
      }
    }
    lastCloudDeletedIds.current = [];
    await undoDelete();
  }, [flashFeedback, undoDelete]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    void refreshResults();
    void primeCursorTarget();
  }, [primeCursorTarget, refreshResults]);

  // The local store loads in milliseconds; the first cloud snapshot does not.
  // Showing an empty timeline in that gap tells a signed-in user their captures
  // are missing when they are still on the way.
  const awaitingCloudResults =
    isSignedIn === true && cloudWorkspace.status === "loading" && groups.length === 0;

  // The panel's own Convex subscription merges into the same local history the
  // service worker writes, so a snapshot it applied is read back the same way.
  useEffect(() => {
    if (cloudWorkspace.version === 0) return;
    void refreshResults();
  }, [cloudWorkspace.version, refreshResults]);

  useEffect(() => {
    const prepareActiveTab = () => {
      void primeCursorTarget();
      if (photos.length > 0) void prepareActiveTabForPhotoDrop();
    };
    const onActivated = () => prepareActiveTab();
    const onUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (
      _tabId,
      changeInfo,
      tab,
    ) => {
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
    const handleMessage = (message: unknown) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) return;
      const record = message as Record<string, unknown>;
      if (record.action === "scannerStateChanged") return;
      if (record.action === "workspaceReplicaChanged") {
        void refreshResults();
        return;
      }
      if (record.action === "scannerScan" || record.action === "scannerPhoto") {
        void resolveTimelineMessage(record as MobileScannerResultBroadcastMessage, {
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
  }, [prepareActiveTabForPhotoDrop, refreshResults, setResults]);

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
            onClick={() =>
              void chrome.runtime.sendMessage({ action: "openMobileCapturePopup" })
            }
            className="sidepanel-results-appclip"
            aria-label="Open Volt App Clip QR code"
            title="Connect Volt App Clip"
          >
            <Smartphone className="h-4 w-4" />
            <span>App Clip</span>
          </button>
        </div>
      </div>

      {cloudWorkspace.error ? (
        <div
          className="mx-3 mb-2 flex-none rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200"
          aria-live="polite"
        >
          {cloudWorkspace.error}
        </div>
      ) : null}

      <ScrollArea className="min-h-0 min-w-0 flex-1 px-4 pb-4 [&>div]:!overflow-x-hidden">
        <div className="min-w-0 space-y-3">
          {loadingResults || awaitingCloudResults ? (
            <LoadingHistory />
          ) : groups.length === 0 ? (
            <EmptyHistory signedOut={isSignedIn === false} />
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
                  onDeleteBatch={() => void deleteSyncedResults(group.entries.map((entry) => entry.id), "Photo batch deleted")}
                  onDeletePhoto={(photoId) => void deleteSyncedResults([photoId], "Photo deleted")}
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
                  onDelete={() => void deleteSyncedResults([group.key], "Result deleted")}
                />
              ),
            )
          )}
        </div>
      </ScrollArea>

      {deletedSnapshot ? (
        <UndoDeleteToast label={deletedSnapshot.label} onUndo={undoSyncedDelete} />
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
