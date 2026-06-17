import { decode as base64Decode, encode as base64Encode } from "base-64";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCameraPermissions, type BarcodeScanningResult } from "./expo-camera";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import type { ImagePickerAsset } from "expo-image-picker";
import * as Linking from "expo-linking";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { Alert, AppState, Platform } from "react-native";
import {
  encodeScannerControlMessage,
  encodePhotoTransferMessage,
  PHOTO_BATCH_WINDOW_MS,
  PHOTO_TRANSFER_BUFFERED_AMOUNT_LOW_THRESHOLD,
  PHOTO_TRANSFER_CHUNK_SIZE_BYTES,
  PHOTO_TRANSFER_MAX_BUFFERED_AMOUNT,
  PHOTO_TRANSFER_MAX_IN_FLIGHT_CHUNKS,
  PHOTO_TRANSFER_CHANNEL_LABEL,
  SCANNER_CONTROL_CHANNEL_LABEL,
  SCANNER_SCAN_COOLDOWN_MS,
  type CaptureMode,
  type ScannerControlMessage,
} from "@volt/scanner-protocol";
import { makeBarcodeMessage, makeCaptureMessage, makeOcrMessage, type ScanItem } from "./scanner-messages";
import { cropActionForVisibleFrame, type PhotoCropFrame } from "./photo-crop";
import {
  buildMobileHelloMessage,
  createJoinAttempt,
  createPeerConnectionAnswer,
  isProtocolMajorCompatible,
  normalizeScannerControlMessage,
  parseMobileWebRtcPairingUrl,
  pollJoinOffer,
  postPairingAnswer,
  type NormalizedScannerControlMessage,
} from "./scanner-pairing-session";
import {
  chunkPhotoBase64,
  compactPendingPhotos,
  markRetryableAfterDisconnect,
  pendingPhotoSummaries,
  type PendingPhoto,
  type PendingPhotoSummary,
} from "./photo-retry-queue";

export type { PendingPhotoSummary };

globalThis.atob ??= base64Decode;
globalThis.btoa ??= base64Encode;

type ConnectionStatus = "idle" | "pairing" | "session_ready" | "disconnected" | "error";
type ScannerMode = CaptureMode;
type ChannelStatus = "idle" | "opening" | "open";
type LegacyControlMessage = { kind: string; [key: string]: unknown };

const SETTINGS_STORAGE_KEY = "volt.mobileScanner.settings.v1";
const PAIRING_SESSION_STORAGE_KEY = "volt.mobileScanner.pairingSession.v2";
const PENDING_PHOTOS_STORAGE_KEY = "volt.mobileScanner.pendingPhotos.v1";
const MULTI_SCAN_WINDOW_MS = 650;
const CLIPBOARD_POLL_MS = 900;
const OCR_CAPTURE_MAX_DIMENSION = 1800;
const PHOTO_CONTRIBUTOR_KEY = "volt-photo-contributor";
const PHOTO_LONG_EDGE = 2200;
const PHOTO_QUEUE_LOW_STORAGE_BYTES = 35 * 1024 * 1024;
const REPEAT_SCAN_COOLDOWN_MS = Math.max(SCANNER_SCAN_COOLDOWN_MS, 1500);
const DATA_CHANNEL_BUFFER_DRAIN_MS = 16;

export type ScannerSettings = {
  autoSendSingleBarcode: boolean;
  confirmMultipleBarcodes: boolean;
  dictationPunctuation: boolean;
  ocrInsertIntoCursor: boolean;
  scannerInsertIntoCursor: boolean;
};

type TextCapture = {
  photoUri: string;
};

type TextCaptureResult = {
  text: string;
  target: string;
  sentAt: string;
};

const defaultSettings: ScannerSettings = {
  autoSendSingleBarcode: true,
  confirmMultipleBarcodes: true,
  dictationPunctuation: true,
  ocrInsertIntoCursor: false,
  scannerInsertIntoCursor: true,
};

export const barcodeTypes = [
  "aztec",
  "codabar",
  "code128",
  "code39",
  "code93",
  "datamatrix",
  "ean13",
  "ean8",
  "itf14",
  "pdf417",
  "qr",
  "upc_a",
  "upc_e",
] as const;

type ScannerState = {
  activeMode: ScannerMode;
  cameraRef: React.MutableRefObject<any>;
  cameraZoom: number;
  cancelPendingPhoto: (id: string) => void;
  captureText: () => Promise<void>;
  captureZoom: number;
  clearCameraFocus: () => void;
  clearTextCapture: () => void;
  connected: boolean;
  dictating: boolean;
  dictationStarting: boolean;
  dictationError: string | null;
  dictationTranscript: string;
  focusMode: "on" | "off";
  focusPoint: { x: number; y: number } | null;
  hasManualText: boolean;
  manualText: string;
  onBarcodeScanned: (result: BarcodeScanningResult) => void;
  pairFromUrl: (url: string) => Promise<boolean>;
  pendingPhotos: PendingPhotoSummary[];
  permission: ReturnType<typeof useCameraPermissions>[0];
  photoError: string | null;
  photoProgressLabel: string | null;
  photoSentAt: string | null;
  photoSending: boolean;
  prepareDictation: () => Promise<void>;
  recognizingText: boolean;
  requestPermission: ReturnType<typeof useCameraPermissions>[1];
  retryPendingPhotos: () => void;
  scans: ScanItem[];
  sendBarcodeScanResult: (result: BarcodeScanningResult) => Promise<void>;
  sendPhotoCapture: (cropFrame?: PhotoCropFrame | null) => Promise<void>;
  sendPhotoLibraryAssets: (assets: ImagePickerAsset[]) => Promise<number>;
  sendManualText: () => void;
  sendTextCapture: (text: string) => Promise<void>;
  setActiveMode: React.Dispatch<React.SetStateAction<ScannerMode>>;
  setCameraZoom: React.Dispatch<React.SetStateAction<number>>;
  setCaptureZoom: React.Dispatch<React.SetStateAction<number>>;
  setFocusMode: React.Dispatch<React.SetStateAction<"on" | "off">>;
  setFocusPoint: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  setManualText: (value: string) => void;
  setSetting: <Key extends keyof ScannerSettings>(key: Key, value: ScannerSettings[Key]) => void;
  startDictation: () => Promise<void>;
  settings: ScannerSettings;
  setTorch: React.Dispatch<React.SetStateAction<boolean>>;
  status: ConnectionStatus;
  statusHint: string;
  statusLabel: string;
  stopDictation: () => void;
  textCapture: TextCapture | null;
  textCaptureResult: TextCaptureResult | null;
  torch: boolean;
};

