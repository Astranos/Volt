import { useCallback, useEffect, type RefObject, type Dispatch, type SetStateAction } from "react";
import { appendPhoto, releasePhotoUrls, type PhotoCollection } from "./-scanner-demo-photo-collection";
import { decodePhotoTransferChunkFrame, decodePhotoTransferMessage, type PhotoTransferMessage, type PhotoTransferBinaryChunkMessage, type ScannerControlMessage } from "@volt/scanner-protocol";
import { type PeerSession, type PendingPhoto, createMessageId, bytesFromBase64 } from "./-scanner-demo-model";

export function usePhotoReceiver({
  pendingPhotosRef, objectUrlsRef, collection, setCollection, sendControl,
}: {
  pendingPhotosRef: RefObject<Map<string, PendingPhoto>>;
  objectUrlsRef: RefObject<Set<string>>;
  collection: PhotoCollection;
  setCollection: Dispatch<SetStateAction<PhotoCollection>>;
  sendControl: (peer: PeerSession, message: ScannerControlMessage) => void;
}) {
  useEffect(() => {
    if (collection.retiredUrls.length === 0) return;
    const released = new Set(collection.retiredUrls);
    releasePhotoUrls(collection.retiredUrls, objectUrlsRef.current, (url) => URL.revokeObjectURL(url));
    setCollection((current) => ({
      ...current,
      retiredUrls: current.retiredUrls.filter((url) => !released.has(url)),
    }));
  }, [collection.retiredUrls, objectUrlsRef, setCollection]);

  const assemblePhoto = useCallback(
    (peer: PeerSession, pending: PendingPhoto) => {
      pendingPhotosRef.current.delete(pending.photoId);
      const blob = new Blob(pending.chunks.map((chunk) => new Uint8Array(chunk)), { type: pending.mimeType });
      const objectUrl = URL.createObjectURL(blob);
      objectUrlsRef.current.add(objectUrl);
      setCollection((current) => appendPhoto(current, {
        capturedAt: pending.capturedAt,
        filename: pending.filename,
        height: pending.height,
        id: pending.photoId,
        mimeType: pending.mimeType,
        objectUrl,
        photoBatchId: pending.photoBatchId,
        size: blob.size || pending.size,
        width: pending.width,
      }));
      sendControl(peer, {
        type: "photo_received",
        messageId: createMessageId("photo"),
        sentAt: new Date().toISOString(),
        photoId: pending.photoId,
        photoBatchId: pending.photoBatchId,
        storedAt: new Date().toISOString(),
        size: Math.max(1, blob.size || pending.size),
      });
    },
    [objectUrlsRef, pendingPhotosRef, sendControl, setCollection],
  );

  const handlePhotoMessage = useCallback(
    (
      peer: PeerSession,
      message: PhotoTransferMessage | PhotoTransferBinaryChunkMessage,
    ) => {
      if (message.type === "photo_start") {
        pendingPhotosRef.current.set(message.photoId, {
          ...message,
          chunks: Array.from({ length: message.totalChunks }),
          receivedChunks: 0,
          updatedAt: Date.now(),
        });
        return;
      }
      if (message.type === "photo_cancel") {
        pendingPhotosRef.current.delete(message.photoId);
        return;
      }
      if (message.type === "photo_chunk") {
        const pending = pendingPhotosRef.current.get(message.photoId);
        if (
          !pending ||
          message.chunkIndex < 0 ||
          message.chunkIndex >= pending.totalChunks
        )
          return;
        if (!pending.chunks[message.chunkIndex]) pending.receivedChunks += 1;
        pending.chunks[message.chunkIndex] =
          typeof message.data === "string"
            ? bytesFromBase64(message.data)
            : message.data;
        pending.updatedAt = Date.now();
        sendControl(peer, {
          type: "photo_chunk_ack",
          messageId: createMessageId("photo"),
          sentAt: new Date().toISOString(),
          photoId: message.photoId,
          chunkIndex: message.chunkIndex,
          totalChunks: pending.totalChunks,
        });
        return;
      }
      if (message.type === "photo_complete") {
        const pending = pendingPhotosRef.current.get(message.photoId);
        if (!pending || pending.receivedChunks !== pending.totalChunks) return;
        assemblePhoto(peer, pending);
      }
    },
    [assemblePhoto, sendControl],
  );

  const configurePhotoChannel = useCallback(
    (peer: PeerSession, channel: RTCDataChannel) => {
      channel.binaryType = "arraybuffer";
      channel.onmessage = (event) => {
        const message =
          typeof event.data === "string"
            ? decodePhotoTransferMessage(event.data)
            : event.data instanceof ArrayBuffer
              ? decodePhotoTransferChunkFrame(event.data)
              : null;
        if (message) handlePhotoMessage(peer, message);
      };
    },
    [handlePhotoMessage],
  );

  return configurePhotoChannel;
}
