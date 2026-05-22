import { Ionicons } from "@expo/vector-icons";
import { CameraView, type BarcodeScanningResult } from "expo-camera";
import { useFocusEffect } from "expo-router";
import { Image, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View, type GestureResponderEvent } from "react-native";
import { initialWindowMetrics } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { LiveTextImageView } from "../../lib/live-text-image-view";
import { useScanner } from "../../lib/scanner-state";

const baseFloatingBottom = Platform.select({ ios: 94, default: 86 });
const keyboardFloatingGap = 10;
const continuousCorners = Platform.select({ ios: { borderCurve: "continuous" as const }, default: null });
const stableTopInset = initialWindowMetrics?.insets.top ?? 0;
const zoomStep = 0.08;

function clampZoom(value: number) {
  return Math.max(0, Math.min(1, value));
}

function touchDistance(event: GestureResponderEvent) {
  const touches = event.nativeEvent.touches;
  if (touches.length < 2) return null;
  const [first, second] = touches;
  return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
}

export default function OcrTab() {
  const scanner = useScanner();
  const [pairScannerOpen, setPairScannerOpen] = useState(false);
  const [pairScannerLocked, setPairScannerLocked] = useState(false);
  const [pairScannerError, setPairScannerError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraZoom, setCameraZoom] = useState(0);
  const [focusMode, setFocusMode] = useState<"on" | "off">("off");
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const pairScannerLockedRef = useRef(false);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setCameraActive(false);
        setPairScannerOpen(false);
        setPairScannerLocked(false);
        pairScannerLockedRef.current = false;
        scanner.setTorch(false);
        setCameraZoom(0);
        setFocusPoint(null);
        if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      };
    }, [scanner.setTorch])
  );

  const triggerFocus = useCallback((event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    setFocusMode("on");
    setFocusPoint({ x: locationX, y: locationY });
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(() => {
      setFocusMode("off");
      setFocusPoint(null);
    }, 900);
  }, []);

  const handleCameraTouchStart = useCallback(
    (event: GestureResponderEvent) => {
      const distance = touchDistance(event);
      if (distance != null) {
        pinchStartDistanceRef.current = distance;
        pinchStartZoomRef.current = cameraZoom;
        return;
      }
      triggerFocus(event);
    },
    [cameraZoom, triggerFocus]
  );

  const handleCameraTouchMove = useCallback((event: GestureResponderEvent) => {
    const distance = touchDistance(event);
    if (distance == null || pinchStartDistanceRef.current == null) return;
    const delta = (distance - pinchStartDistanceRef.current) / 260;
    setCameraZoom(clampZoom(pinchStartZoomRef.current + delta));
  }, []);

  const handleCameraTouchEnd = useCallback(() => {
    pinchStartDistanceRef.current = null;
  }, []);

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
      <ScreenRoot>
        <Header />
        <View style={[styles.page, styles.disconnectedPage]}>
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
      </ScreenRoot>
    );
  }

  if (!scanner.permission || !scanner.permission.granted) {
    return (
      <ScreenRoot>
        <Header />
        <View style={styles.page}>
          <View style={styles.permissionPanel}>
            <Image source={require("../../assets/volt-logo.png")} style={styles.permissionLogo} resizeMode="contain" />
            <Text style={styles.bodyText}>
              Camera access is needed to read labels and capture barcodes from a still image.
            </Text>
            <Pressable style={styles.primaryButton} onPress={scanner.requestPermission}>
              <Text style={styles.primaryButtonText}>Allow Camera</Text>
            </Pressable>
          </View>
        </View>
      </ScreenRoot>
    );
  }

  return (
    <ScreenRoot>
      <Header />
      <View style={styles.page}>
        <View style={[styles.content, styles.captureContent]}>
          <View style={styles.cameraShell}>
            {scanner.textCapture ? (
              <>
                <LiveTextImageView
                  imageUri={scanner.textCapture.photoUri}
                  style={styles.capturedImage}
                />
                <Pressable
                  accessibilityLabel="Retake text capture"
                  accessibilityRole="button"
                  style={styles.captureRetakeButton}
                  onPress={scanner.clearTextCapture}
                >
                  <Ionicons name="refresh" size={18} color="#fafaf9" />
                </Pressable>
              </>
            ) : cameraActive ? (
              <>
                <CameraView
                  ref={scanner.cameraRef}
                  style={styles.camera}
                  facing="back"
                  enableTorch={scanner.torch}
                  zoom={cameraZoom}
                  autofocus={focusMode}
                  onTouchStart={handleCameraTouchStart}
                  onTouchMove={handleCameraTouchMove}
                  onTouchEnd={handleCameraTouchEnd}
                />
                {focusPoint ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.focusRing,
                      {
                        left: focusPoint.x - 34,
                        top: focusPoint.y - 34,
                      },
                    ]}
                  />
                ) : null}
                <View style={styles.zoomControls}>
                  <Pressable
                    accessibilityLabel="Zoom out"
                    accessibilityRole="button"
                    style={styles.zoomButton}
                    onPress={() => setCameraZoom((value) => clampZoom(value - zoomStep))}
                  >
                    <Ionicons name="remove" size={18} color="#fafaf9" />
                  </Pressable>
                  <Text style={styles.zoomText}>{Math.round(cameraZoom * 100)}%</Text>
                  <Pressable
                    accessibilityLabel="Zoom in"
                    accessibilityRole="button"
                    style={styles.zoomButton}
                    onPress={() => setCameraZoom((value) => clampZoom(value + zoomStep))}
                  >
                    <Ionicons name="add" size={18} color="#fafaf9" />
                  </Pressable>
                </View>
              </>
            ) : null}
            {!cameraActive && !scanner.textCapture ? <StartCameraOverlay onPress={() => setCameraActive(true)} /> : null}
            {cameraActive && !scanner.textCapture ? <TorchButton /> : null}
          </View>
        </View>
        <BottomControls />
      </View>
    </ScreenRoot>
  );
}

