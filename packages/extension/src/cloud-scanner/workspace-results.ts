import type {
  CloudDeliveryState,
  CloudScannerBatch,
  CloudScannerResult,
  WorkspaceReplica,
  WorkspaceResultPage,
} from "./workspace-types.ts";

const DELIVERY_STATES = new Set<CloudDeliveryState>([
  "pending",
  "uploading",
  "available",
  "failed",
  "deleted",
]);

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function revisionFrom(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function deliveryStateFrom(value: unknown): CloudDeliveryState | null {
  return typeof value === "string" && DELIVERY_STATES.has(value as CloudDeliveryState)
    ? (value as CloudDeliveryState)
    : null;
}

export function parseCloudScannerResult(value: unknown): CloudScannerResult | null {
  const record = recordFrom(value);
  if (!record) return null;
  const id = requiredString(record, "id");
  const batchId = requiredString(record, "batchId");
  const workspaceId = requiredString(record, "workspaceId");
  const capturedAt = requiredString(record, "capturedAt");
  const revision = revisionFrom(record.revision);
  const deliveryState = deliveryStateFrom(record.deliveryState);
  const kind = record.kind;
  if (
    !id ||
    !batchId ||
    !workspaceId ||
    !capturedAt ||
    revision === null ||
    !deliveryState ||
    (kind !== "barcode" && kind !== "text" && kind !== "photo")
  ) return null;

  return {
    id,
    batchId,
    workspaceId,
    kind,
    capturedAt,
    revision,
    deliveryState,
    value: optionalString(record.value),
    format: optionalString(record.format),
    objectKey: optionalString(record.objectKey),
    contentType: optionalString(record.contentType),
    byteCount:
      typeof record.byteCount === "number" && Number.isFinite(record.byteCount)
        ? Math.max(0, Math.floor(record.byteCount))
        : undefined,
  };
}

export function parseCloudScannerBatch(value: unknown): CloudScannerBatch | null {
  const record = recordFrom(value);
  if (!record) return null;
  const id = requiredString(record, "id");
  const workspaceId = requiredString(record, "workspaceId");
  const createdAt = requiredString(record, "createdAt");
  const updatedAt = requiredString(record, "updatedAt");
  const revision = revisionFrom(record.revision);
  const deliveryState = deliveryStateFrom(record.deliveryState);
  if (!id || !workspaceId || !createdAt || !updatedAt || revision === null || !deliveryState) {
    return null;
  }
  const results = Array.isArray(record.results)
    ? record.results.map(parseCloudScannerResult).filter((item): item is CloudScannerResult => item !== null)
    : [];
  if (results.some((result) => result.workspaceId !== workspaceId || result.batchId !== id)) {
    return null;
  }
  return { id, workspaceId, createdAt, updatedAt, revision, deliveryState, results };
}

export function parseWorkspaceResultPage(value: unknown): WorkspaceResultPage | null {
  const record = recordFrom(value);
  if (!record) return null;
  const workspaceId = requiredString(record, "workspaceId");
  if (!workspaceId || !Array.isArray(record.batches)) return null;
  const batches = record.batches
    .map(parseCloudScannerBatch)
    .filter((item): item is CloudScannerBatch => item !== null);
  if (batches.some((batch) => batch.workspaceId !== workspaceId)) return null;
  return { workspaceId, batches, cursor: optionalString(record.cursor) };
}

function mergeResults(
  current: CloudScannerResult[],
  incoming: CloudScannerResult[],
  tombstones: Record<string, number>,
) {
  const byId = new Map(current.map((result) => [result.id, result]));
  for (const result of incoming) {
    const deletedRevision = tombstones[result.id];
    if (deletedRevision !== undefined && result.revision <= deletedRevision) continue;
    if (result.deliveryState === "deleted") {
      byId.delete(result.id);
      tombstones[result.id] = result.revision;
      continue;
    }
    const previous = byId.get(result.id);
    if (!previous || result.revision >= previous.revision) {
      byId.set(result.id, result);
      if (deletedRevision !== undefined) delete tombstones[result.id];
    }
  }
  return [...byId.values()]
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
}

export function mergeWorkspaceReplica(
  current: WorkspaceReplica | null,
  page: WorkspaceResultPage,
): WorkspaceReplica {
  if (current && current.workspaceId !== page.workspaceId) {
    throw new Error("workspace_mismatch");
  }
  const tombstones = {
    batches: { ...(current?.tombstones?.batches ?? {}) },
    results: { ...(current?.tombstones?.results ?? {}) },
  };
  const byId = new Map((current?.batches ?? []).map((batch) => [batch.id, batch]));
  for (const batch of page.batches) {
    const deletedRevision = tombstones.batches[batch.id];
    if (deletedRevision !== undefined && batch.revision <= deletedRevision) continue;
    if (batch.deliveryState === "deleted") {
      byId.delete(batch.id);
      tombstones.batches[batch.id] = batch.revision;
      continue;
    }
    const previous = byId.get(batch.id);
    if (!previous || batch.revision > previous.revision) {
      byId.set(batch.id, {
        ...batch,
        results: mergeResults(previous?.results ?? [], batch.results, tombstones.results),
      });
      if (deletedRevision !== undefined) delete tombstones.batches[batch.id];
    } else if (batch.revision === previous.revision) {
      byId.set(batch.id, {
        ...previous,
        results: mergeResults(previous.results, batch.results, tombstones.results),
      });
    }
  }
  return {
    workspaceId: page.workspaceId,
    batches: [...byId.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    cursor: page.cursor ?? current?.cursor,
    tombstones,
  };
}
