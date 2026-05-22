import { decode as base64Decode, encode as base64Encode } from "base-64";
import { useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { Alert } from "react-native";
import {
  decodePairingPayload,
  encodeBarcodeMessage,
  encodePairingPayload,
  SCANNER_ICE_SERVERS,
  SCANNER_SIGNAL_URL,
  type BarcodeMessage,
} from "@volt/scanner-protocol";

globalThis.atob ??= base64Decode;
globalThis.btoa ??= base64Encode;

type ConnectionStatus = "idle" | "pairing" | "connected" | "disconnected" | "error";
const PAIRING_SESSION_RETRY_DELAYS_MS = [0, 350, 800, 1400];

export type ScanItem = BarcodeMessage & {
  id: string;
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
  captureText: () => Promise<void>;
  connected: boolean;
  dictating: boolean;
  dictationError: string | null;
  dictationTranscript: string;
  hasManualText: boolean;
  manualText: string;
  onBarcodeScanned: (result: BarcodeScanningResult) => void;
  pairFromUrl: (url: string) => Promise<boolean>;
  permission: ReturnType<typeof useCameraPermissions>[0];
  recognizingText: boolean;
  requestPermission: ReturnType<typeof useCameraPermissions>[1];
  scans: ScanItem[];
  sendManualText: () => void;
  setManualText: (value: string) => void;
  startDictation: () => Promise<void>;
  setTorch: React.Dispatch<React.SetStateAction<boolean>>;
  status: ConnectionStatus;
  statusLabel: string;
  stopDictation: () => void;
  torch: boolean;
};

const ScannerContext = createContext<ScannerState | null>(null);

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

function makeScanItem(value: string, format: string, kind: BarcodeMessage["kind"]): ScanItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    barcode: value.trim(),
    format,
    kind,
    scannedAt: new Date().toISOString(),
  };
}

