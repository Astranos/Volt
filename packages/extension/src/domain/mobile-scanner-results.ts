import type { BarcodeMessage } from "./mobile-scanner-session";
import { normalizeMobilePhoto, type MobilePhoto } from "./mobile-photo.ts";

export const MOBILE_SCANNER_RESULTS_DB = "volt-mobile-scanner-results";
export const MOBILE_SCANNER_RESULTS_VERSION = 2;
export const MOBILE_SCANNER_SESSION_MARKER_KEY =
  "volt.mobileScanner.browserSession.v1";
export const PHOTO_BATCH_WINDOW_MS = 5 * 60 * 1000;
export const MOBILE_SCANNER_DELETE_UNDO_WINDOW_MS = 7000;
export const MAX_SCAN_RESULTS = 100;
export const MAX_PHOTO_RESULTS = 250;

export type MobileScannerScanResult = {
  type: "scan";
  id: string;
  kind: "text" | "barcode";
  value: string;
  format?: string;
  capturedAt: string;
  scan: BarcodeMessage & { id: string; kind: "text" | "barcode" };
};

export type MobileScannerPhotoResult = {
  type: "photo";
  id: string;
  photoBatchId: string;
  capturedAt: string;
  photo: Omit<MobilePhoto, "dataUrl" | "blob"> & { photoBatchId: string };
};

export type MobileScannerResult =
  | MobileScannerScanResult
  | MobileScannerPhotoResult;

export type HydratedMobileScannerPhotoResult = MobileScannerPhotoResult & {
  photo: MobilePhoto & { photoBatchId: string };
};

export type HydratedMobileScannerResult =
  | MobileScannerScanResult
  | HydratedMobileScannerPhotoResult;

export type MobileScannerResultBroadcastMessage =
  | {
      action: "scannerScan";
      scan: BarcodeMessage & { id?: string };
      result?: MobileScannerScanResult;
    }
  | {
      action: "scannerPhoto";
      photo: MobilePhoto;
      result?: HydratedMobileScannerPhotoResult;
    };

export type MobileScannerResultDeliveryReceipt =
  | { success: true; result: HydratedMobileScannerPhotoResult | null }
  | { success: false; error: string };

type MobileScannerDeliveryOptions = {
  broadcastScannerMessage: (message: MobileScannerResultBroadcastMessage) => void;
  onPersistError?: (error: unknown) => void;
};

type MobileScannerScanDeliveryOptions = MobileScannerDeliveryOptions & {
  persistFallbackScan?: (scan: BarcodeMessage & { id?: string }) => Promise<boolean> | boolean;
  saveScan?: typeof saveMobileScannerScan;
};

type MobileScannerPhotoDeliveryOptions = MobileScannerDeliveryOptions & {
  persistFallbackPhoto?: (photo: MobilePhoto) => Promise<boolean> | boolean;
  savePhoto?: typeof saveMobileScannerPhoto;
};

type StoredPhotoBlob = {
  photoId: string;
  blob: Blob;
};

type DeletedResultMarker = {
  id: string;
  deletedAt: string;
  purgeAt: string;
};

type ActivePhotoBatch = {
  id: string;
  lastCapturedAt: number;
};

type MobileScannerMeta = {
  key: "meta";
  activePhotoBatch?: ActivePhotoBatch;
};

function hasChromeStorageSession() {
  return (
    typeof chrome !== "undefined" &&
    Boolean(chrome.storage?.session?.get) &&
    Boolean(chrome.storage?.session?.set)
  );
}

