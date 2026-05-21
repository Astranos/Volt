import { Ionicons } from "@expo/vector-icons";
import { decode as base64Decode, encode as base64Encode } from "base-64";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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

type ScanItem = BarcodeMessage & {
  id: string;
};

const barcodeTypes = [
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

export default function VoltScanner() {
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

        if (!pc.localDescription) {
          throw new Error("Failed to create answer");
        }

        if (sessionId) {
          const answerResponse = await fetch(`${SCANNER_SIGNAL_URL}/${sessionId}/answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answer: JSON.stringify(pc.localDescription) }),
          });

          if (!answerResponse.ok) {
            throw new Error("Failed to send pairing answer");
          }

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
        if (!offerResponse.ok) {
          throw new Error("Pairing session not found");
        }

        const { offer } = await offerResponse.json();
        if (typeof offer !== "string" || !offer) {
          throw new Error("Invalid pairing session");
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
    Linking.getInitialURL().then((url) => {
      const offer = url ? getOfferFromUrl(url) : undefined;
      const session = url ? getSessionFromUrl(url) : undefined;
      if (offer) pairWithOffer(offer);
      else if (session) pairWithSession(session);
    });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      const offer = getOfferFromUrl(url);
      const session = getSessionFromUrl(url);
      if (offer) pairWithOffer(offer);
      else if (session) pairWithSession(session);
    });

    return () => {
      subscription.remove();
      closeConnection();
    };
  }, [closeConnection, pairWithOffer, pairWithSession]);

  const sendScan = useCallback(
    async (item: ScanItem) => {
      setScans((current) => [item, ...current].slice(0, 50));

      if (channelRef.current?.readyState === "open") {
        channelRef.current.send(encodeBarcodeMessage(item));
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    },
    []
  );

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
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.75,
        skipProcessing: true,
      });
      const TextRecognition = require("@react-native-ml-kit/text-recognition").default;
      const result = await TextRecognition.recognize(photo.uri) as {
        text: string;
        blocks: Array<{ lines: Array<{ text: string }> }>;
      };
      const lines = result.blocks
        .flatMap((block) => block.lines.map((line) => line.text.trim()))
        .filter(Boolean);
      const uniqueLines = Array.from(new Set(lines.length ? lines : [result.text.trim()].filter(Boolean)));

      if (!uniqueLines.length) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert("No text found", "Try filling the frame with the model or serial label.");
        return;
      }

      await Promise.all(
        uniqueLines.slice(0, 8).map((line) => sendScan(makeScanItem(line, "ocr", "text")))
      );
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

  if (!permission) {
    return <View style={styles.root} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.root}>
        <StatusBar style="light" />
        <View style={styles.permissionPanel}>
          <Ionicons name="camera-outline" size={44} color="#22c55e" />
          <Text style={styles.title}>Volt</Text>
          <Text style={styles.bodyText}>
            Camera access is needed to scan UPC, EAN, QR, Code 128, model labels, and serial labels.
          </Text>
          <Pressable style={styles.primaryButton} onPress={requestPermission}>
            <Text style={styles.primaryButtonText}>Allow Camera</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Volt</Text>
            <Text style={styles.status}>{statusLabel}</Text>
          </View>
          <Pressable style={styles.iconButton} onPress={() => setTorch((value) => !value)}>
            <Ionicons name={torch ? "flash" : "flash-outline"} size={20} color="#fafaf9" />
          </Pressable>
        </View>

        <View style={styles.content}>
          <View style={styles.cameraShell}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: [...barcodeTypes] }}
              onBarcodeScanned={connected ? onBarcodeScanned : undefined}
            />
            <View style={styles.scanFrame} pointerEvents="none" />
          </View>

          <ScrollView style={styles.history} contentContainerStyle={styles.historyContent}>
            {scans.map((scan) => (
              <View key={scan.id} style={styles.scanRow}>
                <View style={styles.scanTextBlock}>
                  <Text numberOfLines={1} style={styles.scanValue}>{scan.barcode}</Text>
                  <Text style={styles.scanMeta}>{scan.kind} • {scan.format}</Text>
                </View>
                <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={styles.bottomControls}>
          {answerCode && status !== "connected" ? (
            <Pressable style={styles.answerPanel} onPress={copyAnswer}>
              <Text style={styles.answerTitle}>Answer code ready</Text>
              <Text numberOfLines={2} style={styles.answerText}>{answerCode}</Text>
              <Text style={styles.answerHint}>Tap to copy</Text>
            </Pressable>
          ) : null}

          <Pressable
            style={[styles.ocrButton, recognizingText && styles.disabled]}
            onPress={captureText}
            disabled={recognizingText}
          >
            {recognizingText ? (
              <Text style={styles.ocrButtonText}>Reading text...</Text>
            ) : (
              <>
                <Ionicons name="text" size={18} color="#166534" />
                <Text style={styles.ocrButtonText}>Read model or serial text</Text>
              </>
            )}
          </Pressable>

          <View style={styles.controls}>
            <TextInput
              value={manualText}
              onChangeText={setManualText}
              placeholder="Model, serial, IMEI, asset tag..."
              placeholderTextColor="#78716c"
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.input}
              returnKeyType="send"
              onSubmitEditing={sendManualText}
            />
            <Pressable style={[styles.sendButton, !manualText.trim() && styles.disabled]} onPress={sendManualText}>
              <Ionicons name="send" size={18} color="#f0fdf4" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  header: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1c1917",
    borderBottomWidth: 1,
    borderBottomColor: "#292524",
  },
  title: { color: "#fafaf9", fontSize: 28, fontWeight: "800", letterSpacing: 0 },
  status: { color: "#d6d3d1", marginTop: 2, fontSize: 13 },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#292524",
    borderWidth: 1,
    borderColor: "#44403c",
  },
  content: {
    flex: 1,
    paddingTop: 14,
  },
  cameraShell: {
    marginHorizontal: 18,
    aspectRatio: 1,
    borderRadius: 32,
    overflow: "hidden",
    backgroundColor: "#1c1917",
    borderWidth: 1,
    borderColor: "#292524",
  },
  camera: { flex: 1 },
  scanFrame: {
    position: "absolute",
    left: "13%",
    top: "13%",
    width: "74%",
    height: "74%",
    borderWidth: 2,
    borderColor: "#22c55e",
    borderRadius: 999,
  },
  controls: {
    flexDirection: "row",
    gap: 10,
  },
  input: {
    flex: 1,
    minHeight: 46,
    borderRadius: 999,
    paddingHorizontal: 16,
    color: "#1c1917",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d6d3d1",
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16a34a",
  },
  disabled: { opacity: 0.45 },
  bottomControls: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 10,
    backgroundColor: "#fafaf9",
    borderTopWidth: 1,
    borderTopColor: "#e7e5e4",
  },
  ocrButton: {
    minHeight: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  ocrButtonText: { color: "#166534", fontWeight: "700" },
  answerPanel: {
    padding: 12,
    borderRadius: 24,
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  answerTitle: { color: "#166534", fontWeight: "700", marginBottom: 4 },
  answerText: { color: "#14532d", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11 },
  answerHint: { color: "#16a34a", marginTop: 6, fontSize: 12 },
  history: { flex: 1, marginTop: 12 },
  historyContent: { paddingHorizontal: 18, paddingBottom: 18, gap: 8 },
  scanRow: {
    minHeight: 54,
    borderRadius: 27,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fafaf9",
    borderWidth: 1,
    borderColor: "#e7e5e4",
  },
  scanTextBlock: { flex: 1, paddingRight: 12 },
  scanValue: { color: "#1c1917", fontSize: 15, fontWeight: "700" },
  scanMeta: { color: "#78716c", fontSize: 12, marginTop: 2, textTransform: "uppercase" },
  permissionPanel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 14,
  },
  bodyText: { color: "#57534e", textAlign: "center", lineHeight: 20 },
  primaryButton: {
    minHeight: 46,
    paddingHorizontal: 18,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16a34a",
  },
  primaryButtonText: { color: "#f0fdf4", fontWeight: "800" },
});
