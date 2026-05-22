import { decode as base64Decode, encode as base64Encode } from "base-64";
import { useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
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

type ConnectionStatus = "idle" | "pairing" | "answer-ready" | "connected" | "disconnected" | "error";

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
  answerCode: string | null;
  cameraRef: React.MutableRefObject<any>;
  captureText: () => Promise<void>;
  connected: boolean;
  copyAnswer: () => Promise<void>;
  hasManualText: boolean;
  manualText: string;
  onBarcodeScanned: (result: BarcodeScanningResult) => void;
  permission: ReturnType<typeof useCameraPermissions>[0];
  recognizingText: boolean;
  requestPermission: ReturnType<typeof useCameraPermissions>[1];
  scans: ScanItem[];
  sendManualText: () => void;
  setManualText: (value: string) => void;
  setTorch: React.Dispatch<React.SetStateAction<boolean>>;
  status: ConnectionStatus;
  statusLabel: string;
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

function makeScanItem(value: string, format: string, kind: BarcodeMessage["kind"]): ScanItem {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    barcode: value.trim(),
    format,
    kind,
    scannedAt: new Date().toISOString(),
  };
}

export function ScannerProvider({ children }: PropsWithChildren) {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [answerCode, setAnswerCode] = useState<string | null>(null);
  const [manualText, setManualText] = useState("");
  const [scans, setScans] = useState<ScanItem[]>([]);
  const [torch, setTorch] = useState(false);
  const [recognizingText, setRecognizingText] = useState(false);

  const peerRef = useRef<any>(null);
  const channelRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const lastScanRef = useRef<{ value: string; at: number } | null>(null);

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
      setAnswerCode(null);
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
          setAnswerCode(null);
        } else {
          setAnswerCode(encodePairingPayload(pc.localDescription as any));
          setStatus("answer-ready");
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
        const offerResponse = await fetch(`${SCANNER_SIGNAL_URL}/${sessionId}`);
        if (!offerResponse.ok) throw new Error("Pairing session not found");

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
    Linking.getInitialURL().then((url) => {
      const offer = url ? getOfferFromUrl(url) : undefined;
      const session = url ? getSessionFromUrl(url) : undefined;
      if (offer) pairWithOffer(offer, session);
      else if (session) pairWithSession(session);
    });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      const offer = getOfferFromUrl(url);
      const session = getSessionFromUrl(url);
      if (offer) pairWithOffer(offer, session);
      else if (session) pairWithSession(session);
    });

    return () => {
      subscription.remove();
      closeConnection();
    };
  }, [closeConnection, pairWithOffer, pairWithSession]);

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
      const uniqueLines = Array.from(new Set(lines.length ? lines : [result.text.trim()].filter(Boolean)));

      if (!uniqueLines.length) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert("No text found", "Try filling the frame with the model or serial label.");
        return;
      }

      await Promise.all(uniqueLines.slice(0, 8).map((line) => sendScan(makeScanItem(line, "ocr", "text"))));
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

  const copyAnswer = useCallback(async () => {
    if (!answerCode) return;
    await Clipboard.setStringAsync(answerCode);
    Alert.alert("Answer code copied", "Paste it into the Volt extension and tap Connect Phone.");
  }, [answerCode]);

  const statusLabel = useMemo(() => {
    if (status === "connected") return "Connected to Chrome";
    if (status === "answer-ready") return "Paste answer in extension";
    if (status === "pairing") return "Pairing";
    if (status === "error") return error ?? "Connection error";
    if (status === "disconnected") return "Disconnected";
    return "Scan the extension QR";
  }, [error, status]);

  const value = useMemo<ScannerState>(
    () => ({
      answerCode,
      cameraRef,
      captureText,
      connected,
      copyAnswer,
      hasManualText: manualText.trim().length > 0,
      manualText,
      onBarcodeScanned,
      permission,
      recognizingText,
      requestPermission,
      scans,
      sendManualText,
      setManualText,
      setTorch,
      status,
      statusLabel,
      torch,
    }),
    [
      answerCode,
      captureText,
      connected,
      copyAnswer,
      manualText,
      onBarcodeScanned,
      permission,
      recognizingText,
      requestPermission,
      scans,
      sendManualText,
      status,
      statusLabel,
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
