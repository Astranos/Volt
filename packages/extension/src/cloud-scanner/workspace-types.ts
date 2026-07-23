export type WorkspaceId = string;
export type ScannerBatchId = string;
export type ScannerResultId = string;
export type ComputerId = string;

export type CloudDeliveryState =
  | "pending"
  | "uploading"
  | "available"
  | "failed"
  | "deleted";

export type CloudScannerResult = {
  id: ScannerResultId;
  batchId: ScannerBatchId;
  workspaceId: WorkspaceId;
  kind: "barcode" | "text" | "photo";
  capturedAt: string;
  revision: number;
  deliveryState: CloudDeliveryState;
  value?: string;
  format?: string;
  objectKey?: string;
  contentType?: string;
  byteCount?: number;
};

export type CloudScannerBatch = {
  id: ScannerBatchId;
  workspaceId: WorkspaceId;
  createdAt: string;
  updatedAt: string;
  revision: number;
  deliveryState: CloudDeliveryState;
  results: CloudScannerResult[];
};

export type WorkspaceResultPage = {
  workspaceId: WorkspaceId;
  batches: CloudScannerBatch[];
  cursor?: string;
};

/**
 * Live routing is intentionally not part of a batch. Selecting a computer can
 * affect cursor insertion or dictation, but never result visibility/ownership.
 */
export type LiveTargetSelection = {
  workspaceId: WorkspaceId;
  selectedComputerId: ComputerId | null;
};

export type WorkspaceReplica = {
  workspaceId: WorkspaceId;
  batches: CloudScannerBatch[];
  cursor?: string;
  tombstones: {
    batches: Record<ScannerBatchId, number>;
    results: Record<ScannerResultId, number>;
  };
};
