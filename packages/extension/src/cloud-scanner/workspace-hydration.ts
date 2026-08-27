import {
  clearMobileScannerResultsStore,
  deleteMobileScannerResults,
  listMobileScannerResults,
  saveMobileScannerPhoto,
  saveMobileScannerScan,
} from "../domain/mobile-scanner-results.ts";
import type { CloudScannerResult, WorkspaceReplica } from "./workspace-types.ts";

const CLOUD_ORIGINS_KEY = "volt.cloudScanner.resultOrigins.v1";

type CloudOrigin = { workspaceId: string; batchId: string };
type CloudOrigins = Record<string, CloudOrigin>;

export function removeAppliedTombstoneOrigins(origins: CloudOrigins, ids: string[]) {
  const next = { ...origins };
  for (const id of ids) delete next[id];
  return next;
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function loadOrigins(): Promise<CloudOrigins> {
  const stored = await chrome.storage.local.get(CLOUD_ORIGINS_KEY);
  const record = recordFrom(stored[CLOUD_ORIGINS_KEY]) ?? {};
  const origins: CloudOrigins = {};
  for (const [id, value] of Object.entries(record)) {
    const origin = recordFrom(value);
    if (typeof origin?.workspaceId === "string" && typeof origin.batchId === "string") {
      origins[id] = { workspaceId: origin.workspaceId, batchId: origin.batchId };
    }
  }
  return origins;
}

export function planWorkspaceHydration(
  replica: WorkspaceReplica,
  existingIds: Set<string>,
  cloudOriginIds: Set<string>,
) {
  const available: CloudScannerResult[] = [];
  const deletedIds = Object.keys(replica.tombstones.results)
    .filter((id) => cloudOriginIds.has(id));
  for (const batch of replica.batches) {
    for (const result of batch.results) {
      if (existingIds.has(result.id) || result.deliveryState !== "available") continue;
      // A result row is available the moment the phone records it, but a photo's
      // bytes only exist once the batch is verified ready. Downloading before
      // that reported a sync failure for a photo that was merely still
      // uploading, which then cleared itself when the photo arrived.
      if (result.kind === "photo" && batch.deliveryState !== "available") continue;
      available.push(result);
    }
  }
  return { available, deletedIds };
}

type PhotoDownload = {
  url: string;
  headers?: Record<string, string>;
};

type WorkspaceHydrationOptions = {
  getPhotoDownload?: (batchId: string, resultId: string) => Promise<PhotoDownload>;
};

async function defaultPhotoDownload(batchId: string, resultId: string) {
  const response: unknown = await chrome.runtime.sendMessage({
    action: "workspaceGetPhotoDownload",
    batchId,
    resultId,
  });
  const responseRecord = recordFrom(response);
  const value = recordFrom(responseRecord?.value);
  if (responseRecord?.success !== true || typeof value?.url !== "string") return null;
  const headers = recordFrom(value.headers);
  return {
    url: value.url,
    headers: headers
      ? Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : undefined,
  };
}

async function photoBlob(result: CloudScannerResult, options: WorkspaceHydrationOptions) {
  const source = options.getPhotoDownload
    ? await options.getPhotoDownload(result.batchId, result.id)
    : await defaultPhotoDownload(result.batchId, result.id);
  if (!source) return null;
  const download = await fetch(source.url, { headers: source.headers });
  return download.ok ? download.blob() : null;
}

async function blobToDataUrl(blob: Blob) {
  if (typeof FileReader !== "undefined") {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("Cloud photo read failed"));
      reader.onload = () => resolve(String(reader.result || ""));
      reader.readAsDataURL(blob);
    });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

export async function resetWorkspaceHydration() {
  await clearMobileScannerResultsStore();
  await chrome.storage.local.remove(CLOUD_ORIGINS_KEY);
}

export async function hydrateWorkspaceReplica(
  replica: WorkspaceReplica,
  options: WorkspaceHydrationOptions = {},
) {
  const existing = await listMobileScannerResults();
  let origins = await loadOrigins();
  for (const batch of replica.batches) {
    for (const result of batch.results) {
      origins[result.id] = { workspaceId: replica.workspaceId, batchId: batch.id };
    }
  }
  const workspaceOriginIds = new Set(
    Object.entries(origins)
      .filter(([, origin]) => origin.workspaceId === replica.workspaceId)
      .map(([id]) => id),
  );
  const plan = planWorkspaceHydration(
    replica,
    new Set(existing.map((result) => result.id)),
    workspaceOriginIds,
  );
  if (plan.deletedIds.length > 0) await deleteMobileScannerResults(plan.deletedIds);
  origins = removeAppliedTombstoneOrigins(origins, plan.deletedIds);
  // One unreachable photo must not strand the results behind it, and it must
  // not pass for success either: the failures are counted and reported once
  // everything reachable has landed.
  let failedCount = 0;
  for (const result of plan.available) {
    try {
      if (result.kind === "photo") {
        const blob = await photoBlob(result, options);
        if (!blob) {
          failedCount += 1;
          continue;
        }
        await saveMobileScannerPhoto({
          id: result.id,
          kind: "photo",
          photoBatchId: result.batchId,
          name: `${result.id}.jpg`,
          mimeType: result.contentType ?? blob.type ?? "image/jpeg",
          size: result.byteCount ?? blob.size,
          capturedAt: result.capturedAt,
          dataUrl: await blobToDataUrl(blob),
        }, { batchId: result.batchId });
      } else {
        if (!result.value) continue;
        await saveMobileScannerScan({
          id: result.id,
          barcode: result.value,
          format: result.format,
          kind: result.kind,
          scannedAt: result.capturedAt,
        }, { batchId: result.batchId, allowDictation: result.format === "dictation" });
      }
    } catch (_error) {
      failedCount += 1;
      continue;
    }
    origins[result.id] = { workspaceId: replica.workspaceId, batchId: result.batchId };
  }
  await chrome.storage.local.set({ [CLOUD_ORIGINS_KEY]: origins });
  if (failedCount > 0) {
    throw new Error(
      `${failedCount} cloud result${failedCount === 1 ? "" : "s"} could not be downloaded.`,
    );
  }
  return plan;
}

export async function cloudResultIds(ids: string[]) {
  const origins = await loadOrigins();
  return ids.filter((id) => origins[id] !== undefined);
}
