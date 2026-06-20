import {
  buildMobilePhotoDownloadFilename,
  normalizeMobilePhoto,
  type MobilePhoto,
} from "../domain/mobile-photo";
import {
  saveMobileScannerPhoto,
  saveMobileScannerScan,
  shouldPersistScannerScan,
} from "../domain/mobile-scanner-results";
import { shouldInsertScannerMessage } from "../domain/scanner-message";
import type {
  RuntimeMessage,
  ScannerOffscreenRuntimeMessage,
  ScannerRuntimeMessage,
} from "./messages";
import { normalizeMobileCaptureMode } from "./mobile-capture-targets";
import type { ScannerTextInsertOptions } from "./scanner-text-insertion";

type LogFn = (...args: unknown[]) => void;

type SendResponse = (response?: unknown) => void;
type MessageSender = Parameters<typeof chrome.runtime.onMessage.addListener>[0] extends (
  message: unknown,
  sender: infer TSender,
  sendResponse: (...args: unknown[]) => void
) => unknown
  ? TSender
  : { tab?: { id?: number }; frameId?: number };

type ScannerMessageHandlerOptions = {
  chromeApi: typeof chrome;
  log: LogFn;
  sendScannerOffscreenMessage: (message: ScannerOffscreenRuntimeMessage) => Promise<unknown>;
  getScannerPushSubscription: () => Promise<PushSubscriptionJSON | null>;
  getMobileCaptureTarget: () => Promise<unknown>;
  updateMobileCaptureTarget: (
    target: unknown,
    sender: MessageSender | null
  ) => Promise<void>;
  insertScannerText: (text: string, options?: ScannerTextInsertOptions) => Promise<boolean>;
  openMobileScannerPairingPopup: (mode: string | null, state: unknown) => Promise<void>;
  resetMobileScannerActionPopup: () => Promise<void>;
};

const MOBILE_SCANNER_STORAGE_KEY = "volt.mobileScanner.scans";
const MOBILE_PHOTOS_STORAGE_KEY = "volt.mobilePhotos.photos";
const MOBILE_SCANNER_MAX_SCANS = 100;
const MOBILE_PHOTOS_MAX_PHOTOS = 80;
const MOBILE_PHOTOS_MAX_PERSISTED_BYTES = 6_000_000;

type ScannerIdentityUpdatedMessage = Extract<
  ScannerRuntimeMessage,
  { action: "scannerUpdateExtensionIdentity" }
>;
type ScannerStartMessage = Extract<
  ScannerRuntimeMessage,
  { action: "scannerStart" | "scannerStartForMode" }
>;
type OpenMobileCaptureMessage = {
  mode?: unknown;
  surface?: string;
  target?: unknown;
};
type ScannerScanMessage = Extract<ScannerRuntimeMessage, { action: "scannerOffscreenScan" }>;
type ScannerPhotoMessage = Extract<ScannerRuntimeMessage, { action: "scannerOffscreenPhoto" }>;

type ScannerScan = {
  id: string;
  barcode: string;
  dictationPhase?: "partial" | "final";
  dictationSessionId?: string;
  format?: string;
  kind: "text" | "barcode";
  scannedAt: string;
};

function normalizeScannerMessage(message: unknown): ScannerScan | null {
  const candidate = message as Partial<ScannerScan> | null;
  if (!candidate || typeof candidate.barcode !== "string" || !candidate.barcode) {
    return null;
  }

  return {
    ...candidate,
    barcode: candidate.barcode,
    dictationPhase:
      candidate.dictationPhase === "partial" || candidate.dictationPhase === "final"
        ? candidate.dictationPhase
        : undefined,
    dictationSessionId:
      typeof candidate.dictationSessionId === "string"
        ? candidate.dictationSessionId
        : undefined,
    id:
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind: candidate.kind === "text" ? "text" : "barcode",
    scannedAt:
      typeof candidate.scannedAt === "string"
        ? candidate.scannedAt
        : new Date().toISOString(),
  };
}

function stripMobilePhotoData<TPhoto extends { dataUrl?: string }>(photo: TPhoto) {
  const { dataUrl: _dataUrl, ...metadata } = photo;
  return metadata;
}

