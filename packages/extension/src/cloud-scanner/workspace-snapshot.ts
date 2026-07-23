import type {
  CloudDeliveryState,
  CloudScannerBatch,
  CloudScannerResult,
  WorkspaceResultPage,
} from "./workspace-types.ts";

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringFrom(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function timestampRevision(value: string) {
  const revision = Date.parse(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function deliveryState(value: unknown): CloudDeliveryState | null {
  return value === "ready" || value === "available"
    ? "available"
    : value === "uploading" || value === "pending" || value === "failed" || value === "deleted"
      ? value
      : null;
}

function normalizeResult(
  value: unknown,
  workspaceId: string,
  batchId: string,
  batchRevision: number,
): CloudScannerResult | null {
  const record = recordFrom(value);
  if (!record) return null;
  const id = stringFrom(record, "id");
  const createdAt = stringFrom(record, "createdAt");
  const type = record.type;
  const state = deliveryState(record.deliveryState ?? "available");
  if (!id || !createdAt || (type !== "text" && type !== "barcode" && type !== "photo" && type !== "dictation")) {
    return null;
  }
  if (!state) return null;
  return {
    id,
    batchId,
    workspaceId,
    kind: type === "photo" ? "photo" : type === "barcode" ? "barcode" : "text",
    capturedAt: createdAt,
    revision: Math.max(batchRevision, timestampRevision(createdAt)),
    deliveryState: state,
    value: stringFrom(record, "value") ?? undefined,
    format: stringFrom(record, "format") ?? (type === "dictation" ? "dictation" : undefined),
    objectKey: stringFrom(record, "photoObjectKey") ?? undefined,
    contentType: stringFrom(record, "contentType") ?? undefined,
    byteCount:
      typeof record.byteCount === "number" && Number.isFinite(record.byteCount)
        ? Math.max(0, Math.floor(record.byteCount))
        : undefined,
  };
}

function normalizeBatch(value: unknown, workspaceId: string): CloudScannerBatch | null {
  const record = recordFrom(value);
  if (!record) return null;
  const id = stringFrom(record, "id");
  const createdAt = stringFrom(record, "createdAt");
  const updatedAt = stringFrom(record, "updatedAt");
  const state = deliveryState(record.deliveryState);
  if (!id || !createdAt || !updatedAt || !state) return null;
  const revision = timestampRevision(updatedAt);
  const results = Array.isArray(record.results)
    ? record.results
        .map((result) => normalizeResult(result, workspaceId, id, revision))
        .filter((result): result is CloudScannerResult => result !== null)
    : [];
  return { id, workspaceId, createdAt, updatedAt, revision, deliveryState: state, results };
}

export function normalizeWorkspaceSnapshot(value: unknown): WorkspaceResultPage | null {
  const record = recordFrom(value);
  if (!record || !Array.isArray(record.batches)) return null;
  const workspaceId = stringFrom(record, "workspaceId");
  if (!workspaceId) return null;
  const batches = record.batches
    .map((batch) => normalizeBatch(batch, workspaceId))
    .filter((batch): batch is CloudScannerBatch => batch !== null);
  const revision = record.revision;
  return {
    workspaceId,
    batches,
    cursor:
      (typeof revision === "number" && Number.isFinite(revision)) || typeof revision === "string"
        ? String(revision)
        : undefined,
  };
}
