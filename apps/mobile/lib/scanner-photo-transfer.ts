import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useCallback, useRef, useState } from "react";
import {
  encodePhotoTransferMessage,
  PHOTO_TRANSFER_CHUNK_SIZE_BYTES,
  PHOTO_TRANSFER_MAX_BUFFERED_AMOUNT,
  PHOTO_TRANSFER_MAX_IN_FLIGHT_CHUNKS,
} from "@volt/scanner-protocol";
import {
  chunkPhotoBase64,
  compactPendingPhotos,
  markRetryableAfterDisconnect,
  type PendingPhoto,
} from "./photo-retry-queue";
import { createId } from "./scanner-ids";

const PENDING_PHOTOS_STORAGE_KEY = "volt.mobileScanner.pendingPhotos.v1";
const DATA_CHANNEL_BUFFER_DRAIN_MS = 16;
const PHOTO_RECEIPT_TIMEOUT_MS = 30000;

type MutableRefObject<T> = { current: T };

type PhotoTransferQueueOptions = {
  controlChannelRef: MutableRefObject<any>;
  photoChannelRef: MutableRefObject<any>;
  photoContributorIdRef: MutableRefObject<string>;
  sessionReadyRef: MutableRefObject<boolean>;
};

type PhotoTransferQueue = {
  cancelPendingPhoto: (id: string) => void;
  clearReceiptTimeouts: () => void;
  flushPhotoWorker: () => Promise<void>;
  handlePhotoChunkAck: (message: { id: string; chunkIndex: number; totalChunks?: number }) => void;
  handlePhotoReceived: (id: string) => void;
  handlePhotoRejected: (id: string, reason?: string) => void;
  loadPendingPhotos: () => Promise<void>;
  markPhotosRetryableAfterDisconnect: () => void;
  pendingPhotos: PendingPhoto[];
  pendingPhotosRef: MutableRefObject<PendingPhoto[]>;
  persistPendingPhotos: (photos: PendingPhoto[]) => void;
  photoError: string | null;
  photoProgressLabel: string | null;
  photoSending: boolean;
  photoSentAt: string | null;
  retryPendingPhotos: () => void;
  setPhotoError: (value: string | null) => void;
  setPhotoProgressLabel: (value: string | null) => void;
  updatePendingPhotos: (updater: (photos: PendingPhoto[]) => PendingPhoto[]) => void;
};

