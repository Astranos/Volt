import { Ionicons } from "@expo/vector-icons";
import { CameraView, type BarcodeScanningResult } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { Image, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useRef, useState } from "react";
import { useScanner } from "../scanner-state";

const baseFloatingBottom = Platform.select({ ios: 94, default: 86 });
const keyboardFloatingGap = 10;
const continuousCorners = Platform.select({ ios: { borderCurve: "continuous" as const }, default: null });

export default function OcrTab() {
  const scanner = useScanner();
  const [pairScannerOpen, setPairScannerOpen] = useState(false);
  const [pairScannerLocked, setPairScannerLocked] = useState(false);
  const [pairScannerError, setPairScannerError] = useState<string | null>(null);
  const pairScannerLockedRef = useRef(false);

  const openPairScanner = async () => {
    if (!scanner.permission?.granted) {
      const nextPermission = await scanner.requestPermission();
      if (!nextPermission.granted) {
        setPairScannerError("Camera permission is required to scan the extension QR.");
        return;
      }
    }

    setPairScannerError(null);
    setPairScannerLocked(false);
    pairScannerLockedRef.current = false;
    setPairScannerOpen(true);
  };

  const onPairingQrScanned = async ({ data }: BarcodeScanningResult) => {
    if (pairScannerLockedRef.current) return;

    pairScannerLockedRef.current = true;
    setPairScannerLocked(true);
    const accepted = await scanner.pairFromUrl(data.trim());

    if (accepted) {
      setPairScannerOpen(false);
      setPairScannerError(null);
      return;
    }

    setPairScannerError("That QR code is not a Volt pairing code.");
    setTimeout(() => {
      pairScannerLockedRef.current = false;
      setPairScannerLocked(false);
    }, 1200);
  };

  if (!scanner.connected) {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={styles.scannerRoot}>
        <StatusBar style="light" backgroundColor="#1c1917" />
        <Header />
        <View style={styles.page}>
          <View style={styles.content}>
            {pairScannerOpen ? (
              <View style={styles.cameraShell}>
                <CameraView
                  style={styles.camera}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={pairScannerLocked ? undefined : onPairingQrScanned}
                />
                <View style={styles.pairingScanOverlay} pointerEvents="none">
                  <View style={styles.pairingScanFrame} />
                </View>
                <Pressable
                  style={styles.pairingCloseButton}
                  onPress={() => {
                    pairScannerLockedRef.current = false;
                    setPairScannerLocked(false);
                    setPairScannerOpen(false);
                  }}
                >
                  <Ionicons name="close" size={18} color="#fafaf9" />
                </Pressable>
              </View>
            ) : (
              <PairingPanel
                error={pairScannerError}
                onOpenScanner={openPairScanner}
                statusLabel={scanner.statusLabel}
              />
            )}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!scanner.permission) return <View style={styles.root} />;

  if (!scanner.permission.granted) {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={styles.root}>
        <StatusBar style="light" />
        <View style={styles.permissionPanel}>
          <Image source={require("../../assets/volt-logo.png")} style={styles.permissionLogo} resizeMode="contain" />
          <Text style={styles.bodyText}>
            Camera access is needed to read labels and capture barcodes from a still image.
          </Text>
          <Pressable style={styles.primaryButton} onPress={scanner.requestPermission}>
            <Text style={styles.primaryButtonText}>Allow Camera</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.scannerRoot}>
      <StatusBar style="light" backgroundColor="#1c1917" />
      <Header />
      <View style={styles.page}>
        <View style={styles.content}>
          <View style={styles.cameraShell}>
            <CameraView
              ref={scanner.cameraRef}
              style={styles.camera}
              facing="back"
              enableTorch={scanner.torch}
            />
            <View style={styles.scanFrame} pointerEvents="none" />
          </View>
        </View>
        <BottomControls />
      </View>
    </SafeAreaView>
  );
}

export function PairingPanel({
  error,
  onOpenScanner,
  statusLabel,
}: {
  error: string | null;
  onOpenScanner: () => void;
  statusLabel: string;
}) {
  return (
    <View style={styles.pairingShell}>
      <View style={styles.pairingIcon}>
        <Ionicons name="phone-portrait-outline" size={34} color="#16a34a" />
      </View>
      <Text style={styles.pairingTitle}>{statusLabel}</Text>
      <Text style={styles.pairingText}>
        Open the Volt Chrome extension, choose Mobile Scanner, then scan its QR code here.
      </Text>
      {error ? <Text style={styles.pairingError}>{error}</Text> : null}
      <Pressable style={styles.primaryButton} onPress={onOpenScanner}>
        <Ionicons name="qr-code-outline" size={18} color="#f0fdf4" />
        <Text style={styles.primaryButtonText}>Scan extension QR</Text>
      </Pressable>
    </View>
  );
}

