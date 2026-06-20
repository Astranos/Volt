import type { ScannerConnectionStatus } from "@volt/scanner-protocol";
import type { ExtensionIdentity } from "./mobile-scanner-identity";

export type BarcodeMessage = {
  id?: string;
  barcode: string;
  dictationPhase?: "partial" | "final";
  dictationSessionId?: string;
  format?: string;
  insertIntoCursor?: boolean;
  kind?: "barcode" | "text";
  scannedAt?: string;
};

export type PhotoMessage = {
  kind: "photo";
  id: string;
  name: string;
  mimeType: string;
  dataUrl?: string;
  contributorId?: string;
  size: number;
  width?: number;
  height?: number;
  capturedAt?: string;
  photoBatchId?: string;
};

export type SessionTarget = {
  browser?: string;
  tabTitle?: string;
  url?: string;
  cursor?: string;
};

export type MobileScannerSessionState = {
  status: ScannerConnectionStatus;
  qrCodeUrl: string | null;
  error: string | null;
  connectedAt: string | null;
  connectedPeerCount: number;
  joinWindowExpiresAt: string | null;
  sessionId: string;
  target: SessionTarget | null;
  extensionIdentity: ExtensionIdentity | null;
};

export type MobileScannerSessionEvents = {
  onState: (state: MobileScannerSessionState) => void;
  onScan: (message: BarcodeMessage) => Promise<boolean | { saved: boolean; insertedIntoCursor?: boolean }> | boolean | { saved: boolean; insertedIntoCursor?: boolean };
  onPhoto: (message: PhotoMessage) => Promise<boolean> | boolean;
  onInsert?: (text: string, message: BarcodeMessage) => Promise<boolean> | boolean;
  log?: (...args: unknown[]) => void;
};