const ScannerContext = createContext<ScannerState | null>(null);

function wait(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createPhotoContributorId() {
  return `${PHOTO_CONTRIBUTOR_KEY}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function jpegUploadName(name: string | null | undefined, capturedAt: string, fallbackId: string) {
  const baseName = name?.trim()
    ? name.trim().replace(/\.[a-z0-9]+$/i, "")
    : `volt-upload-${capturedAt.replace(/[:.]/g, "-")}-${fallbackId.slice(-6)}`;
  return `${baseName}.jpg`;
}

function scannerMessageMode(item: ScanItem): ScannerMode {
  if (item.kind === "barcode") return "barcode";
  if (item.format === "dictation") return "dictation";
  return "ocr";
}

function getOcrResizeAction(photo: { width?: number; height?: number }) {
  const { height, width } = photo;
  if (!width || !height) return null;
  const maxDimension = Math.max(width, height);
  if (maxDimension <= OCR_CAPTURE_MAX_DIMENSION) return null;
  const scale = OCR_CAPTURE_MAX_DIMENSION / maxDimension;
  return { resize: { height: Math.round(height * scale), width: Math.round(width * scale) } };
}

function getPhotoResizeAction(photo: { width?: number; height?: number }) {
  const { height, width } = photo;
  if (!width || !height) return null;
  const maxDimension = Math.max(width, height);
  if (maxDimension <= PHOTO_LONG_EDGE) return null;
  const scale = PHOTO_LONG_EDGE / maxDimension;
  return { resize: { height: Math.round(height * scale), width: Math.round(width * scale) } };
}

export function ScannerProvider({ children }: PropsWithChildren) {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<ScannerMode>("ocr");
  const [manualText, setManualText] = useState("");
  const [cameraZoom, setCameraZoom] = useState(0);
  const [captureZoom, setCaptureZoom] = useState(1);
  const [focusMode, setFocusMode] = useState<"on" | "off">("off");
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [scans, setScans] = useState<ScanItem[]>([]);
  const [torch, setTorch] = useState(false);
  const [recognizingText, setRecognizingText] = useState(false);
  const [textCapture, setTextCapture] = useState<TextCapture | null>(null);
  const [textCaptureResult, setTextCaptureResult] = useState<TextCaptureResult | null>(null);
  const [dictating, setDictating] = useState(false);
  const [dictationStarting, setDictationStarting] = useState(false);
  const [dictationTranscript, setDictationTranscript] = useState("");
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [photoSending, setPhotoSending] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoSentAt, setPhotoSentAt] = useState<string | null>(null);
  const [photoProgressLabel, setPhotoProgressLabel] = useState<string | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [settings, setSettings] = useState<ScannerSettings>(defaultSettings);
  const [targetHint, setTargetHint] = useState<string | null>(null);

  const peerRef = useRef<any>(null);
  const controlChannelRef = useRef<any>(null);
  const photoChannelRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const controlStatusRef = useRef<ChannelStatus>("idle");
  const photoStatusRef = useRef<ChannelStatus>("idle");
  const sessionReadyRef = useRef(false);
  const pairingSessionRef = useRef<string | null>(null);
  const lastOfferRef = useRef<string | null>(null);
  const reconnectingRef = useRef(false);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const lastSentScanRef = useRef<{ key: string; at: number } | null>(null);
  const pendingScannerItemsRef = useRef<ScanItem[]>([]);
  const scannerFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsRef = useRef(defaultSettings);
  const lastDictationRef = useRef("");
  const lastDictationPartialRef = useRef("");
  const dictationSessionIdRef = useRef<string | null>(null);
  const dictationTranscriptRef = useRef("");
  const dictationPermissionGrantedRef = useRef(false);
  const dictationRequestedRef = useRef(false);
  const dictationStopRequestedRef = useRef(false);
  const lastTextCaptureClipboardRef = useRef<string | null>(null);
  const photoContributorIdRef = useRef(createPhotoContributorId());
  const activePhotoBatchRef = useRef<{ id: string; expiresAt: number } | null>(null);
  const photoSendingWorkerRef = useRef(false);
  const pendingPhotosRef = useRef<PendingPhoto[]>([]);
  const promptedPendingSessionRef = useRef<string | null>(null);
  const receiptTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const connected = status === "session_ready" && controlChannelRef.current?.readyState === "open";

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

  const sendControl = useCallback((message: ScannerControlMessage | LegacyControlMessage) => {
    const channel = controlChannelRef.current;
    if (channel?.readyState !== "open") return false;
    if ("type" in message && !("kind" in message)) {
      channel.send(encodeScannerControlMessage(message as ScannerControlMessage));
      return true;
    }
    if ("kind" in message) {
      const envelope: Record<string, unknown> = { ...message, type: message.kind };
      if (message.kind === "capture_result") {
        envelope.payload = message.message;
        envelope.messageId = message.id;
      }
      if ("id" in message && typeof message.id === "string") {
        envelope.photoId = message.id;
      }
      channel.send(JSON.stringify(envelope));
      return true;
    }
    return false;
  }, []);

  const closeConnection = useCallback(() => {
    for (const timeout of receiptTimeoutsRef.current.values()) clearTimeout(timeout);
    receiptTimeoutsRef.current.clear();
    controlChannelRef.current?.close();
    photoChannelRef.current?.close();
    peerRef.current?.close();
    controlChannelRef.current = null;
    photoChannelRef.current = null;
    peerRef.current = null;
    controlStatusRef.current = "idle";
    photoStatusRef.current = "idle";
    sessionReadyRef.current = false;
  }, []);

  const clearStoredPairingSession = useCallback(() => {
    pairingSessionRef.current = null;
    void AsyncStorage.removeItem(PAIRING_SESSION_STORAGE_KEY);
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
        const next = pendingPhotosRef.current.find((photo) => photo.status === "queued" || photo.status === "failed");
        if (!next) break;
        const chunks = chunkPhotoBase64(next.dataBase64);
        const totalChunks = chunks.length;
        updatePendingPhotos((photos) =>
          photos.map((photo) =>
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
          const current = pendingPhotosRef.current.find((photo) => photo.id === next.id);
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
          updatePendingPhotos((photos) =>
            photos.map((photo) =>
              photo.id === next.id
                ? { ...photo, nextChunkIndex: index + 1, progress, updatedAt: Date.now() }
                : photo
            )
          );
          setPhotoProgressLabel(`Sending ${index + 1} of ${totalChunks}`);
          if ((index + 1) % PHOTO_TRANSFER_MAX_IN_FLIGHT_CHUNKS === 0) await wait(DATA_CHANNEL_BUFFER_DRAIN_MS);
        }

        const latest = pendingPhotosRef.current.find((photo) => photo.id === next.id);
        if (!latest || latest.status === "cancelled" || latest.status === "received") continue;
        photoChannel.send(encodePhotoTransferMessage({
          type: "photo_complete",
          messageId: createId("photo-complete"),
          sentAt: new Date().toISOString(),
          photoId: next.id,
          totalChunks,
        }));
        updatePendingPhotos((photos) =>
          photos.map((photo) =>
            photo.id === next.id
              ? { ...photo, status: "sent", progress: 1, updatedAt: Date.now() }
              : photo
          )
        );
        const receiptTimeout = setTimeout(() => {
          updatePendingPhotos((photos) =>
            photos.map((photo) =>
              photo.id === next.id && photo.status === "sent"
                ? { ...photo, status: "failed", error: "Waiting for Chrome receipt. Will retry when connected.", updatedAt: Date.now() }
                : photo
            )
          );
        }, 30000);
        receiptTimeoutsRef.current.set(next.id, receiptTimeout);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Photo transfer paused.";
      setPhotoError(message);
      updatePendingPhotos((photos) =>
        photos.map((photo) =>
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
  }, [sendControl, updatePendingPhotos]);

  const promptForPendingPhotos = useCallback((sessionId: string | null) => {
    if (!sessionId || promptedPendingSessionRef.current === sessionId) return;
    const retryable = pendingPhotosRef.current.filter((photo) => photo.status === "queued" || photo.status === "failed" || photo.status === "sent");
    if (!retryable.length) return;
    promptedPendingSessionRef.current = sessionId;
    Alert.alert(
      "Send pending photos?",
      `Send ${retryable.length} pending photo${retryable.length === 1 ? "" : "s"} to this Chrome session?`,
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Send",
          onPress: () => {
            updatePendingPhotos((photos) =>
              photos.map((photo) =>
                retryable.some((pending) => pending.id === photo.id)
                  ? { ...photo, status: "queued", error: undefined, updatedAt: Date.now() }
                  : photo
              )
            );
            void flushPhotoWorker();
          },
        },
      ]
    );
  }, [flushPhotoWorker, updatePendingPhotos]);

  const handleControlMessage = useCallback((message: NormalizedScannerControlMessage | null) => {
    if (!message) return;
    if (message.kind === "hello") {
      if (!isProtocolMajorCompatible(message.protocolMajor)) {
        sendControl({ kind: "protocol_error", message: "Unsupported scanner protocol version." });
        setStatus("error");
        setError("Chrome extension protocol is incompatible. Update Volt on both devices.");
        closeConnection();
        return;
      }
      return;
    }
    if (message.kind === "session_ready") {
      sessionReadyRef.current = true;
      setStatus("session_ready");
      setError(null);
      setTargetHint(message.sessionLabel || message.target?.tabTitle || message.target?.cursor || message.target?.browser || null);
      promptForPendingPhotos(message.chromeSessionId ?? pairingSessionRef.current);
      void flushPhotoWorker();
      return;
    }
    if (message.kind === "receipt") {
      setTargetHint(message.target?.tabTitle || message.target?.cursor || null);
      return;
    }
    if (message.kind === "photo_chunk_ack") {
      updatePendingPhotos((photos) =>
        photos.map((photo) => {
          const totalChunks = message.totalChunks ?? photo.totalChunks;
          return photo.id === message.id && totalChunks
            ? { ...photo, totalChunks, progress: Math.max(photo.progress, (message.chunkIndex + 1) / totalChunks), updatedAt: Date.now() }
            : photo;
        })
      );
      return;
    }
    if (message.kind === "photo_received") {
      const timeout = receiptTimeoutsRef.current.get(message.id);
      if (timeout) clearTimeout(timeout);
      receiptTimeoutsRef.current.delete(message.id);
      updatePendingPhotos((photos) => photos.filter((photo) => photo.id !== message.id));
      setPhotoSentAt(new Date().toISOString());
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    if (message.kind === "photo_rejected") {
      updatePendingPhotos((photos) =>
        photos.map((photo) =>
          photo.id === message.id
            ? { ...photo, status: "failed", error: message.reason || "Chrome storage is full. Free space, then retry.", updatedAt: Date.now() }
            : photo
        )
      );
      setPhotoError(message.reason || "Chrome storage is full. Free space, then retry.");
    }
  }, [closeConnection, flushPhotoWorker, promptForPendingPhotos, sendControl, updatePendingPhotos]);

  const attachDataChannel = useCallback((channel: any) => {
    if (!channel) return;
    const label = channel.label;
    if (label === PHOTO_TRANSFER_CHANNEL_LABEL) {
      photoChannelRef.current = channel;
      photoStatusRef.current = channel.readyState === "open" ? "open" : "opening";
      channel.binaryType = "arraybuffer";
      channel.bufferedAmountLowThreshold = PHOTO_TRANSFER_BUFFERED_AMOUNT_LOW_THRESHOLD;
      let photoOpened = false;
      const handlePhotoOpen = () => {
        if (photoOpened) return;
        photoOpened = true;
        photoStatusRef.current = "open";
        void flushPhotoWorker();
      };
      channel.onopen = handlePhotoOpen;
      channel.onclose = () => {
        photoStatusRef.current = "idle";
      };
      if (channel.readyState === "open") handlePhotoOpen();
      return;
    }

    controlChannelRef.current = channel;
    controlStatusRef.current = channel.readyState === "open" ? "open" : "opening";
    let controlOpened = false;
    const handleControlOpen = () => {
      if (controlOpened) return;
      controlOpened = true;
      controlStatusRef.current = "open";
      sendControl(buildMobileHelloMessage(photoContributorIdRef.current));
    };
    channel.onopen = handleControlOpen;
    channel.onmessage = (event: { data: unknown }) => handleControlMessage(normalizeScannerControlMessage(event.data));
    channel.onclose = () => {
      controlStatusRef.current = "idle";
      sessionReadyRef.current = false;
      setStatus("disconnected");
      updatePendingPhotos((photos) =>
        photos.map((photo) => markRetryableAfterDisconnect(photo))
      );
    };
    channel.onerror = () => {
      setStatus("error");
      setError("Connection lost");
    };
    if (channel.readyState === "open") handleControlOpen();
  }, [flushPhotoWorker, handleControlMessage, promptForPendingPhotos, sendControl, updatePendingPhotos]);

  const pairWithOffer = useCallback(async (offerCode: string, answerUrl: string, sessionId?: string) => {
    closeConnection();
    setStatus("pairing");
    setError(null);
    try {
      lastOfferRef.current = offerCode;
      const { pc, answer } = await createPeerConnectionAnswer({
        offerCode,
        attachDataChannel,
        onConnectionStateChange: (connectionState) => {
          if (connectionState === "failed") {
            setStatus("error");
            setError("Connection failed. Make sure both devices are on the same network.");
          } else if (connectionState === "disconnected" || connectionState === "closed") {
            setStatus("disconnected");
          }
        },
      });
      peerRef.current = pc;
      await postPairingAnswer(answerUrl, answer);
      if (sessionId) {
        pairingSessionRef.current = sessionId;
        void AsyncStorage.setItem(PAIRING_SESSION_STORAGE_KEY, sessionId);
      }
      return true;
    } catch (err) {
      closeConnection();
      clearStoredPairingSession();
      setStatus("error");
      setError(err instanceof Error ? err.message : "Pairing failed");
      return false;
    }
  }, [attachDataChannel, clearStoredPairingSession, closeConnection]);

  const pairWithJoinToken = useCallback(async (joinToken: string) => {
    setStatus("pairing");
    setError(null);
    try {
      const attempt = await createJoinAttempt(joinToken, photoContributorIdRef.current);
      const offer = await pollJoinOffer(joinToken, attempt);
      return pairWithOffer(offer.offer, offer.answerUrl, offer.sessionId);
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Pairing failed");
      return false;
    }
  }, [pairWithOffer]);

  const pairFromUrl = useCallback(async (url: string) => {
    const pairing = parseMobileWebRtcPairingUrl(url);
    if (!pairing) return false;
    if (pairing.type === "offer") return pairWithOffer(pairing.offer, pairing.answerUrl, pairing.sessionId);
    if (pairing.type === "join-token") return pairWithJoinToken(pairing.token);
    return false;
  }, [pairWithJoinToken, pairWithOffer]);

  const reconnectToStoredSession = useCallback(async () => {
    if (reconnectingRef.current || controlChannelRef.current?.readyState === "open") return;
    const sessionId = pairingSessionRef.current ?? (await AsyncStorage.getItem(PAIRING_SESSION_STORAGE_KEY));
    if (!sessionId) return;
    pairingSessionRef.current = sessionId;
    reconnectingRef.current = true;
    try {
      await pairWithJoinToken(sessionId);
    } finally {
      reconnectingRef.current = false;
    }
  }, [pairWithJoinToken]);

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_STORAGE_KEY)
      .then((rawValue) => {
        if (!rawValue) return;
        const parsed = JSON.parse(rawValue) as Partial<ScannerSettings>;
        const nextSettings = { ...defaultSettings, ...parsed };
        settingsRef.current = nextSettings;
        setSettings(nextSettings);
      })
      .catch(() => {});
    AsyncStorage.getItem(PENDING_PHOTOS_STORAGE_KEY)
      .then((rawValue) => {
        const parsed = rawValue ? JSON.parse(rawValue) : [];
        if (Array.isArray(parsed)) persistPendingPhotos(parsed as PendingPhoto[]);
      })
      .catch(() => persistPendingPhotos([]));
  }, [persistPendingPhotos]);

  useEffect(() => () => closeConnection(), [closeConnection]);

  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url) void pairFromUrl(url);
      else void reconnectToStoredSession();
    });
    const subscription = Linking.addEventListener("url", ({ url }) => void pairFromUrl(url));
    return () => subscription.remove();
  }, [pairFromUrl, reconnectToStoredSession]);

  useEffect(() => {
    void AsyncStorage.getItem(PAIRING_SESSION_STORAGE_KEY).then((sessionId) => {
      if (sessionId) pairingSessionRef.current = sessionId;
    });
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") {
        persistPendingPhotos(pendingPhotosRef.current);
        if (status === "session_ready") void flushPhotoWorker();
        else void reconnectToStoredSession();
      }
      if (nextAppState !== "active" && pendingPhotosRef.current.some((photo) => photo.status !== "received")) {
        setPhotoError("Keep app open until delivered");
      }
    });
    return () => subscription.remove();
  }, [flushPhotoWorker, persistPendingPhotos, reconnectToStoredSession, status]);

  const setSetting = useCallback(<Key extends keyof ScannerSettings>(key: Key, value: ScannerSettings[Key]) => {
    setSettings((current) => {
      const next = { ...current, [key]: value };
      settingsRef.current = next;
      void AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clearCameraFocus = useCallback(() => {
    setFocusMode("off");
    setFocusPoint(null);
  }, []);

  const sendScan = useCallback(async (item: ScanItem) => {
    const now = Date.now();
    const isDictation = item.kind === "text" && item.format === "dictation";
    const isPartialDictation = isDictation && item.dictationPhase === "partial";
    const key = `${item.kind ?? "barcode"}:${item.format ?? ""}:${item.barcode.trim().toLowerCase()}`;
    const lastSent = lastSentScanRef.current;
    if (!isDictation) {
      if (lastSent?.key === key && now - lastSent.at < REPEAT_SCAN_COOLDOWN_MS) return;
      lastSentScanRef.current = { key, at: now };
    }
    if (!isPartialDictation) setScans((current) => [item, ...current].slice(0, 50));
    if (!sessionReadyRef.current || controlChannelRef.current?.readyState !== "open") {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setError("Pair with Chrome before sending.");
      return;
    }
    const mode = scannerMessageMode(item);
    const sent = isDictation
      ? sendControl({
          type: "dictation",
          messageId: createId("dictation"),
          sentAt: new Date().toISOString(),
          dictationSessionId: item.dictationSessionId ?? dictationSessionIdRef.current ?? createId("dictation"),
          phase: item.dictationPhase ?? "final",
          text: item.barcode,
          capturedAt: item.scannedAt ?? new Date().toISOString(),
          insertIntoCursor: item.insertIntoCursor,
        })
      : sendControl({
          type: "capture_result",
          messageId: createId("capture"),
          sentAt: new Date().toISOString(),
          resultId: item.id,
          resultKind: mode === "barcode" ? "barcode" : "text",
          value: item.barcode,
          format: item.format,
          capturedAt: item.scannedAt ?? new Date().toISOString(),
          insertIntoCursor: item.insertIntoCursor,
          contributorId: photoContributorIdRef.current,
        });
    if (!sent) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (!isPartialDictation) await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [sendControl]);

  const flushScannerItems = useCallback(() => {
    scannerFlushTimerRef.current = null;
    const items = pendingScannerItemsRef.current;
    pendingScannerItemsRef.current = [];
    if (!items.length) return;
    const latestSettings = settingsRef.current;
    if (items.length === 1) {
      if (latestSettings.autoSendSingleBarcode) void sendScan(items[0]);
      else {
        Alert.alert("Send barcode?", items[0].barcode, [
          { text: "Send", onPress: () => void sendScan(items[0]) },
          { text: "Cancel", style: "cancel" },
        ]);
      }
      return;
    }
    if (!latestSettings.confirmMultipleBarcodes) {
      void sendScan(items[0]);
      return;
    }
    Alert.alert("Choose barcode", "More than one barcode was detected. Pick the one to type into Chrome.", [
      ...items.slice(0, 3).map((item) => ({
        text: item.barcode.length > 24 ? `${item.barcode.slice(0, 21)}...` : item.barcode,
        onPress: () => void sendScan(item),
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  }, [sendScan]);

  const onBarcodeScanned = useCallback(({ data, type }: BarcodeScanningResult) => {
    const value = data.trim();
    if (!value || !connected) return;
    const now = Date.now();
    const last = lastScanRef.current;
    if (last?.value === value && now - last.at < REPEAT_SCAN_COOLDOWN_MS) return;
    lastScanRef.current = { value, at: now };
    const item = makeBarcodeMessage(value, type, settingsRef.current.scannerInsertIntoCursor);
    pendingScannerItemsRef.current = [...pendingScannerItemsRef.current.filter((pending) => pending.barcode !== item.barcode), item];
    if (scannerFlushTimerRef.current) clearTimeout(scannerFlushTimerRef.current);
    scannerFlushTimerRef.current = setTimeout(flushScannerItems, MULTI_SCAN_WINDOW_MS);
  }, [connected, flushScannerItems]);

  const sendBarcodeScanResult = useCallback(async ({ data, type }: BarcodeScanningResult) => {
    const value = data.trim();
    if (!value) return;
    await sendScan(makeBarcodeMessage(value, type, settingsRef.current.scannerInsertIntoCursor));
  }, [sendScan]);

  const sendManualText = useCallback(() => {
    const value = manualText.trim();
    if (!value) return;
    setManualText("");
    void sendScan(makeCaptureMessage(value, "plain-text", "text", false));
  }, [manualText, sendScan]);

  const sendTextCapture = useCallback(async (text: string) => {
    const value = text.trim();
    if (!value) return;
    await sendScan(makeOcrMessage(value, settingsRef.current.ocrInsertIntoCursor));
    setTextCaptureResult({
      text: value,
      target: connected ? "browser" : "local scan history",
      sentAt: new Date().toISOString(),
    });
  }, [connected, sendScan]);

  const sendClipboardTextCapture = useCallback(async (text?: string) => {
    const value = (text ?? (await Clipboard.getStringAsync())).trim();
    if (!value || value === lastTextCaptureClipboardRef.current) return;
    lastTextCaptureClipboardRef.current = value;
    await sendTextCapture(value);
  }, [sendTextCapture]);

  useEffect(() => {
    if (!textCapture) {
      lastTextCaptureClipboardRef.current = null;
      return;
    }
    let cancelled = false;
    let checkingClipboard = false;
    const checkClipboard = async () => {
      if (cancelled || checkingClipboard) return;
      checkingClipboard = true;
      try {
        const value = (await Clipboard.getStringAsync()).trim();
        if (!cancelled && value && value !== lastTextCaptureClipboardRef.current) await sendClipboardTextCapture(value);
      } finally {
        checkingClipboard = false;
      }
    };
    void Clipboard.getStringAsync().then((value) => {
      if (!cancelled) lastTextCaptureClipboardRef.current = value.trim();
    });
    const subscription = Clipboard.addClipboardListener((event) => {
      if (event.contentTypes.includes(Clipboard.ContentType.PLAIN_TEXT)) void checkClipboard();
    });
    const pollTimer = setInterval(checkClipboard, CLIPBOARD_POLL_MS);
    return () => {
      cancelled = true;
      Clipboard.removeClipboardListener(subscription);
      clearInterval(pollTimer);
    };
  }, [sendClipboardTextCapture, textCapture]);

  const sendDictationText = useCallback((text: string, phase: "partial" | "final") => {
    const value = text.trim();
    if (!value) return;
    const sessionId = dictationSessionIdRef.current ?? createId("dictation");
    dictationSessionIdRef.current = sessionId;
    if (phase === "partial") {
      if (value === lastDictationPartialRef.current) return;
      lastDictationPartialRef.current = value;
    } else {
      if (value === lastDictationRef.current) return;
      lastDictationRef.current = value;
    }
    void sendScan({
      ...makeCaptureMessage(value, "dictation", "text", true),
      dictationPhase: phase,
      dictationSessionId: sessionId,
    });
  }, [sendScan]);

  useSpeechRecognitionEvent("start", () => {
    if (!dictationRequestedRef.current) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    dictationStopRequestedRef.current = false;
    setDictationStarting(false);
    setDictating(true);
    setDictationError(null);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  });

  useSpeechRecognitionEvent("end", () => {
    if (dictationStopRequestedRef.current) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    dictationStopRequestedRef.current = false;
    dictationRequestedRef.current = false;
    setDictationStarting(false);
    setDictating(false);
  });

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript?.trim() ?? "";
    dictationTranscriptRef.current = transcript;
    setDictationTranscript(transcript);
    if (event.isFinal) sendDictationText(transcript, "final");
  });

  useSpeechRecognitionEvent("error", (event) => {
    dictationStopRequestedRef.current = false;
    dictationRequestedRef.current = false;
    setDictationStarting(false);
    setDictating(false);
    setDictationError(event.message || event.error);
  });

  const prepareDictation = useCallback(async () => {
    if (dictationPermissionGrantedRef.current) return;
    const permissions = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    dictationPermissionGrantedRef.current = permissions.granted;
    if (!permissions.granted) setDictationError("Microphone and speech recognition permissions are required.");
  }, []);

  const startDictation = useCallback(async () => {
    if (!connected) {
      setDictationStarting(false);
      dictationRequestedRef.current = false;
      setDictationError("Pair with Chrome before dictating.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    if (!dictationPermissionGrantedRef.current) {
      await prepareDictation();
      if (!dictationPermissionGrantedRef.current) {
        setDictationStarting(false);
        dictationRequestedRef.current = false;
        return;
      }
    }
    dictationRequestedRef.current = true;
    dictationStopRequestedRef.current = false;
    lastDictationRef.current = "";
    lastDictationPartialRef.current = "";
    dictationSessionIdRef.current = createId("dictation");
    dictationTranscriptRef.current = "";
    setDictationTranscript("");
    setDictationError(null);
    setDictationStarting(true);
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      continuous: true,
      addsPunctuation: settings.dictationPunctuation,
    });
  }, [connected, prepareDictation, settings.dictationPunctuation]);

  const stopDictation = useCallback(() => {
    dictationStopRequestedRef.current = true;
    dictationRequestedRef.current = false;
    setDictationStarting(false);
    if (dictationSessionIdRef.current) {
      sendControl({
        type: "dictation",
        messageId: createId("dictation-stop"),
        sentAt: new Date().toISOString(),
        dictationSessionId: dictationSessionIdRef.current,
        phase: "stopped",
        capturedAt: new Date().toISOString(),
        insertIntoCursor: true,
      });
    }
    ExpoSpeechRecognitionModule.stop();
  }, [sendControl]);

  const captureText = useCallback(async () => {
    if (!cameraRef.current || recognizingText) return;
    setRecognizingText(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.92, skipProcessing: false });
      const resizeAction = getOcrResizeAction(photo);
      const preparedPhoto = resizeAction
        ? await manipulateAsync(photo.uri, [resizeAction], { compress: 0.92, format: SaveFormat.JPEG })
        : photo;
      setCaptureZoom(1);
      setTextCapture({ photoUri: preparedPhoto.uri });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read text from the camera.";
      Alert.alert("Text scan unavailable", message);
    } finally {
      setRecognizingText(false);
    }
  }, [recognizingText]);

  const clearTextCapture = useCallback(() => {
    setTextCapture(null);
    setTextCaptureResult(null);
    setCaptureZoom(1);
  }, []);

  const createRollingPhotoBatchId = useCallback((now: number, forceNew = false) => {
    const existingBatch = activePhotoBatchRef.current;
    const batchId =
      !forceNew && existingBatch && existingBatch.expiresAt > now
        ? existingBatch.id
        : createId(forceNew ? "upload-batch" : "batch");
    activePhotoBatchRef.current = { id: batchId, expiresAt: now + PHOTO_BATCH_WINDOW_MS };
    return batchId;
  }, []);

  const queuePreparedPhoto = useCallback(async ({
    batchId,
    capturedAt,
    height,
    name,
    now,
    uri,
    width,
  }: {
    batchId: string;
    capturedAt: string;
    height?: number;
    name?: string | null;
    now: number;
    uri: string;
    width?: number;
  }) => {
    const resizeAction = getPhotoResizeAction({ width, height });
    const preparedPhoto = await manipulateAsync(
      uri,
      [resizeAction].filter(Boolean) as NonNullable<ReturnType<typeof getPhotoResizeAction>>[],
      { base64: true, compress: 0.76, format: SaveFormat.JPEG }
    );
    const photoBase64 = preparedPhoto.base64 ?? null;
    if (!photoBase64) throw new Error("Could not prepare photo data.");
    const id = createId("photo");
    const size = Math.ceil((photoBase64.length * 3) / 4);
    const chunks = chunkPhotoBase64(photoBase64);
    return {
      id,
      batchId,
      name: jpegUploadName(name, capturedAt, id),
      mimeType: "image/jpeg",
      dataBase64: photoBase64,
      capturedAt,
      size,
      width: preparedPhoto.width,
      height: preparedPhoto.height,
      createdAt: now,
      updatedAt: now,
      totalChunks: chunks.length,
      nextChunkIndex: 0,
      status: "queued" as const,
      progress: 0,
    } satisfies PendingPhoto;
  }, []);

  const sendPhotoLibraryAssets = useCallback(async (assets: ImagePickerAsset[]) => {
    const imageAssets = assets.filter((asset) => asset.uri);
    if (!imageAssets.length) return 0;
    setPhotoError(null);
    if (pendingPhotosRef.current.reduce((size, photo) => size + photo.size, 0) > PHOTO_QUEUE_LOW_STORAGE_BYTES) {
      setPhotoError("Storage is getting tight. Let pending photos deliver before uploading more.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return 0;
    }
    const batchStartedAt = Date.now();
    const batchId = createRollingPhotoBatchId(batchStartedAt, true);
    const queuedPhotos: PendingPhoto[] = [];
    setPhotoProgressLabel(`Queueing ${imageAssets.length} upload${imageAssets.length === 1 ? "" : "s"}`);
    try {
      for (let index = 0; index < imageAssets.length; index += 1) {
        const asset = imageAssets[index];
        const now = batchStartedAt + index;
        const capturedAt = new Date(now).toISOString();
        setPhotoProgressLabel(`Preparing ${index + 1} of ${imageAssets.length}`);
        queuedPhotos.push(await queuePreparedPhoto({
          batchId,
          capturedAt,
          height: asset.height,
          name: asset.fileName ?? asset.assetId,
          now,
          uri: asset.uri,
          width: asset.width,
        }));
      }
      updatePendingPhotos((photos) => [...queuedPhotos, ...photos]);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (connected) void flushPhotoWorker();
      return queuedPhotos.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not queue selected photos.";
      setPhotoError(message);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return queuedPhotos.length;
    } finally {
      setPhotoProgressLabel(null);
    }
  }, [connected, createRollingPhotoBatchId, flushPhotoWorker, queuePreparedPhoto, updatePendingPhotos]);

  const sendPhotoCapture = useCallback(async (cropFrame?: PhotoCropFrame | null) => {
    setPhotoError(null);
    if (pendingPhotosRef.current.reduce((size, photo) => size + photo.size, 0) > PHOTO_QUEUE_LOW_STORAGE_BYTES) {
      setPhotoError("Storage is getting tight. Let pending photos deliver before taking more.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    try {
      let photoBase64: string | null = null;
      let photoWidth: number | undefined;
      let photoHeight: number | undefined;
      if (!cameraRef.current) throw new Error("Camera is not ready.");
      const capturedPhoto = await cameraRef.current.takePictureAsync({ quality: 0.82, skipProcessing: false });
      if (!capturedPhoto.uri || !capturedPhoto.width || !capturedPhoto.height) throw new Error("Camera did not return photo data.");
      const normalizedPhoto = await manipulateAsync(capturedPhoto.uri, [], { compress: 0.92, format: SaveFormat.JPEG });
      const cropAction = cropActionForVisibleFrame({ width: normalizedPhoto.width, height: normalizedPhoto.height }, cropFrame);
      const resizeAction = getPhotoResizeAction(normalizedPhoto);
      const preparedPhoto = await manipulateAsync(
        normalizedPhoto.uri,
        [cropAction, resizeAction].filter(Boolean) as NonNullable<ReturnType<typeof getPhotoResizeAction>>[],
        { base64: true, compress: 0.76, format: SaveFormat.JPEG }
      );
      photoBase64 = preparedPhoto.base64 ?? null;
      photoWidth = preparedPhoto.width;
      photoHeight = preparedPhoto.height;
      if (!photoBase64) throw new Error("Could not prepare photo data.");
      const now = Date.now();
      const batchId = createRollingPhotoBatchId(now);
      const id = createId("photo");
      const capturedAt = new Date(now).toISOString();
      const size = Math.ceil((photoBase64.length * 3) / 4);
      const chunks = chunkPhotoBase64(photoBase64);
      const pendingPhoto: PendingPhoto = {
        id,
        batchId,
        name: `volt-photo-${capturedAt.replace(/[:.]/g, "-")}.jpg`,
        mimeType: "image/jpeg",
        dataBase64: photoBase64,
        capturedAt,
        size,
        width: photoWidth,
        height: photoHeight,
        createdAt: now,
        updatedAt: now,
        totalChunks: chunks.length,
        nextChunkIndex: 0,
        status: "queued",
        progress: 0,
      };
      updatePendingPhotos((photos) => [pendingPhoto, ...photos]);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (connected) void flushPhotoWorker();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not queue the photo.";
      setPhotoError(message);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [connected, createRollingPhotoBatchId, flushPhotoWorker, updatePendingPhotos]);

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
    updatePendingPhotos((photos) => photos.filter((photo) => photo.id !== id));
  }, [updatePendingPhotos]);

  const retryPendingPhotos = useCallback(() => {
    updatePendingPhotos((photos) =>
      photos.map((photo) =>
        photo.status === "failed" || photo.status === "sent"
          ? { ...photo, status: "queued", error: undefined, progress: 0, nextChunkIndex: 0, updatedAt: Date.now() }
          : photo
      )
    );
    void flushPhotoWorker();
  }, [flushPhotoWorker, updatePendingPhotos]);

  const statusLabel = useMemo(() => {
    if (status === "session_ready") return "Connected to Chrome";
    if (status === "pairing") return "Pairing";
    if (status === "error") return error ?? "Connection error";
    if (status === "disconnected") return "Disconnected";
    return "No Connection";
  }, [error, status]);

  const statusHint = useMemo(() => {
    if (status === "error") return error ?? "Connection error";
    if (status === "disconnected" || status === "idle") return "Scan Chrome QR";
    if (status === "pairing") return "Pairing with Chrome";
    if (photoError) return photoError;
    if (photoProgressLabel) return photoProgressLabel;
    if (pendingPhotos.some((photo) => photo.status === "sent" || photo.status === "sending")) return "Keep app open until delivered";
    if (!targetHint && (activeMode === "ocr" || activeMode === "barcode" || activeMode === "dictation")) return "No cursor target - saving to results";
    if (activeMode === "photo") return "Photos save after Chrome receipt";
    if (activeMode === "dictation") return dictating ? "Typing to Chrome" : "Hold to dictate";
    if (targetHint) return `Typing to ${targetHint}`;
    if (textCaptureResult) return settings.ocrInsertIntoCursor ? "Inserted + saved" : "Saved to results";
    return activeMode === "barcode" ? "Ready for barcode" : "Ready for text";
  }, [activeMode, dictating, error, pendingPhotos, photoError, photoProgressLabel, settings.ocrInsertIntoCursor, status, targetHint, textCaptureResult]);

  const value = useMemo<ScannerState>(() => ({
    activeMode,
    cameraRef,
    cameraZoom,
    cancelPendingPhoto,
    captureText,
    captureZoom,
    clearCameraFocus,
    clearTextCapture,
    connected,
    dictating,
    dictationStarting,
    dictationError,
    dictationTranscript,
    focusMode,
    focusPoint,
    hasManualText: manualText.trim().length > 0,
    manualText,
    onBarcodeScanned,
    pairFromUrl,
    pendingPhotos: pendingPhotoSummaries(pendingPhotos),
    permission,
    photoError,
    photoProgressLabel,
    photoSentAt,
    photoSending,
    prepareDictation,
    recognizingText,
    requestPermission,
    retryPendingPhotos,
    scans,
    sendBarcodeScanResult,
    sendPhotoCapture,
    sendPhotoLibraryAssets,
    sendManualText,
    sendTextCapture,
    setActiveMode,
    setCameraZoom,
    setCaptureZoom,
    setFocusMode,
    setFocusPoint,
    setManualText,
    setSetting,
    startDictation,
    settings,
    setTorch,
    status,
    statusHint,
    statusLabel,
    stopDictation,
    textCapture,
    textCaptureResult,
    torch,
  }), [
    activeMode,
    cameraZoom,
    cancelPendingPhoto,
    captureText,
    captureZoom,
    clearCameraFocus,
    clearTextCapture,
    connected,
    dictating,
    dictationStarting,
    dictationError,
    dictationTranscript,
    focusMode,
    focusPoint,
    manualText,
    onBarcodeScanned,
    pairFromUrl,
    pendingPhotos,
    permission,
    photoError,
    photoProgressLabel,
    photoSentAt,
    photoSending,
    prepareDictation,
    recognizingText,
    requestPermission,
    retryPendingPhotos,
    scans,
    sendBarcodeScanResult,
    sendPhotoCapture,
    sendPhotoLibraryAssets,
    sendManualText,
    sendTextCapture,
    setSetting,
    startDictation,
    settings,
    status,
    statusHint,
    statusLabel,
    stopDictation,
    textCapture,
    textCaptureResult,
    torch,
  ]);

  return <ScannerContext.Provider value={value}>{children}</ScannerContext.Provider>;
}

export function useScanner() {
  const context = useContext(ScannerContext);
  if (!context) throw new Error("useScanner must be used within ScannerProvider");
  return context;
}