export function createScannerMessageHandler({
  chromeApi,
  log,
  sendScannerOffscreenMessage,
  getScannerPushSubscription,
  getMobileCaptureTarget,
  updateMobileCaptureTarget,
  insertScannerText,
  openMobileScannerPairingPopup,
  resetMobileScannerActionPopup,
}: ScannerMessageHandlerOptions) {
  function downloadMobilePhoto(photo: MobilePhoto) {
    return new Promise<{ success: true; downloadId: number; filename: string } | { success: false; error: string }>(
      (resolve) => {
        const filename = buildMobilePhotoDownloadFilename(photo);
        if (!photo.dataUrl) {
          resolve({ success: false, error: "missing_photo_data" });
          return;
        }
        chromeApi.downloads.download(
          {
            url: photo.dataUrl,
            filename,
            conflictAction: "uniquify",
            saveAs: false,
          },
          (downloadId) => {
            if (chromeApi.runtime.lastError || typeof downloadId !== "number") {
              resolve({
                success: false,
                error: chromeApi.runtime.lastError?.message || "download_failed",
              });
              return;
            }

            resolve({ success: true, downloadId, filename });
          }
        );
      }
    );
  }

  function persistScannerScan(scan: ScannerScan) {
    void saveMobileScannerScan(scan).catch((error) => {
      log("scanner IndexedDB scan persist failed", error instanceof Error ? error.message : error);
      chromeApi.storage.local.get(
        { [MOBILE_SCANNER_STORAGE_KEY]: [] },
        (stored) => {
          const current = Array.isArray(stored[MOBILE_SCANNER_STORAGE_KEY])
            ? stored[MOBILE_SCANNER_STORAGE_KEY]
            : [];
          const next = [scan, ...current].slice(0, MOBILE_SCANNER_MAX_SCANS);
          chromeApi.storage.local.set({ [MOBILE_SCANNER_STORAGE_KEY]: next });
        }
      );
    });
  }

  function trimMobilePhotosForStorage<TPhoto extends { dataUrl?: string }>(photos: TPhoto[]) {
    const trimmed = [];
    let totalBytes = 0;

    for (const photo of photos.slice(0, MOBILE_PHOTOS_MAX_PHOTOS)) {
      const estimatedBytes = typeof photo?.dataUrl === "string" ? photo.dataUrl.length : 0;
      if (trimmed.length > 0 && totalBytes + estimatedBytes > MOBILE_PHOTOS_MAX_PERSISTED_BYTES) {
        continue;
      }
      trimmed.push(stripMobilePhotoData(photo));
      totalBytes += estimatedBytes;
    }

    return trimmed;
  }

  function persistMobilePhoto<TPhoto extends { id?: string; dataUrl?: string }>(photo: TPhoto) {
    return new Promise<boolean>((resolve) => {
      chromeApi.storage.local.get(
        { [MOBILE_PHOTOS_STORAGE_KEY]: [] },
        (stored) => {
          const current = Array.isArray(stored[MOBILE_PHOTOS_STORAGE_KEY])
            ? stored[MOBILE_PHOTOS_STORAGE_KEY]
            : [];
          const next = trimMobilePhotosForStorage([
            photo,
            ...current.filter((item) => item?.id !== photo.id),
          ]);
          chromeApi.storage.local.set({ [MOBILE_PHOTOS_STORAGE_KEY]: next }, () => {
            resolve(!chromeApi.runtime.lastError);
          });
        }
      );
    });
  }

  function broadcastScannerMessage(message: unknown) {
    try {
      chromeApi.runtime.sendMessage(message, () => {
        void chromeApi.runtime.lastError;
      });
    } catch (_) {}
  }

  async function handleScannerIdentityUpdated(message: ScannerIdentityUpdatedMessage, sendResponse: SendResponse) {
    try {
      const state = await sendScannerOffscreenMessage({
        action: "scannerOffscreenUpdateExtensionIdentity",
        identity: message?.identity,
      });
      sendResponse({ success: true, state });
    } catch (err) {
      sendResponse({ success: false, error: String(err instanceof Error ? err.message : err) });
    }
  }

  async function handleScannerStart(message: ScannerStartMessage, sendResponse: SendResponse) {
    try {
      const state = await sendScannerOffscreenMessage({
        action: "scannerOffscreenStart",
        force: message?.force === true,
        mode: normalizeMobileCaptureMode(message?.mode),
        target: await getMobileCaptureTarget(),
      });
      sendResponse({ success: true, state });
    } catch (err) {
      sendResponse({ success: false, error: String(err instanceof Error ? err.message : err) });
    }
  }

  async function handleOpenMobileCapture(
    message: OpenMobileCaptureMessage,
    sender: MessageSender,
    sendResponse: SendResponse
  ) {
    try {
      if (message?.target) {
        await updateMobileCaptureTarget(message.target, sender);
      }
      const mode = normalizeMobileCaptureMode(message?.mode);
      const state = await sendScannerOffscreenMessage({
        action: "scannerOffscreenStart",
        force: false,
        mode,
        target: await getMobileCaptureTarget(),
      });

      if (message?.surface === "popup") {
        await openMobileScannerPairingPopup(mode, state);
      }

      sendResponse(
        (state as { qrCodeUrl?: unknown })?.qrCodeUrl
          ? { success: true, state }
          : { success: false, state, error: "missing_pairing_url" }
      );
    } catch (err) {
      sendResponse({ success: false, error: String(err instanceof Error ? err.message : err) });
    }
  }

  async function handleScannerDisconnect(sendResponse: SendResponse) {
    try {
      const state = await sendScannerOffscreenMessage({
        action: "scannerOffscreenDisconnect",
      });
      sendResponse({ success: true, state });
    } catch (err) {
      sendResponse({ success: false, error: String(err instanceof Error ? err.message : err) });
    }
  }

  async function handleScannerCloseJoinWindow(sendResponse: SendResponse) {
    try {
      const state = await sendScannerOffscreenMessage({
        action: "scannerOffscreenCloseJoinWindow",
      });
      sendResponse?.({ success: true, state });
    } catch (err) {
      sendResponse?.({ success: false, error: String(err instanceof Error ? err.message : err) });
    }
  }

  async function handleScannerPairingPopupClosed(sendResponse: SendResponse) {
    await resetMobileScannerActionPopup();
    try {
      const state = await sendScannerOffscreenMessage({
        action: "scannerOffscreenGetState",
      });
      sendResponse?.({ success: true, state });
      return;
    } catch (error) {
      log("Failed to inspect scanner state on popup close", error instanceof Error ? error.message : error);
    }
    sendResponse?.({ success: true });
  }

  async function handleScannerGetState(sendResponse: SendResponse) {
    try {
      const state = await sendScannerOffscreenMessage({
        action: "scannerOffscreenGetState",
      });
      sendResponse({ success: true, state });
    } catch (_err) {
      sendResponse({
        success: true,
        state: { status: "disconnected", qrCodeUrl: null, error: null },
      });
    }
  }

  async function handleScannerScan(message: ScannerScanMessage) {
    const scan = normalizeScannerMessage(message?.scan);
    if (!scan) return { success: false, insertedIntoCursor: false };
    if (shouldPersistScannerScan(scan)) {
      persistScannerScan(scan);
      broadcastScannerMessage({ action: "scannerScan", scan });
    }

    if (shouldInsertScannerMessage(scan)) {
      const insertedIntoCursor = await insertScannerText(scan.barcode, {
        dictationPhase: scan.dictationPhase,
        dictationSessionId: scan.dictationSessionId,
        format: scan.format,
        kind: scan.kind,
      });
      return { success: true, insertedIntoCursor };
    }

    return { success: true, insertedIntoCursor: false };
  }

  async function handleScannerPhoto(message: ScannerPhotoMessage) {
    const photo = normalizeMobilePhoto(message?.photo);
    if (!photo) return { success: false, error: "invalid_photo" };

    const downloadResult = await downloadMobilePhoto(photo);
    if (!downloadResult.success) return { success: false, error: downloadResult.error || "download_failed" };

    const downloadedPhoto = {
      ...photo,
      downloadId: downloadResult.downloadId,
      downloadFilename: downloadResult.filename,
    };
    const savedPhoto = await saveMobileScannerPhoto(downloadedPhoto).catch((error) => {
      log("scanner IndexedDB photo persist failed", error instanceof Error ? error.message : error);
      return null;
    });
    const persisted = savedPhoto ? true : await persistMobilePhoto(downloadedPhoto);
    if (!persisted) return { success: false, error: "storage_failed" };
    const { blob: _blob, ...savedPhotoMetadata } = savedPhoto?.photo ?? {};
    broadcastScannerMessage({
      action: "scannerPhoto",
      photo: savedPhoto
        ? { ...savedPhotoMetadata, dataUrl: downloadedPhoto.dataUrl }
        : downloadedPhoto,
    });
    return { success: true };
  }

  function handleScannerMessage(
    message: RuntimeMessage,
    sender: MessageSender,
    sendResponse: SendResponse
  ) {
    if (!("action" in message)) return false;

    switch (message?.action) {
      case "scannerStart":
      case "scannerStartForMode":
        void handleScannerStart(message, sendResponse);
        return true;
      case "openMobileCapture":
        void handleOpenMobileCapture(message, sender, sendResponse);
        return true;
      case "openMobileCapturePopup":
        void handleOpenMobileCapture({ mode: message.mode, target: message.target, surface: "popup" }, sender, sendResponse);
        return true;
      case "scannerDisconnect":
        void handleScannerDisconnect(sendResponse);
        return true;
      case "scannerCloseJoinWindow":
        void handleScannerCloseJoinWindow(sendResponse);
        return true;
      case "scannerPairingPopupClosed":
        void handleScannerPairingPopupClosed(sendResponse);
        return true;
      case "scannerGetState":
        void handleScannerGetState(sendResponse);
        return true;
      case "scannerUpdateExtensionIdentity":
        void handleScannerIdentityUpdated(message, sendResponse);
        return true;
      case "scannerGetPushSubscription":
        getScannerPushSubscription()
          .then((subscription) => sendResponse({ success: true, subscription }))
          .catch((err) => sendResponse({ success: false, error: String(err instanceof Error ? err.message : err) }));
        return true;
      case "mobileCursorTargetChanged":
        void updateMobileCaptureTarget(message?.target, sender);
        sendResponse({ success: true });
        return false;
      case "scannerStateChanged":
        if (message?.source !== "scanner-background") {
          broadcastScannerMessage({
            action: "scannerStateChanged",
            source: "scanner-background",
            state: message?.state,
          });
        }
        sendResponse({ success: true });
        return true;
      case "scannerDebugLog":
        log(...(Array.isArray(message?.args) ? message.args : []));
        sendResponse({ success: true });
        return true;
      case "scannerOffscreenScan":
        handleScannerScan(message).then(sendResponse);
        return true;
      case "scannerOffscreenPhoto":
        handleScannerPhoto(message).then(sendResponse);
        return true;
      default:
        return false;
    }
  }

  return { broadcastScannerMessage, handleScannerMessage };
}