function createId(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now()}-${random}`;
}

function toTimestamp(value: string | undefined, fallback = Date.now()) {
  if (!value) return fallback;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function normalizeCapturedAt(value: string | undefined) {
  const timestamp = toTimestamp(value);
  return new Date(timestamp).toISOString();
}

function stripPhotoRuntimeFields(photo: MobilePhoto) {
  const { dataUrl, blob, ...metadata } = photo;
  return metadata;
}

export function shouldPersistScannerScan(scan: BarcodeMessage) {
  return !(scan.kind === "text" && scan.format === "dictation");
}

export function normalizeScannerScanResult(
  scan: BarcodeMessage & { id?: string },
): MobileScannerScanResult | null {
  if (!shouldPersistScannerScan(scan)) return null;
  if (typeof scan.barcode !== "string" || !scan.barcode) return null;
  const kind = scan.kind === "text" ? "text" : "barcode";
  const id = scan.id || createId("scan");
  const capturedAt = normalizeCapturedAt(scan.scannedAt);
  const normalizedScan: BarcodeMessage & { id: string; kind: "text" | "barcode" } = {
    ...scan,
    id,
    kind,
    scannedAt: capturedAt,
  };
  return {
    type: "scan",
    id,
    kind,
    value: scan.barcode,
    format: typeof scan.format === "string" ? scan.format : undefined,
    capturedAt,
    scan: normalizedScan,
  };
}

export function createPhotoBatchId(capturedAt: number) {
  return `photo-batch-${capturedAt}-${Math.random().toString(36).slice(2, 8)}`;
}

export function resolvePhotoBatchId({
  activeBatch,
  capturedAt,
  existingBatchId,
}: {
  activeBatch?: ActivePhotoBatch | null;
  capturedAt: number;
  existingBatchId?: string;
}) {
  if (existingBatchId) return existingBatchId;
  if (
    activeBatch &&
    Math.abs(capturedAt - activeBatch.lastCapturedAt) <= PHOTO_BATCH_WINDOW_MS
  ) {
    return activeBatch.id;
  }
  return createPhotoBatchId(capturedAt);
}

export function groupPhotoResultsByBatch(
  photos: MobileScannerPhotoResult[],
) {
  const groups = new Map<string, MobileScannerPhotoResult[]>();
  for (const photo of photos) {
    const group = groups.get(photo.photoBatchId) ?? [];
    group.push(photo);
    groups.set(photo.photoBatchId, group);
  }
  return Array.from(groups.entries()).map(([photoBatchId, entries]) => ({
    photoBatchId,
    entries: entries.sort(
      (a, b) => toTimestamp(a.capturedAt) - toTimestamp(b.capturedAt),
    ),
    startAt: Math.min(...entries.map((entry) => toTimestamp(entry.capturedAt))),
    endAt: Math.max(...entries.map((entry) => toTimestamp(entry.capturedAt))),
  }));
}

function openResultsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("indexedDB_unavailable"));
      return;
    }

    const request = indexedDB.open(
      MOBILE_SCANNER_RESULTS_DB,
      MOBILE_SCANNER_RESULTS_VERSION,
    );
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("results")) {
        const results = db.createObjectStore("results", { keyPath: "id" });
        results.createIndex("type", "type");
        results.createIndex("capturedAt", "capturedAt");
        results.createIndex("photoBatchId", "photoBatchId");
      }
      if (!db.objectStoreNames.contains("photoBlobs")) {
        db.createObjectStore("photoBlobs", { keyPath: "photoId" });
      }
      if (!db.objectStoreNames.contains("deletedResults")) {
        const deletedResults = db.createObjectStore("deletedResults", { keyPath: "id" });
        deletedResults.createIndex("purgeAt", "purgeAt");
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    request.onerror = () => reject(request.error ?? new Error("idb_open_failed"));
    request.onsuccess = () => resolve(request.result);
  });
}

function promisifyRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("idb_failed"));
    request.onsuccess = () => resolve(request.result);
  });
}

async function withStore<T>(
  names: string | string[],
  mode: IDBTransactionMode,
  run: (transaction: IDBTransaction) => Promise<T> | T,
) {
  const db = await openResultsDb();
  try {
    const transaction = db.transaction(names, mode);
    const result = await run(transaction);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("idb_transaction_failed"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("idb_transaction_aborted"));
    });
    return result;
  } finally {
    db.close();
  }
}

export async function clearMobileScannerResultsStore() {
  const db = await openResultsDb();
  try {
    await Promise.all(
      Array.from(db.objectStoreNames).map(
        (storeName) =>
          new Promise<void>((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            tx.objectStore(storeName).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () =>
              reject(tx.error ?? new Error("idb_clear_failed"));
          }),
      ),
    );
  } finally {
    db.close();
  }
}

export async function ensureMobileScannerBrowserSessionStore() {
  if (!hasChromeStorageSession()) return;
  const stored = await chrome.storage.session.get({
    [MOBILE_SCANNER_SESSION_MARKER_KEY]: null,
  });
  if (stored[MOBILE_SCANNER_SESSION_MARKER_KEY]) return;
  await clearMobileScannerResultsStore();
  await chrome.storage.session.set({
    [MOBILE_SCANNER_SESSION_MARKER_KEY]: createId("browser-session"),
  });
}

async function getMeta(transaction: IDBTransaction) {
  const store = transaction.objectStore("meta");
  return (
    ((await promisifyRequest(store.get("meta"))) as MobileScannerMeta | undefined) ??
    { key: "meta" as const }
  );
}

async function putMeta(transaction: IDBTransaction, meta: MobileScannerMeta) {
  transaction.objectStore("meta").put(meta);
}

async function purgeExpiredDeletedResults(transaction: IDBTransaction, now = Date.now()) {
  const deletedStore = transaction.objectStore("deletedResults");
  const resultsStore = transaction.objectStore("results");
  const blobStore = transaction.objectStore("photoBlobs");
  const markers = (await promisifyRequest(deletedStore.getAll())) as DeletedResultMarker[];
  for (const marker of markers) {
    if (toTimestamp(marker.purgeAt, 0) > now) continue;
    resultsStore.delete(marker.id);
    blobStore.delete(marker.id);
    deletedStore.delete(marker.id);
  }
}

export async function saveMobileScannerScan(scan: BarcodeMessage & { id?: string }) {
  await ensureMobileScannerBrowserSessionStore();
  const result = normalizeScannerScanResult(scan);
  if (!result) return null;
  await withStore(["results", "photoBlobs", "deletedResults"], "readwrite", async (transaction) => {
    await purgeExpiredDeletedResults(transaction);
    transaction.objectStore("results").put(result);
    transaction.objectStore("deletedResults").delete(result.id);
  });
  return result;
}

export async function persistAndBroadcastMobileScannerScan(
  scan: BarcodeMessage & { id?: string },
  {
    broadcastScannerMessage,
    onPersistError,
    persistFallbackScan,
    saveScan = saveMobileScannerScan,
  }: MobileScannerScanDeliveryOptions,
) {
  if (!shouldPersistScannerScan(scan)) return null;

  let result: MobileScannerScanResult | null = null;
  try {
    result = await saveScan(scan);
  } catch (error) {
    onPersistError?.(error);
    await persistFallbackScan?.(scan);
  }

  broadcastScannerMessage({
    action: "scannerScan",
    scan,
    result: result ?? undefined,
  });
  return result;
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
}

async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Blob read failed"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(blob);
  });
}

export async function saveMobileScannerPhoto(photoInput: unknown) {
  await ensureMobileScannerBrowserSessionStore();
  const normalized = normalizeMobilePhoto(photoInput);
  if (!normalized) return null;

  const capturedAt = normalizeCapturedAt(normalized.capturedAt);
  const capturedTimestamp = toTimestamp(capturedAt);
  const blob =
    normalized.blob ??
    (typeof normalized.dataUrl === "string"
      ? await dataUrlToBlob(normalized.dataUrl)
      : undefined);
  if (!blob && typeof normalized.dataUrl !== "string") return null;

  const result = await withStore(
    ["results", "photoBlobs", "meta", "deletedResults"],
    "readwrite",
    async (transaction) => {
      await purgeExpiredDeletedResults(transaction);
      const meta = await getMeta(transaction);
      const photoBatchId = resolvePhotoBatchId({
        activeBatch: meta.activePhotoBatch,
        capturedAt: capturedTimestamp,
        existingBatchId: normalized.photoBatchId,
      });
      const photo = {
        ...stripPhotoRuntimeFields(normalized),
        photoBatchId,
        capturedAt,
      };
      const photoResult: MobileScannerPhotoResult = {
        type: "photo",
        id: normalized.id,
        photoBatchId,
        capturedAt,
        photo,
      };
      transaction.objectStore("results").put(photoResult);
      transaction.objectStore("deletedResults").delete(photoResult.id);
      if (blob) {
        transaction.objectStore("photoBlobs").put({
          photoId: normalized.id,
          blob,
        } satisfies StoredPhotoBlob);
      }
      await putMeta(transaction, {
        ...meta,
        activePhotoBatch: {
          id: photoBatchId,
          lastCapturedAt: capturedTimestamp,
        },
      });
      return photoResult;
    },
  );

  return {
    ...result,
    photo: {
      ...result.photo,
      dataUrl: normalized.dataUrl,
      blob,
    },
  } satisfies HydratedMobileScannerPhotoResult;
}

export async function persistAndBroadcastMobileScannerPhoto(
  photoInput: unknown,
  {
    broadcastScannerMessage,
    onPersistError,
    persistFallbackPhoto,
    savePhoto = saveMobileScannerPhoto,
  }: MobileScannerPhotoDeliveryOptions,
): Promise<MobileScannerResultDeliveryReceipt> {
  const normalized = normalizeMobilePhoto(photoInput);
  if (!normalized) return { success: false, error: "invalid_photo" };

  let result: HydratedMobileScannerPhotoResult | null = null;
  try {
    result = await savePhoto(normalized);
  } catch (error) {
    onPersistError?.(error);
  }

  const persisted = result ? true : Boolean(await persistFallbackPhoto?.(normalized));
  if (!persisted) return { success: false, error: "storage_failed" };

  const broadcastPhoto = result
    ? (() => {
        const { blob: _blob, ...savedPhotoMetadata } = result.photo;
        return { ...savedPhotoMetadata, dataUrl: normalized.dataUrl };
      })()
    : normalized;
  broadcastScannerMessage({
    action: "scannerPhoto",
    photo: broadcastPhoto,
    result: result ?? undefined,
  });

  return { success: true, result };
}

export async function listMobileScannerResults() {
  await ensureMobileScannerBrowserSessionStore();
  return withStore(
    ["results", "photoBlobs", "deletedResults"],
    "readonly",
    async (transaction) => {
      const rawResults = (await promisifyRequest(
        transaction.objectStore("results").getAll(),
      )) as MobileScannerResult[];
      const blobRows = (await promisifyRequest(
        transaction.objectStore("photoBlobs").getAll(),
      )) as StoredPhotoBlob[];
      const deletedRows = (await promisifyRequest(
        transaction.objectStore("deletedResults").getAll(),
      )) as DeletedResultMarker[];
      const blobs = new Map(blobRows.map((row) => [row.photoId, row.blob]));
      const deletedIds = new Set(deletedRows.map((row) => row.id));
      const hydratedResults = await Promise.all(
        rawResults
          .filter((result) => !deletedIds.has(result.id))
          .map(async (result): Promise<HydratedMobileScannerResult> => {
            if (result.type === "scan") return result;
            const blob = blobs.get(result.id);
            return {
              ...result,
              photo: {
                ...result.photo,
                dataUrl: blob
                  ? await blobToDataUrl(blob).catch(() => undefined)
                  : undefined,
                blob,
              },
            };
          }),
      );
      return hydratedResults.sort(
        (a, b) => toTimestamp(b.capturedAt) - toTimestamp(a.capturedAt),
      );
    },
  );
}

export async function deleteMobileScannerResults(ids: string[]) {
  if (ids.length === 0) return;
  const deletedAt = new Date().toISOString();
  const purgeAt = new Date(Date.now() + MOBILE_SCANNER_DELETE_UNDO_WINDOW_MS).toISOString();
  await withStore(["results", "photoBlobs", "deletedResults"], "readwrite", async (transaction) => {
    await purgeExpiredDeletedResults(transaction);
    const deletedResults = transaction.objectStore("deletedResults");
    ids.forEach((id) => {
      deletedResults.put({ id, deletedAt, purgeAt } satisfies DeletedResultMarker);
    });
  });
}

export async function restoreMobileScannerResults(
  results: HydratedMobileScannerResult[],
) {
  if (results.length === 0) return;
  await ensureMobileScannerBrowserSessionStore();
  await withStore(["results", "photoBlobs", "deletedResults"], "readwrite", async (transaction) => {
    await purgeExpiredDeletedResults(transaction);
    const resultStore = transaction.objectStore("results");
    const blobStore = transaction.objectStore("photoBlobs");
    const deletedStore = transaction.objectStore("deletedResults");
    for (const result of results) {
      deletedStore.delete(result.id);
      if (result.type === "scan") {
        resultStore.put(result);
        continue;
      }
      const { blob, dataUrl, ...photo } = result.photo;
      resultStore.put({
        ...result,
        photo,
      });
      if (blob) {
        blobStore.put({ photoId: result.id, blob } satisfies StoredPhotoBlob);
      }
    }
  });
}

export async function purgeExpiredMobileScannerDeletedResults() {
  await withStore(["results", "photoBlobs", "deletedResults"], "readwrite", async (transaction) => {
    await purgeExpiredDeletedResults(transaction);
  });
}