function wait(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function usePhotoTransferQueue({
  controlChannelRef,
  photoChannelRef,
  photoContributorIdRef,
  sessionReadyRef,
}: PhotoTransferQueueOptions): PhotoTransferQueue {
  const [photoSending, setPhotoSending]: [boolean, (value: boolean) => void] = useState(false);
  const [photoError, setPhotoError]: [string | null, (value: string | null) => void] = useState<string | null>(null);
  const [photoSentAt, setPhotoSentAt]: [string | null, (value: string | null) => void] = useState<string | null>(null);
  const [photoProgressLabel, setPhotoProgressLabel]: [string | null, (value: string | null) => void] = useState<string | null>(null);
  const [pendingPhotos, setPendingPhotos]: [PendingPhoto[], (value: PendingPhoto[]) => void] = useState<PendingPhoto[]>([]);

  const photoSendingWorkerRef: MutableRefObject<boolean> = useRef(false);
  const pendingPhotosRef: MutableRefObject<PendingPhoto[]> = useRef<PendingPhoto[]>([]);
  const receiptTimeoutsRef: MutableRefObject<Map<string, ReturnType<typeof setTimeout>>> = useRef(new Map());

  const persistPendingPhotos = useCallback((photos: PendingPhoto[]) => {
    const compacted = compactPendingPhotos(photos);
    pendingPhotosRef.current = compacted;
    setPendingPhotos(compacted);
    AsyncStorage.setItem(PENDING_PHOTOS_STORAGE_KEY, JSON.stringify(compacted)).catch((storageError) => {
      setPhotoError("Low storage. Delivered photos are still safe, but queued retry copies may need cleanup.");
      console.warn("Failed to persist pending photos", storageError);
    });
  }, []);

  const updatePendingPhotos = useCallback((updater: (photos: PendingPhoto[]) => PendingPhoto[]) => {
    persistPendingPhotos(updater(pendingPhotosRef.current));
  }, [persistPendingPhotos]);

  const loadPendingPhotos = useCallback(() => {
    return AsyncStorage.getItem(PENDING_PHOTOS_STORAGE_KEY)
      .then((rawValue) => {
        const parsed = rawValue ? JSON.parse(rawValue) : [];
        if (Array.isArray(parsed)) persistPendingPhotos(parsed as PendingPhoto[]);
      })
      .catch(() => persistPendingPhotos([]));
  }, [persistPendingPhotos]);

  const clearReceiptTimeouts = useCallback(() => {
    for (const timeout of receiptTimeoutsRef.current.values()) clearTimeout(timeout);
    receiptTimeoutsRef.current.clear();
  }, []);

  const flushPhotoWorker = useCallback(async () => {
    if (photoSendingWorkerRef.current) return;
    const control = controlChannelRef.current;
    const photoChannel = photoChannelRef.current ?? controlChannelRef.current;
    if (control?.readyState !== "open" || photoChannel?.readyState !== "open" || !sessionReadyRef.current) return;

    photoSendingWorkerRef.current = true;
    setPhotoSending(true);
    setPhotoError(null);
    try {
      while (controlChannelRef.current?.readyState === "open" && (photoChannelRef.current ?? controlChannelRef.current)?.readyState === "open") {
        const next = pendingPhotosRef.current.find((photo: PendingPhoto) => photo.status === "queued" || photo.status === "failed");
        if (!next) break;
        const chunks = chunkPhotoBase64(next.dataBase64);
        const totalChunks = chunks.length;
        updatePendingPhotos((photos: PendingPhoto[]) =>
          photos.map((photo: PendingPhoto) =>
            photo.id === next.id
              ? { ...photo, status: "sending", error: undefined, totalChunks, nextChunkIndex: 0, progress: 0, updatedAt: Date.now() }
              : photo
          )
        );
        setPhotoProgressLabel(`Sending 1 of ${totalChunks}`);
        photoChannel.send(encodePhotoTransferMessage({
          type: "photo_start",
          messageId: createId("photo-start"),
          sentAt: new Date().toISOString(),
          photoId: next.id,
          photoBatchId: next.batchId,
          contributorId: photoContributorIdRef.current,
          filename: next.name,
          mimeType: next.mimeType,
          size: next.size,
          width: next.width ?? 1,
          height: next.height ?? 1,
          capturedAt: next.capturedAt,
          chunkSize: PHOTO_TRANSFER_CHUNK_SIZE_BYTES,
          totalChunks,
        }));

        for (let index = 0; index < chunks.length; index += 1) {
          const current = pendingPhotosRef.current.find((photo: PendingPhoto) => photo.id === next.id);
          if (!current || current.status === "cancelled" || current.status === "received") break;
          while ((photoChannel.bufferedAmount ?? 0) > PHOTO_TRANSFER_MAX_BUFFERED_AMOUNT) {
            await wait(DATA_CHANNEL_BUFFER_DRAIN_MS);
          }
          photoChannel.send(encodePhotoTransferMessage({
            type: "photo_chunk",
            messageId: createId("photo-chunk"),
            sentAt: new Date().toISOString(),
            photoId: next.id,
            chunkIndex: index,
            totalChunks,
            data: chunks[index],
          }));
          const progress = (index + 1) / totalChunks;
          updatePendingPhotos((photos: PendingPhoto[]) =>
            photos.map((photo: PendingPhoto) =>
              photo.id === next.id
                ? { ...photo, nextChunkIndex: index + 1, progress, updatedAt: Date.now() }
                : photo
            )
          );
          setPhotoProgressLabel(`Sending ${index + 1} of ${totalChunks}`);
          if ((index + 1) % PHOTO_TRANSFER_MAX_IN_FLIGHT_CHUNKS === 0) await wait(DATA_CHANNEL_BUFFER_DRAIN_MS);
        }

        const latest = pendingPhotosRef.current.find((photo: PendingPhoto) => photo.id === next.id);
        if (!latest || latest.status === "cancelled" || latest.status === "received") continue;
        photoChannel.send(encodePhotoTransferMessage({
          type: "photo_complete",
          messageId: createId("photo-complete"),
          sentAt: new Date().toISOString(),
          photoId: next.id,
          totalChunks,
        }));
        updatePendingPhotos((photos: PendingPhoto[]) =>
          photos.map((photo: PendingPhoto) =>
            photo.id === next.id
              ? { ...photo, status: "sent", progress: 1, updatedAt: Date.now() }
              : photo
          )
        );
        const receiptTimeout = setTimeout(() => {
          updatePendingPhotos((photos: PendingPhoto[]) =>
            photos.map((photo: PendingPhoto) =>
              photo.id === next.id && photo.status === "sent"
                ? { ...photo, status: "failed", error: "Waiting for Chrome receipt. Will retry when connected.", updatedAt: Date.now() }
                : photo
            )
          );
        }, PHOTO_RECEIPT_TIMEOUT_MS);
        receiptTimeoutsRef.current.set(next.id, receiptTimeout);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Photo transfer paused.";
      setPhotoError(message);
      updatePendingPhotos((photos: PendingPhoto[]) =>
        photos.map((photo: PendingPhoto) =>
          photo.status === "sending" || photo.status === "sent"
            ? { ...photo, status: "failed", error: message, updatedAt: Date.now() }
            : photo
        )
      );
    } finally {
      photoSendingWorkerRef.current = false;
      setPhotoSending(false);
      setPhotoProgressLabel(null);
    }
  }, [controlChannelRef, photoChannelRef, photoContributorIdRef, sessionReadyRef, updatePendingPhotos]);

  const handlePhotoChunkAck = useCallback((message: { id: string; chunkIndex: number; totalChunks?: number }) => {
    updatePendingPhotos((photos: PendingPhoto[]) =>
      photos.map((photo: PendingPhoto) => {
        const totalChunks = message.totalChunks ?? photo.totalChunks;
        return photo.id === message.id && totalChunks
          ? { ...photo, totalChunks, progress: Math.max(photo.progress, (message.chunkIndex + 1) / totalChunks), updatedAt: Date.now() }
          : photo;
      })
    );
  }, [updatePendingPhotos]);

  const handlePhotoReceived = useCallback((id: string) => {
    const timeout = receiptTimeoutsRef.current.get(id);
    if (timeout) clearTimeout(timeout);
    receiptTimeoutsRef.current.delete(id);
    updatePendingPhotos((photos: PendingPhoto[]) => photos.filter((photo: PendingPhoto) => photo.id !== id));
    setPhotoSentAt(new Date().toISOString());
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [updatePendingPhotos]);

  const handlePhotoRejected = useCallback((id: string, reason?: string) => {
    const message = reason || "Chrome storage is full. Free space, then retry.";
    updatePendingPhotos((photos: PendingPhoto[]) =>
      photos.map((photo: PendingPhoto) =>
        photo.id === id
          ? { ...photo, status: "failed", error: message, updatedAt: Date.now() }
          : photo
      )
    );
    setPhotoError(message);
  }, [updatePendingPhotos]);

  const markPhotosRetryableAfterDisconnect = useCallback(() => {
    updatePendingPhotos((photos: PendingPhoto[]) =>
      photos.map((photo: PendingPhoto) => markRetryableAfterDisconnect(photo))
    );
  }, [updatePendingPhotos]);

  const cancelPendingPhoto = useCallback((id: string) => {
    const photoChannel = photoChannelRef.current;
    if (photoChannel?.readyState === "open") {
      photoChannel.send(encodePhotoTransferMessage({
        type: "photo_cancel",
        messageId: createId("photo-cancel"),
        sentAt: new Date().toISOString(),
        photoId: id,
        reason: "user_cancelled",
      }));
    }
    updatePendingPhotos((photos: PendingPhoto[]) => photos.filter((photo: PendingPhoto) => photo.id !== id));
  }, [photoChannelRef, updatePendingPhotos]);

  const retryPendingPhotos = useCallback(() => {
    updatePendingPhotos((photos: PendingPhoto[]) =>
      photos.map((photo: PendingPhoto) =>
        photo.status === "failed" || photo.status === "sent"
          ? { ...photo, status: "queued", error: undefined, progress: 0, nextChunkIndex: 0, updatedAt: Date.now() }
          : photo
      )
    );
    void flushPhotoWorker();
  }, [flushPhotoWorker, updatePendingPhotos]);

  return {
    cancelPendingPhoto,
    clearReceiptTimeouts,
    flushPhotoWorker,
    handlePhotoChunkAck,
    handlePhotoReceived,
    handlePhotoRejected,
    loadPendingPhotos,
    markPhotosRetryableAfterDisconnect,
    pendingPhotos,
    pendingPhotosRef,
    persistPendingPhotos,
    photoError,
    photoProgressLabel,
    photoSending,
    photoSentAt,
    retryPendingPhotos,
    setPhotoError,
    setPhotoProgressLabel,
    updatePendingPhotos,
  };
}
