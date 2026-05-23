import { Ionicons } from "@expo/vector-icons";
import { CameraView, type BarcodeScanningResult } from "expo-camera";
import { useFocusEffect } from "expo-router";
import { Image, Platform, Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { useCallback, useRef, useState } from "react";
import { useScanner } from "../../lib/scanner-state";
import { Header, PairingPanel, ScreenRoot, StartCameraOverlay, TorchButton, styles } from "./index";

const floatingBottom = Platform.select({ ios: 94, default: 86 });
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

export default function PhotosTab() {
  const scanner = useScanner();
  const [pairScannerOpen, setPairScannerOpen] = useState(false);
  const [pairScannerLocked, setPairScannerLocked] = useState(false);
  const [pairScannerError, setPairScannerError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraZoom, setCameraZoom] = useState(0);
  const pairScannerLockedRef = useRef(false);
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
      };
    }, [scanner.setTorch])
  );

  const handleCameraTouchStart = useCallback(
    (event: GestureResponderEvent) => {
      const distance = touchDistance(event);
      if (distance == null) return;
      pinchStartDistanceRef.current = distance;
      pinchStartZoomRef.current = cameraZoom;
    },
    [cameraZoom]
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
              Camera access is needed to take photos for the paired Chrome extension.
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
        <View style={[styles.content, localStyles.photoContent]}>
          <View style={styles.cameraShell}>
            {cameraActive ? (
              <>
                <CameraView
                  ref={scanner.cameraRef}
                  style={styles.camera}
                  facing="back"
                  enableTorch={scanner.torch}
                  zoom={cameraZoom}
                  onTouchStart={handleCameraTouchStart}
                  onTouchMove={handleCameraTouchMove}
                  onTouchEnd={handleCameraTouchEnd}
                />
                <View style={styles.zoomControls}>
                  <Pressable
                    accessibilityLabel="Zoom photo camera out"
                    accessibilityRole="button"
                    style={styles.zoomButton}
                    onPress={() => setCameraZoom((value) => clampZoom(value - zoomStep))}
                  >
                    <Ionicons name="remove" size={18} color="#fafaf9" />
                  </Pressable>
                  <Text style={styles.zoomText}>{Math.round(cameraZoom * 100)}%</Text>
                  <Pressable
                    accessibilityLabel="Zoom photo camera in"
                    accessibilityRole="button"
                    style={styles.zoomButton}
                    onPress={() => setCameraZoom((value) => clampZoom(value + zoomStep))}
                  >
                    <Ionicons name="add" size={18} color="#fafaf9" />
                  </Pressable>
                </View>
                <TorchButton />
              </>
            ) : null}
            {!cameraActive ? <StartCameraOverlay onPress={() => setCameraActive(true)} /> : null}
          </View>

          <View style={[styles.bottomControls, { bottom: floatingBottom }]}>
            <View style={localStyles.statusPanel}>
              <Ionicons name="images-outline" size={18} color={scanner.photoError ? "#dc2626" : "#16a34a"} />
              <View style={localStyles.statusTextGroup}>
                <Text style={localStyles.statusTitle}>
                  {scanner.photoSending ? "Sending photo" : "Ready for photos"}
                </Text>
                <Text numberOfLines={1} style={localStyles.statusValue}>
                  {scanner.photoError ?? "Photos transfer directly to the Chrome sidepanel"}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityLabel="Take and send photo"
              accessibilityRole="button"
              disabled={!cameraActive || scanner.photoSending}
              onPress={scanner.sendPhotoCapture}
              style={[localStyles.captureButton, (!cameraActive || scanner.photoSending) && styles.disabled]}
            >
              <Ionicons name={scanner.photoSending ? "hourglass-outline" : "camera"} size={22} color="#f0fdf4" />
              <Text style={localStyles.captureButtonText}>
                {scanner.photoSending ? "Sending" : "Photo"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ScreenRoot>
  );
}

const localStyles = {
  photoContent: {
    paddingBottom: floatingBottom + 140,
  },
  statusPanel: {
    minHeight: 54,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: "#fafaf9",
    borderWidth: 1,
    borderColor: "#e7e5e4",
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
  },
  statusTextGroup: { flex: 1 },
  statusTitle: { color: "#1c1917", fontSize: 13, fontWeight: "800" as const },
  statusValue: { color: "#78716c", fontSize: 13, marginTop: 2 },
  captureButton: {
    height: 58,
    borderRadius: 29,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    flexDirection: "row" as const,
    gap: 8,
    backgroundColor: "#16a34a",
    shadowColor: "#15803d",
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  captureButtonText: { color: "#f0fdf4", fontSize: 17, fontWeight: "800" as const },
};
