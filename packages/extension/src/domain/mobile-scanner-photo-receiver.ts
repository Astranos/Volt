import {
  decodePhotoTransferChunkFrame,
  decodePhotoTransferMessage,
  type PhotoTransferBinaryChunkMessage,
  type PhotoTransferMessage,
  type PhotoTransferStartMessage,
  type ScannerControlMessage,
} from "../../../scanner-protocol/src";
import { createMessageId } from "./mobile-scanner-ids";
import type { PeerSession } from "./mobile-scanner-peer-connection";
import type { PhotoMessage } from "./mobile-scanner-session-types";

type PendingPhoto = PhotoTransferStartMessage & {
  chunks: string[];
  receivedChunks: number;
  updatedAt: number;
};

export type PhotoReceiverEvents = {
  onPhoto: (message: PhotoMessage) => Promise<boolean> | boolean;
  sendControl: (peer: PeerSession, message: ScannerControlMessage) => void;
};

export class MobileScannerPhotoReceiver {
  private pendingPhotos = new Map<string, PendingPhoto>();

  constructor(private readonly events: PhotoReceiverEvents) {}

  clear() {
    this.pendingPhotos.clear();
  }

  async handlePhotoTransferMessage(peer: PeerSession, data: unknown) {
    if (typeof data === "string") {
      const message = decodePhotoTransferMessage(data);
      if (message) await this.handlePhotoTransferProtocolMessage(peer, message);
      return;
    }
    if (data instanceof ArrayBuffer) {
      const message = decodePhotoTransferChunkFrame(data);
      if (message) await this.handlePhotoTransferProtocolMessage(peer, message);
    }
  }

  private async handlePhotoTransferProtocolMessage(
    peer: PeerSession,
    data: PhotoTransferMessage | PhotoTransferBinaryChunkMessage,
  ) {
    if (data.type === "photo_start") {
      this.cleanupStalePhotos();
      this.pendingPhotos.set(data.photoId, {
        ...data,
        chunks: Array.from({ length: data.totalChunks }),
        receivedChunks: 0,
        updatedAt: Date.now(),
      });
      return;
    }

    if (data.type === "photo_chunk") {
      const pending = this.pendingPhotos.get(data.photoId);
      if (!pending || data.chunkIndex < 0 || data.chunkIndex >= pending.totalChunks) return;
      if (!pending.chunks[data.chunkIndex]) pending.receivedChunks += 1;
      pending.chunks[data.chunkIndex] =
        typeof data.data === "string"
          ? data.data
          : btoa(String.fromCharCode(...data.data));
      pending.updatedAt = Date.now();
      this.events.sendControl(peer, {
        type: "photo_chunk_ack",
        messageId: createMessageId("control"),
        sentAt: new Date().toISOString(),
        photoId: data.photoId,
        chunkIndex: data.chunkIndex,
        totalChunks: pending.totalChunks,
      });
      return;
    }

    if (data.type === "photo_complete") {
      const pending = this.pendingPhotos.get(data.photoId);
      if (!pending || pending.receivedChunks !== pending.totalChunks) return;
      this.pendingPhotos.delete(data.photoId);
      const stored = await this.events.onPhoto({
        kind: "photo",
        id: pending.photoId,
        name: pending.filename,
        mimeType: pending.mimeType,
        size: pending.size,
        width: pending.width,
        height: pending.height,
        capturedAt: pending.capturedAt,
        contributorId: pending.contributorId,
        dataUrl: `data:${pending.mimeType};base64,${pending.chunks.join("")}`,
        photoBatchId: pending.photoBatchId,
      } as PhotoMessage & { photoBatchId: string });
      if (stored) this.sendPhotoReceived(peer, pending.photoId, pending.photoBatchId, pending.size);
      return;
    }

    if (data.type === "photo_cancel") {
      this.pendingPhotos.delete(data.photoId);
    }
  }

  private sendPhotoReceived(peer: PeerSession, photoId: string, photoBatchId = "default", size = 1) {
    this.events.sendControl(peer, {
      type: "photo_received",
      messageId: createMessageId("control"),
      sentAt: new Date().toISOString(),
      photoId,
      photoBatchId,
      storedAt: new Date().toISOString(),
      size: Math.max(1, size),
    });
  }

  private cleanupStalePhotos() {
    const staleBefore = Date.now() - 2 * 60 * 1000;
    for (const [id, pending] of this.pendingPhotos) {
      if (pending.updatedAt < staleBefore) this.pendingPhotos.delete(id);
    }
  }
}
