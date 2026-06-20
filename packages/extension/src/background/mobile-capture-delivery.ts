import {
  persistAndBroadcastMobileScannerScan,
  shouldPersistScannerScan,
} from "../domain/mobile-scanner-results.ts";
import { shouldInsertScannerMessage } from "../domain/scanner-message.ts";
import type { ScannerTextInsertOptions } from "./scanner-text-insertion.ts";

type LogFn = (...args: unknown[]) => void;

export const MOBILE_SCANNER_STORAGE_KEY = "volt.mobileScanner.scans";
export const MOBILE_SCANNER_MAX_SCANS = 100;

export type CursorTargetedCaptureScan = {
  id: string;
  barcode: string;
  dictationPhase?: "partial" | "final";
  dictationSessionId?: string;
  format?: string;
  insertIntoCursor?: boolean;
  kind: "text" | "barcode";
  scannedAt: string;
};

export type CaptureDeliveryReceipt = {
  success: boolean;
  insertedIntoCursor: boolean;
};

type CursorTargetedCaptureDeliveryOptions = {
  chromeApi: typeof chrome;
  log: LogFn;
  insertScannerText: (text: string, options?: ScannerTextInsertOptions) => Promise<boolean>;
  broadcastScannerMessage: (message: unknown) => void;
};

export function createCursorTargetedCaptureDelivery({
  chromeApi,
  log,
  insertScannerText,
  broadcastScannerMessage,
}: CursorTargetedCaptureDeliveryOptions) {
  function persistFallbackScan(scan: CursorTargetedCaptureScan) {
    return new Promise<boolean>((resolve) => {
      chromeApi.storage.local.get({ [MOBILE_SCANNER_STORAGE_KEY]: [] }, (stored) => {
        const current = Array.isArray(stored[MOBILE_SCANNER_STORAGE_KEY])
          ? stored[MOBILE_SCANNER_STORAGE_KEY]
          : [];
        const next = [scan, ...current].slice(0, MOBILE_SCANNER_MAX_SCANS);
        chromeApi.storage.local.set({ [MOBILE_SCANNER_STORAGE_KEY]: next }, () => {
          resolve(!chromeApi.runtime?.lastError);
        });
      });
    });
  }

  async function deliverScannerScan(scan: CursorTargetedCaptureScan): Promise<CaptureDeliveryReceipt> {
    if (shouldPersistScannerScan(scan)) {
      void persistAndBroadcastMobileScannerScan(scan, {
        broadcastScannerMessage,
        persistFallbackScan: (scanForFallback) =>
          persistFallbackScan(scanForFallback as CursorTargetedCaptureScan),
        onPersistError: (error) => {
          log("scanner IndexedDB scan persist failed", error instanceof Error ? error.message : error);
        },
      });
    }

    if (!shouldInsertScannerMessage(scan)) {
      return { success: true, insertedIntoCursor: false };
    }

    const insertedIntoCursor = await insertScannerText(scan.barcode, {
      dictationPhase: scan.dictationPhase,
      dictationSessionId: scan.dictationSessionId,
      format: scan.format,
      kind: scan.kind,
    });

    return { success: true, insertedIntoCursor };
  }

  return { deliverScannerScan };
}
