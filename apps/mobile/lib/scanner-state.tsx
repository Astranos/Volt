import { decode as base64Decode, encode as base64Encode } from "base-64";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as Linking from "expo-linking";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { RTCPeerConnection, RTCSessionDescription } from "react-native-webrtc";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { Alert, AppState } from "react-native";
import {
  decodePairingPayload,
  encodeBarcodeMessage,
  encodeScannerTransportMessage,
  encodePairingPayload,
  SCANNER_ICE_SERVERS,
  SCANNER_SCAN_COOLDOWN_MS,
  SCANNER_SIGNAL_URL,
  type BarcodeMessage,
} from "@volt/scanner-protocol";

globalThis.atob ??= base64Decode;
globalThis.btoa ??= base64Encode;

type ConnectionStatus = "idle" | "pairing" | "connected" | "disconnected" | "error";
const PAIRING_SESSION_RETRY_DELAYS_MS = [0, 350, 800, 1400];
const SETTINGS_STORAGE_KEY = "volt.mobileScanner.settings.v1";
const PAIRING_SESSION_STORAGE_KEY = "volt.mobileScanner.pairingSession.v1";
const MULTI_SCAN_WINDOW_MS = 650;
const CLIPBOARD_POLL_MS = 900;
const PHOTO_CHUNK_SIZE = 12000;
const OCR_CAPTURE_MAX_DIMENSION = 1800;

export type ScannerSettings = {
  autoSendSingleBarcode: boolean;
  confirmMultipleBarcodes: boolean;
  dictationPunctuation: boolean;
  ocrInsertIntoCursor: boolean;
  scannerInsertIntoCursor: boolean;
};

const defaultSettings: ScannerSettings = {
  autoSendSingleBarcode: true,
  confirmMultipleBarcodes: true,
  dictationPunctuation: true,
  ocrInsertIntoCursor: false,
  scannerInsertIntoCursor: true,
};

export type ScanItem = BarcodeMessage & {
  id: string;
};

type TextCapture = {
  photoUri: string;
};

type TextCaptureResult = {
  text: string;
  target: string;
  sentAt: string;
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
  cameraRef: React.MutableRefObject<any>;
  cameraZoom: number;
  captureText: () => Promise<void>;
  captureZoom: number;
  clearCameraFocus: () => void;
  clearTextCapture: () => void;
  connected: boolean;
  dictating: boolean;
  dictationError: string | null;
  dictationTranscript: string;
  focusMode: "on" | "off";
  focusPoint: { x: number; y: number } | null;
  hasManualText: boolean;
  manualText: string;
  onBarcodeScanned: (result: BarcodeScanningResult) => void;
  pairFromUrl: (url: string) => Promise<boolean>;
  permission: ReturnType<typeof useCameraPermissions>[0];
  recognizingText: boolean;
  requestPermission: ReturnType<typeof useCameraPermissions>[1];
  scans: ScanItem[];
  sendBarcodeScanResult: (result: BarcodeScanningResult) => Promise<void>;
  sendPhotoCapture: () => Promise<void>;
  sendManualText: () => void;
  setCameraZoom: React.Dispatch<React.SetStateAction<number>>;
  setCaptureZoom: React.Dispatch<React.SetStateAction<number>>;
  setFocusMode: React.Dispatch<React.SetStateAction<"on" | "off">>;
  setFocusPoint: React.Dispatch<React.SetStateAction<{ x: number; y: number } | null>>;
  setManualText: (value: string) => void;
  photoError: string | null;
  photoSending: boolean;
  setSetting: <Key extends keyof ScannerSettings>(key: Key, value: ScannerSettings[Key]) => void;
  startDictation: () => Promise<void>;
  settings: ScannerSettings;
  setTorch: React.Dispatch<React.SetStateAction<boolean>>;
  status: ConnectionStatus;
  statusLabel: string;
  stopDictation: () => void;
  textCapture: TextCapture | null;
  textCaptureResult: TextCaptureResult | null;
  torch: boolean;
};

const ScannerContext = createContext<ScannerState | null>(null);
const REPEAT_SCAN_COOLDOWN_MS = Math.max(SCANNER_SCAN_COOLDOWN_MS, 1500);

function getOfferFromUrl(url: string) {
  const parsed = Linking.parse(url);
  const offer = parsed.queryParams?.offer;
  return typeof offer === "string" ? offer : undefined;
}

function getSessionFromUrl(url: string) {
  const parsed = Linking.parse(url);
  const session = parsed.queryParams?.session;
  return typeof session === "string" ? session : undefined;
}