export function ScreenRoot({ children }: PropsWithChildren) {
  return <View style={styles.scannerRoot}>{children}</View>;
}

export function StartCameraOverlay({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityLabel="Start camera"
      accessibilityRole="button"
      onPress={onPress}
      style={styles.startCameraOverlay}
    >
      <View style={styles.startCameraButton}>
        <Ionicons name="play" size={22} color="#f0fdf4" />
        <Text style={styles.startCameraText}>Start</Text>
      </View>
    </Pressable>
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
      <Pressable style={[styles.primaryButton, styles.pairingButton]} onPress={onOpenScanner}>
        <Ionicons name="qr-code-outline" size={18} color="#f0fdf4" />
        <Text style={styles.primaryButtonText}>Scan extension QR</Text>
      </Pressable>
    </View>
  );
}

export function Header() {
  const { statusLabel } = useScanner();

  return (
    <View style={styles.header}>
      <View style={styles.headerBrand}>
        <Image source={require("../../assets/volt-logo.png")} style={styles.headerLogo} resizeMode="contain" />
      </View>
      <Text numberOfLines={1} style={styles.status}>{statusLabel}</Text>
    </View>
  );
}

export function TorchButton() {
  const { setTorch, torch } = useScanner();

  return (
    <Pressable
      accessibilityLabel={torch ? "Turn flash off" : "Turn flash on"}
      accessibilityRole="button"
      style={styles.torchButton}
      onPress={() => setTorch((value) => !value)}
    >
      <Ionicons name={torch ? "flash" : "flash-outline"} size={20} color="#fafaf9" />
    </Pressable>
  );
}

export function BottomControls() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const {
    captureText,
    clearTextCapture,
    hasManualText,
    manualText,
    recognizingText,
    sendManualText,
    setManualText,
    textCapture,
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

  const actionPress = hasManualText ? sendManualText : textCapture ? clearTextCapture : captureText;
  const actionDisabled = !hasManualText && !textCapture && recognizingText;
  const actionIcon = hasManualText ? "send" : textCapture ? "refresh" : "camera";

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
          style={[styles.actionButton, actionDisabled && styles.disabled]}
          onPress={actionPress}
          disabled={actionDisabled}
        >
          <Ionicons name={actionIcon} size={hasManualText ? 18 : 21} color="#f0fdf4" />
        </Pressable>
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  scannerRoot: { flex: 1, paddingTop: stableTopInset, backgroundColor: "#1c1917" },
  header: {
    height: 70,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1c1917",
  },
  status: { color: "#d6d3d1", marginLeft: 14, fontSize: 13, lineHeight: 16, maxWidth: 250, textAlign: "right" },
  headerBrand: { height: 51, justifyContent: "center" },
  headerLogo: { width: 32, height: 32 },
  torchButton: {
    position: "absolute",
    right: 12,
    bottom: 12,
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
  disconnectedPage: {
    paddingBottom: 104,
  },
  content: { flex: 1, paddingTop: 18, paddingBottom: 18 },
  captureContent: { paddingBottom: 178 },
  cameraShell: {
    flex: 1,
    marginHorizontal: 18,
    borderRadius: 32,
    ...continuousCorners,
    overflow: "hidden",
    backgroundColor: "#1c1917",
    borderWidth: 1,
    borderColor: "#292524",
  },
  camera: { flex: 1 },
  capturedImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    backgroundColor: "#1c1917",
  },
  focusRing: {
    position: "absolute",
    width: 68,
    height: 68,
    borderRadius: 34,
    ...continuousCorners,
    borderWidth: 2,
    borderColor: "#f0fdf4",
    backgroundColor: "rgba(240, 253, 244, 0.08)",
  },
  zoomControls: {
    position: "absolute",
    left: 12,
    bottom: 12,
    minHeight: 42,
    borderRadius: 999,
    ...continuousCorners,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    backgroundColor: "rgba(28, 25, 23, 0.82)",
    borderWidth: 1,
    borderColor: "#44403c",
  },
  zoomButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#292524",
  },
  zoomText: {
    minWidth: 38,
    color: "#fafaf9",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  captureRetakeButton: {
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
  startCameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(28, 25, 23, 0.68)",
  },
  startCameraButton: {
    minHeight: 54,
    paddingHorizontal: 22,
    borderRadius: 999,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#16a34a",
  },
  startCameraText: { color: "#f0fdf4", fontSize: 17, fontWeight: "800" },
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
  pairingButton: {
    marginTop: 22,
  },
  primaryButtonText: { color: "#f0fdf4", fontWeight: "800" },
});
