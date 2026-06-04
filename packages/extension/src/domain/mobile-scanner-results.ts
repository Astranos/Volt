import type { BarcodeMessage } from "../../../scanner-protocol/src";
import { normalizeMobilePhoto, type MobilePhoto } from "./mobile-photo.ts";

export const MOBILE_SCANNER_RESULTS_DB = "volt-mobile-scanner-results";
export const MOBILE_SCANNER_RESULTS_VERSION = 1;
export const MOBILE_SCANNER_SESSION_MARKER_KEY =
  "volt.mobileScanner.browserSession.v1";
export const PHOTO_BATCH_WINDOW_MS = 5 * 60 * 1000;
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

type StoredPhotoBlob = {
  photoId: string;
  blob: Blob;
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
      (a, b) => toTimestamp(b.capturedAt) - toTimestamp(a.capturedAt),
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

export async function saveMobileScannerScan(scan: BarcodeMessage & { id?: string }) {
  await ensureMobileScannerBrowserSessionStore();
  const result = normalizeScannerScanResult(scan);
  if (!result) return null;
  await withStore("results", "readwrite", (transaction) => {
    transaction.objectStore("results").put(result);
  });
  return result;
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
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

  const result = await withStore(
    ["results", "photoBlobs", "meta"],
    "readwrite",
    async (transaction) => {
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
      blob,
    },
  } satisfies HydratedMobileScannerPhotoResult;
}

export async function listMobileScannerResults() {
  await ensureMobileScannerBrowserSessionStore();
  return withStore(
    ["results", "photoBlobs"],
    "readonly",
    async (transaction) => {
      const rawResults = (await promisifyRequest(
        transaction.objectStore("results").getAll(),
      )) as MobileScannerResult[];
      const blobRows = (await promisifyRequest(
        transaction.objectStore("photoBlobs").getAll(),
      )) as StoredPhotoBlob[];
      const blobs = new Map(blobRows.map((row) => [row.photoId, row.blob]));
      return rawResults
        .map((result): HydratedMobileScannerResult => {
          if (result.type === "scan") return result;
          const blob = blobs.get(result.id);
          return {
            ...result,
            photo: {
              ...result.photo,
              blob,
            },
          };
        })
        .sort((a, b) => toTimestamp(b.capturedAt) - toTimestamp(a.capturedAt));
    },
  );
}

export async function deleteMobileScannerResults(ids: string[]) {
  if (ids.length === 0) return;
  await withStore(["results", "photoBlobs"], "readwrite", (transaction) => {
    const results = transaction.objectStore("results");
    const blobs = transaction.objectStore("photoBlobs");
    ids.forEach((id) => {
      results.delete(id);
      blobs.delete(id);
    });
  });
}

export async function restoreMobileScannerResults(
  results: HydratedMobileScannerResult[],
) {
  if (results.length === 0) return;
  await ensureMobileScannerBrowserSessionStore();
  await withStore(["results", "photoBlobs"], "readwrite", (transaction) => {
    const resultStore = transaction.objectStore("results");
    const blobStore = transaction.objectStore("photoBlobs");
    for (const result of results) {
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