function wait(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function makeScanItem(
  value: string,
  format: string,
  kind: BarcodeMessage["kind"],
  insertIntoCursor?: boolean
): ScanItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    barcode: value.trim(),
    format,
    insertIntoCursor,
    kind,
    scannedAt: new Date().toISOString(),
  };
}

function getOcrResizeAction(photo: { width?: number; height?: number }) {
  const { height, width } = photo;
  if (!width || !height) return null;

  const maxDimension = Math.max(width, height);
  if (maxDimension <= OCR_CAPTURE_MAX_DIMENSION) return null;

  const scale = OCR_CAPTURE_MAX_DIMENSION / maxDimension;
  return {
    resize: {
      height: Math.round(height * scale),
      width: Math.round(width * scale),
    },
  };
}

export function ScannerProvider({ children }: PropsWithChildren) {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
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
  const [dictationTranscript, setDictationTranscript] = useState("");
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [photoSending, setPhotoSending] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ScannerSettings>(defaultSettings);

  const peerRef = useRef<any>(null);
  const channelRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const lastSentScanRef = useRef<{ key: string; at: number } | null>(null);
  const lastDictationRef = useRef("");
  const lastTextCaptureClipboardRef = useRef<string | null>(null);
  const pendingScannerItemsRef = useRef<ScanItem[]>([]);
  const scannerFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pairingSessionRef = useRef<string | null>(null);
  const lastOfferRef = useRef<string | null>(null);
  const reconnectingRef = useRef(false);

  const connected = status === "connected" && channelRef.current?.readyState === "open";

  const clearCameraFocus = useCallback(() => {
    setFocusMode("off");
    setFocusPoint(null);
  }, []);

  const closeConnection = useCallback(() => {
    channelRef.current?.close();
    peerRef.current?.close();
    channelRef.current = null;
    peerRef.current = null;
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_STORAGE_KEY)
      .then((rawValue) => {
        if (!rawValue) return;
        const parsed = JSON.parse(rawValue) as Partial<ScannerSettings>;
        setSettings({ ...defaultSettings, ...parsed });
      })
      .catch(() => {});
  }, []);

  const setSetting = useCallback(
    <Key extends keyof ScannerSettings>(key: Key, value: ScannerSettings[Key]) => {
      setSettings((current) => {
        const next = { ...current, [key]: value };
        void AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    },
    []
  );

  const pairWithOffer = useCallback(
    async (offerCode: string, sessionId?: string) => {
      closeConnection();
      setStatus("pairing");
      setError(null);

      try {
        lastOfferRef.current = offerCode;
        const pc = new RTCPeerConnection({ iceServers: SCANNER_ICE_SERVERS });
        const pcEvents = pc as any;
        peerRef.current = pc;

        pcEvents.ondatachannel = (event: any) => {
          channelRef.current = event.channel;
          event.channel.onopen = () => setStatus("connected");
          event.channel.onclose = () => setStatus("disconnected");
          event.channel.onerror = () => {
            setStatus("error");
            setError("Connection lost");
          };
        };

        pcEvents.onconnectionstatechange = () => {
          if (pc.connectionState === "failed") {
            setStatus("error");
            setError("Connection failed");
          } else if (pc.connectionState === "disconnected" || pc.connectionState === "closed") {
            setStatus("disconnected");
          }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(decodePairingPayload(offerCode) as any));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 5000);
          pcEvents.onicecandidate = (event: { candidate: unknown | null }) => {
            if (!event.candidate) {
              clearTimeout(timeout);
              resolve();
            }
          };
        });

        if (!pc.localDescription) throw new Error("Failed to create answer");

        if (sessionId) {
          const answerResponse = await fetch(`${SCANNER_SIGNAL_URL}/${sessionId}/answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answer: JSON.stringify(pc.localDescription) }),
          });

          if (!answerResponse.ok) throw new Error("Failed to send pairing answer");

          pairingSessionRef.current = sessionId;
          void AsyncStorage.setItem(PAIRING_SESSION_STORAGE_KEY, sessionId);
        } else {
          throw new Error("Pairing session missing");
        }
      } catch (err) {
        closeConnection();
        setStatus("error");
        setError(err instanceof Error ? err.message : "Pairing failed");
      }
    },
    [closeConnection]
  );

  const pairWithSession = useCallback(
    async (sessionId: string) => {
      try {
        setStatus("pairing");
        setError(null);

        let offer: string | null = null;
        for (const delayMs of PAIRING_SESSION_RETRY_DELAYS_MS) {
          if (delayMs) await wait(delayMs);
          const offerResponse = await fetch(`${SCANNER_SIGNAL_URL}/${sessionId}`);
          if (offerResponse.ok) {
            const payload = await offerResponse.json();
            if (typeof payload.offer !== "string" || !payload.offer) {
              throw new Error("Invalid pairing session");
            }

            const nextOffer = payload.offer;
            offer = nextOffer;
            if (encodePairingPayload(JSON.parse(nextOffer)) !== lastOfferRef.current) break;
            continue;
          }
          if (offerResponse.status !== 404) {
            throw new Error("Pairing service unavailable");
          }
        }

        if (!offer) {
          throw new Error("Pairing service is not ready. Restart pairing in the Chrome extension and scan the new QR.");
        }

        await pairWithOffer(encodePairingPayload(JSON.parse(offer)), sessionId);
      } catch (err) {
        closeConnection();
        setStatus("error");
        setError(err instanceof Error ? err.message : "Pairing failed");
      }
    },
    [closeConnection, pairWithOffer]
  );

  useEffect(() => {
    return () => closeConnection();
  }, [closeConnection]);

  const pairFromUrl = useCallback(
    async (url: string) => {
      const offer = getOfferFromUrl(url);
      const session = getSessionFromUrl(url);

      if (session) {
        pairingSessionRef.current = session;
        void AsyncStorage.setItem(PAIRING_SESSION_STORAGE_KEY, session);
      }

      if (offer) {
        await pairWithOffer(offer, session);
        return true;
      }

      if (session) {
        await pairWithSession(session);
        return true;
      }

      return false;
    },
    [pairWithOffer, pairWithSession]
  );

  const reconnectToStoredSession = useCallback(async () => {
    if (reconnectingRef.current || channelRef.current?.readyState === "open") return;
    const sessionId = pairingSessionRef.current ?? (await AsyncStorage.getItem(PAIRING_SESSION_STORAGE_KEY));
    if (!sessionId) return;

    pairingSessionRef.current = sessionId;
    reconnectingRef.current = true;
    try {
      await pairWithSession(sessionId);
    } finally {
      reconnectingRef.current = false;
    }
  }, [pairWithSession]);

  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url) {
        void pairFromUrl(url);
        return;
      }

      void reconnectToStoredSession();
    });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      void pairFromUrl(url);
    });

    return () => {
      subscription.remove();
    };
  }, [pairFromUrl, reconnectToStoredSession]);

  useEffect(() => {
    void AsyncStorage.getItem(PAIRING_SESSION_STORAGE_KEY).then((sessionId) => {
      if (sessionId) pairingSessionRef.current = sessionId;
    });

    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") {
        void reconnectToStoredSession();
      }
    });

    return () => subscription.remove();
  }, [reconnectToStoredSession]);

  const sendScan = useCallback(async (item: ScanItem) => {
    const now = Date.now();
    const key = `${item.kind ?? "barcode"}:${item.format ?? ""}:${item.barcode.trim().toLowerCase()}`;
    const lastSent = lastSentScanRef.current;
    if (lastSent?.key === key && now - lastSent.at < REPEAT_SCAN_COOLDOWN_MS) return;
    lastSentScanRef.current = { key, at: now };

    setScans((current) => [item, ...current].slice(0, 50));

    if (channelRef.current?.readyState === "open") {
      channelRef.current.send(encodeBarcodeMessage(item));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, []);

  const sendPhotoCapture = useCallback(async () => {
    if (!cameraRef.current || photoSending) return;

    const channel = channelRef.current;
    if (channel?.readyState !== "open") {
      setPhotoError("Pair with Chrome before taking photos.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    setPhotoSending(true);
    setPhotoError(null);

    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.72,
        skipProcessing: false,
      });

      if (!photo.uri || !photo.width || !photo.height) {
        throw new Error("Camera did not return photo data.");
      }

      const cropSize = Math.min(photo.width, photo.height);
      const squarePhoto = await manipulateAsync(
        photo.uri,
        [
          {
            crop: {
              originX: Math.max(0, Math.floor((photo.width - cropSize) / 2)),
              originY: Math.max(0, Math.floor((photo.height - cropSize) / 2)),
              width: cropSize,
              height: cropSize,
            },
          },
        ],
        {
          base64: true,
          compress: 0.72,
          format: SaveFormat.JPEG,
        }
      );

      if (!squarePhoto.base64) {
        throw new Error("Could not prepare square photo data.");
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const mimeType = "image/jpeg";
      const name = `volt-photo-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
      const chunks = squarePhoto.base64.match(new RegExp(`.{1,${PHOTO_CHUNK_SIZE}}`, "g")) ?? [];

      channel.send(
        encodeScannerTransportMessage({
          kind: "photo-chunk-start",
          id,
          name,
          mimeType,
          size: Math.ceil((squarePhoto.base64.length * 3) / 4),
          width: squarePhoto.width,
          height: squarePhoto.height,
          capturedAt: new Date().toISOString(),
          totalChunks: chunks.length,
        })
      );

      for (let index = 0; index < chunks.length; index += 1) {
        channel.send(
          encodeScannerTransportMessage({
            kind: "photo-chunk",
            id,
            index,
            data: chunks[index],
          })
        );
        await wait(8);
      }

      channel.send(encodeScannerTransportMessage({ kind: "photo-chunk-end", id }));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not send the photo.";
      setPhotoError(message);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } finally {
      setPhotoSending(false);
    }
  }, [photoSending]);

  const flushScannerItems = useCallback(() => {
    scannerFlushTimerRef.current = null;
    const items = pendingScannerItemsRef.current;
    pendingScannerItemsRef.current = [];
    if (!items.length) return;

    if (items.length === 1) {
      if (settings.autoSendSingleBarcode) {
        void sendScan(items[0]);
      } else {
        Alert.alert("Send barcode?", items[0].barcode, [
          { text: "Send", onPress: () => void sendScan(items[0]) },
          { text: "Cancel", style: "cancel" },
        ]);
      }
      return;
    }

    if (!settings.confirmMultipleBarcodes) {
      void sendScan(items[0]);
      return;
    }

    Alert.alert(
      "Choose barcode",
      "More than one barcode was detected. Pick the one to type into Chrome.",
      [
        ...items.slice(0, 3).map((item) => ({
          text: item.barcode.length > 24 ? `${item.barcode.slice(0, 21)}...` : item.barcode,
          onPress: () => void sendScan(item),
        })),
        { text: "Cancel", style: "cancel" as const },
      ]
    );
  }, [sendScan, settings.autoSendSingleBarcode, settings.confirmMultipleBarcodes]);

  const onBarcodeScanned = useCallback(
    ({ data, type }: BarcodeScanningResult) => {
      const value = data.trim();
      if (!value || !connected) return;

      const now = Date.now();
      const last = lastScanRef.current;
      if (last?.value === value && now - last.at < REPEAT_SCAN_COOLDOWN_MS) return;

      lastScanRef.current = { value, at: now };
      const item = makeScanItem(value, type, "barcode", settings.scannerInsertIntoCursor);
      const currentItems = pendingScannerItemsRef.current.filter((pending) => pending.barcode !== item.barcode);
      pendingScannerItemsRef.current = [...currentItems, item];

      if (scannerFlushTimerRef.current) clearTimeout(scannerFlushTimerRef.current);
      scannerFlushTimerRef.current = setTimeout(flushScannerItems, MULTI_SCAN_WINDOW_MS);
    },
    [connected, flushScannerItems, settings.scannerInsertIntoCursor]
  );

  const sendBarcodeScanResult = useCallback(
    async ({ data, type }: BarcodeScanningResult) => {
      const value = data.trim();
      if (!value) return;
      await sendScan(makeScanItem(value, type, "barcode", settings.scannerInsertIntoCursor));
    },
    [sendScan, settings.scannerInsertIntoCursor]
  );

  const sendManualText = useCallback(() => {
    const value = manualText.trim();
    if (!value) return;
    setManualText("");
    sendScan(makeScanItem(value, "plain-text", "text", false));
  }, [manualText, sendScan]);

  const sendDictationText = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value || value === lastDictationRef.current) return;
      lastDictationRef.current = value;
      sendScan(makeScanItem(value, "dictation", "text", true));
    },
    [sendScan]
  );

  const sendClipboardTextCapture = useCallback(
    async (text?: string) => {
      const value = (text ?? (await Clipboard.getStringAsync())).trim();
      if (!value || value === lastTextCaptureClipboardRef.current) return;
      lastTextCaptureClipboardRef.current = value;
      await sendScan(makeScanItem(value, "live-text", "text", settings.ocrInsertIntoCursor));
      setTextCaptureResult({
        text: value,
        target: channelRef.current?.readyState === "open" ? "Chrome results" : "local scan history",
        sentAt: new Date().toISOString(),
      });
    },
    [sendScan, settings.ocrInsertIntoCursor]
  );

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
        if (!cancelled && value && value !== lastTextCaptureClipboardRef.current) {
          await sendClipboardTextCapture(value);
        }
      } catch {
      } finally {
        checkingClipboard = false;
      }
    };

    void Clipboard.getStringAsync()
      .then((value) => {
        if (!cancelled) lastTextCaptureClipboardRef.current = value.trim();
      })
      .catch(() => {
        if (!cancelled) lastTextCaptureClipboardRef.current = "";
      });

    const subscription = Clipboard.addClipboardListener((event) => {
      if (event.contentTypes.includes(Clipboard.ContentType.PLAIN_TEXT)) {
        void checkClipboard();
      }
    });
    const pollTimer = setInterval(checkClipboard, CLIPBOARD_POLL_MS);

    return () => {
      cancelled = true;
      Clipboard.removeClipboardListener(subscription);
      clearInterval(pollTimer);
    };
  }, [sendClipboardTextCapture, textCapture]);

  useSpeechRecognitionEvent("start", () => {
    setDictating(true);
    setDictationError(null);
  });

  useSpeechRecognitionEvent("end", () => setDictating(false));

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript?.trim() ?? "";
    setDictationTranscript(transcript);
    if (event.isFinal) sendDictationText(transcript);
  });

  useSpeechRecognitionEvent("error", (event) => {
    setDictating(false);
    setDictationError(event.message || event.error);
  });

  const startDictation = useCallback(async () => {
    if (!connected) {
      setDictationError("Pair with Chrome before dictating.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    const permissions = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permissions.granted) {
      setDictationError("Microphone and speech recognition permissions are required.");
      return;
    }

    lastDictationRef.current = "";
    setDictationTranscript("");
    setDictationError(null);
    ExpoSpeechRecognitionModule.start({
      lang: "en-US",
      interimResults: true,
      continuous: false,
      addsPunctuation: settings.dictationPunctuation,
    });
  }, [connected, settings.dictationPunctuation]);

  const stopDictation = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  const captureText = useCallback(async () => {
    if (!cameraRef.current || recognizingText) return;

    setRecognizingText(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.92, skipProcessing: false });
      const resizeAction = getOcrResizeAction(photo);
      const preparedPhoto = resizeAction
        ? await manipulateAsync(photo.uri, [resizeAction], {
            compress: 0.92,
            format: SaveFormat.JPEG,
          })
        : photo;
      setCaptureZoom(1);
      setTextCapture({ photoUri: preparedPhoto.uri });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read text from the camera.";
      Alert.alert(
        "Text scan unavailable",
        message.includes("doesn't seem to be linked")
          ? "This dev build does not include the native OCR module yet. Rebuild and reinstall Volt with `pnpm --filter @volt/mobile exec expo run:ios --device \"iPhone 15\" --port 8081`, then reopen it from Metro."
          : message
      );
    } finally {
      setRecognizingText(false);
    }
  }, [recognizingText]);

  const clearTextCapture = useCallback(() => {
    setTextCapture(null);
    setTextCaptureResult(null);
    setCaptureZoom(1);
  }, []);

  const statusLabel = useMemo(() => {
    if (status === "connected") return "Connected to Chrome";
    if (status === "pairing") return "Pairing";
    if (status === "error") return error ?? "Connection error";
    return "No Connection";
  }, [error, status]);

  const value = useMemo<ScannerState>(
    () => ({
      cameraRef,
      cameraZoom,
      captureZoom,
      captureText,
      clearCameraFocus,
      clearTextCapture,
      connected,
      dictating,
      dictationError,
      dictationTranscript,
      focusMode,
      focusPoint,
      hasManualText: manualText.trim().length > 0,
      manualText,
      onBarcodeScanned,
      pairFromUrl,
      permission,
      photoError,
      photoSending,
      recognizingText,
      requestPermission,
      scans,
      sendBarcodeScanResult,
      sendPhotoCapture,
      sendManualText,
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
      statusLabel,
      stopDictation,
      textCapture,
      textCaptureResult,
      torch,
    }),
    [
      cameraZoom,
      captureZoom,
      captureText,
      clearCameraFocus,
      clearTextCapture,
      connected,
      dictating,
      dictationError,
      dictationTranscript,
      focusMode,
      focusPoint,
      manualText,
      onBarcodeScanned,
      pairFromUrl,
      permission,
      photoError,
      photoSending,
      recognizingText,
      requestPermission,
      scans,
      sendBarcodeScanResult,
      sendPhotoCapture,
      sendManualText,
      setSetting,
      startDictation,
      settings,
      status,
      statusLabel,
      stopDictation,
      textCapture,
      textCaptureResult,
      torch,
    ]
  );

  return <ScannerContext.Provider value={value}>{children}</ScannerContext.Provider>;
}

export function useScanner() {
  const context = useContext(ScannerContext);
  if (!context) throw new Error("useScanner must be used within ScannerProvider");
  return context;
}