export function Header() {
  const { connected, setTorch, statusLabel, torch } = useScanner();

  return (
    <View style={styles.header}>
      <View style={styles.headerBrand}>
        <Image source={require("../../assets/volt-logo.png")} style={styles.headerLogo} resizeMode="contain" />
        <Text style={styles.status}>{statusLabel}</Text>
      </View>
      {connected ? (
        <Pressable style={styles.iconButton} onPress={() => setTorch((value) => !value)}>
          <Ionicons name={torch ? "flash" : "flash-outline"} size={20} color="#fafaf9" />
        </Pressable>
      ) : null}
    </View>
  );
}

export function BottomControls() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const {
    captureText,
    hasManualText,
    manualText,
    recognizingText,
    sendManualText,
    setManualText,
  } = useScanner();

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(Math.max(0, event.endCoordinates.height));
    });
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const floatingBottom = keyboardHeight ? keyboardHeight + keyboardFloatingGap : baseFloatingBottom;

  return (
    <View style={[styles.bottomControls, { bottom: floatingBottom }]}>
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
        <Pressable
          accessibilityLabel={hasManualText ? "Send text" : "Capture text"}
          style={[styles.actionButton, recognizingText && !hasManualText && styles.disabled]}
          onPress={hasManualText ? sendManualText : captureText}
          disabled={!hasManualText && recognizingText}
        >
          <Ionicons name={hasManualText ? "send" : "camera"} size={hasManualText ? 18 : 21} color="#f0fdf4" />
        </Pressable>
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  scannerRoot: { flex: 1, backgroundColor: "#1c1917" },
  header: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1c1917",
  },
  status: { color: "#d6d3d1", marginTop: 2, fontSize: 13 },
  headerBrand: { gap: 3 },
  headerLogo: { width: 32, height: 32 },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#292524",
    borderWidth: 1,
    borderColor: "#44403c",
  },
  page: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    ...continuousCorners,
    overflow: "hidden",
  },
  content: { flex: 1, paddingTop: 18, paddingBottom: 18 },
  cameraShell: {
    marginHorizontal: 18,
    aspectRatio: 1,
    borderRadius: 32,
    ...continuousCorners,
    overflow: "hidden",
    backgroundColor: "#1c1917",
    borderWidth: 1,
    borderColor: "#292524",
  },
  camera: { flex: 1 },
  pairingShell: {
    flex: 1,
    marginHorizontal: 18,
    borderRadius: 32,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "#fafaf9",
    borderWidth: 1,
    borderColor: "#e7e5e4",
  },
  pairingIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  pairingTitle: {
    marginTop: 14,
    color: "#1c1917",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  pairingText: {
    marginTop: 8,
    color: "#78716c",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  pairingError: {
    marginTop: 10,
    color: "#dc2626",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  pairingScanOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(28, 25, 23, 0.18)",
  },
  pairingScanFrame: {
    width: "68%",
    aspectRatio: 1,
    borderWidth: 3,
    borderColor: "#22c55e",
    borderRadius: 28,
    ...continuousCorners,
  },
  pairingCloseButton: {
    position: "absolute",
    right: 12,
    top: 12,
    width: 38,
    height: 38,
    borderRadius: 19,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(28, 25, 23, 0.82)",
  },
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
  controls: { flexDirection: "row", gap: 10 },
  input: {
    flex: 1,
    height: 58,
    borderRadius: 999,
    ...continuousCorners,
    paddingHorizontal: 22,
    color: "#1c1917",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d6d3d1",
    fontSize: 18,
    shadowColor: "#1c1917",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  actionButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16a34a",
    shadowColor: "#15803d",
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  disabled: { opacity: 0.45 },
  bottomControls: {
    position: "absolute",
    left: 18,
    right: 18,
    zIndex: 10,
    gap: 10,
    backgroundColor: "transparent",
  },
  answerPanel: {
    padding: 12,
    borderRadius: 24,
    ...continuousCorners,
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  answerTitle: { color: "#166534", fontWeight: "700", marginBottom: 4 },
  answerText: { color: "#14532d", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11 },
  answerHint: { color: "#16a34a", marginTop: 6, fontSize: 12 },
  permissionPanel: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
  permissionLogo: { width: 72, height: 72, marginBottom: 2 },
  bodyText: { color: "#57534e", textAlign: "center", lineHeight: 20 },
  primaryButton: {
    minHeight: 46,
    paddingHorizontal: 18,
    borderRadius: 999,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#16a34a",
  },
  primaryButtonText: { color: "#f0fdf4", fontWeight: "800" },
});