function selectOcrLines(lines: string[], fallbackText: string) {
  const sourceLines = lines.length ? lines : fallbackText.split(/\r?\n/);
  const labelPattern = /\b(imei|meid|serial|sn|s\/n|model|sku|upc|ean|asset|tag|barcode)\b/i;
  const valuePattern = /\b[A-Z0-9][A-Z0-9._/-]{3,}\b/i;
  const weakWords = /\b(warning|caution|made in|designed|assembled|copyright|trademark|battery|recycle|manual|instructions)\b/i;

  const candidates = sourceLines
    .map((rawLine) => rawLine.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 4 && line.length <= 80)
    .map((line) => {
      const labeledValue = line.match(/(?:imei|meid|serial|sn|s\/n|model|sku|upc|ean|asset|tag|barcode)\s*[:#-]?\s*([A-Z0-9][A-Z0-9._/-]{3,})/i)?.[1];
      const value = (labeledValue ?? line).trim();
      const hasDigit = /\d/.test(value);
      const hasValue = valuePattern.test(value);
      let score = 0;

      if (labelPattern.test(line)) score += 4;
      if (labeledValue) score += 3;
      if (hasValue) score += 2;
      if (hasDigit) score += 2;
      if (/^[A-Z0-9._/-]+$/i.test(value)) score += 1;
      if (weakWords.test(line)) score -= 4;
      if (!hasDigit && !labelPattern.test(line)) score -= 3;

      return { value, score };
    })
    .filter((candidate) => candidate.score >= 3);

  return Array.from(new Set(candidates.sort((a, b) => b.score - a.score).map((candidate) => candidate.value))).slice(0, 4);
}

export function ScannerProvider({ children }: PropsWithChildren) {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [manualText, setManualText] = useState("");
  const [scans, setScans] = useState<ScanItem[]>([]);
  const [torch, setTorch] = useState(false);
  const [recognizingText, setRecognizingText] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [dictationTranscript, setDictationTranscript] = useState("");
  const [dictationError, setDictationError] = useState<string | null>(null);

  const peerRef = useRef<any>(null);
  const channelRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);
  const lastDictationRef = useRef("");

  const connected = status === "connected" && channelRef.current?.readyState === "open";

  const closeConnection = useCallback(() => {
    channelRef.current?.close();
    peerRef.current?.close();
    channelRef.current = null;
    peerRef.current = null;
  }, []);

  const pairWithOffer = useCallback(
    async (offerCode: string, sessionId?: string) => {
      closeConnection();
      setStatus("pairing");
      setError(null);

      try {
        const { RTCPeerConnection, RTCSessionDescription } = require("react-native-webrtc");
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

        let offerResponse: Response | null = null;
        for (const delayMs of PAIRING_SESSION_RETRY_DELAYS_MS) {
          if (delayMs) await wait(delayMs);
          offerResponse = await fetch(`${SCANNER_SIGNAL_URL}/${sessionId}`);
          if (offerResponse.ok) break;
          if (offerResponse.status !== 404) {
            throw new Error("Pairing service unavailable");
          }
        }

        if (!offerResponse?.ok) {
          throw new Error("Pairing service is not ready. Restart pairing in the Chrome extension and scan the new QR.");
        }

        const { offer } = await offerResponse.json();
        if (typeof offer !== "string" || !offer) throw new Error("Invalid pairing session");

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

  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (url) void pairFromUrl(url);
    });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      void pairFromUrl(url);
    });

    return () => {
      subscription.remove();
    };
  }, [pairFromUrl]);

  const sendScan = useCallback(async (item: ScanItem) => {
    setScans((current) => [item, ...current].slice(0, 50));

    if (channelRef.current?.readyState === "open") {
      channelRef.current.send(encodeBarcodeMessage(item));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, []);

  const onBarcodeScanned = useCallback(
    ({ data, type }: BarcodeScanningResult) => {
      const value = data.trim();
      if (!value || !connected) return;

      const now = Date.now();
      const last = lastScanRef.current;
      if (last?.value === value && now - last.at < 1200) return;

      lastScanRef.current = { value, at: now };
      sendScan(makeScanItem(value, type, "barcode"));
    },
    [connected, sendScan]
  );

  const sendManualText = useCallback(() => {
    const value = manualText.trim();
    if (!value) return;
    setManualText("");
    sendScan(makeScanItem(value, "plain-text", "text"));
  }, [manualText, sendScan]);

  const sendDictationText = useCallback(
    (text: string) => {
      const value = text.trim();
      if (!value || value === lastDictationRef.current) return;
      lastDictationRef.current = value;
      sendScan(makeScanItem(value, "dictation", "text"));
    },
    [sendScan]
  );

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
      addsPunctuation: true,
    });
  }, [connected]);

  const stopDictation = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
  }, []);

  const captureText = useCallback(async () => {
    if (!cameraRef.current || recognizingText) return;

    setRecognizingText(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.75, skipProcessing: true });
      const TextRecognition = require("@react-native-ml-kit/text-recognition").default;
      const result = await TextRecognition.recognize(photo.uri) as {
        text: string;
        blocks: Array<{ lines: Array<{ text: string }> }>;
      };
      const lines = result.blocks.flatMap((block) => block.lines.map((line) => line.text.trim())).filter(Boolean);
      const selectedLines = selectOcrLines(lines, result.text.trim());

      if (!selectedLines.length) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert("No usable ID found", "Fill the frame with a model, serial, IMEI, UPC, SKU, or asset tag.");
        return;
      }

      await Promise.all(selectedLines.map((line) => sendScan(makeScanItem(line, "ocr", "text"))));
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
  }, [recognizingText, sendScan]);

  const statusLabel = useMemo(() => {
    if (status === "connected") return "Connected to Chrome";
    if (status === "pairing") return "Pairing";
    if (status === "error") return error ?? "Connection error";
    if (status === "disconnected") return "Disconnected";
    return "Scan the extension QR";
  }, [error, status]);

  const value = useMemo<ScannerState>(
    () => ({
      cameraRef,
      captureText,
      connected,
      dictating,
      dictationError,
      dictationTranscript,
      hasManualText: manualText.trim().length > 0,
      manualText,
      onBarcodeScanned,
      pairFromUrl,
      permission,
      recognizingText,
      requestPermission,
      scans,
      sendManualText,
      setManualText,
      startDictation,
      setTorch,
      status,
      statusLabel,
      stopDictation,
      torch,
    }),
    [
      captureText,
      connected,
      dictating,
      dictationError,
      dictationTranscript,
      manualText,
      onBarcodeScanned,
      pairFromUrl,
      permission,
      recognizingText,
      requestPermission,
      scans,
      sendManualText,
      startDictation,
      status,
      statusLabel,
      stopDictation,
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
