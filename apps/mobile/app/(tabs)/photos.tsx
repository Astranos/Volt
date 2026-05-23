import { Ionicons } from "@expo/vector-icons";
import { CameraView, type BarcodeScanningResult } from "expo-camera";
import { useFocusEffect } from "expo-router";
import { Image, Pressable, Text, View, type GestureResponderEvent } from "react-native";
import { useCallback, useRef, useState } from "react";
import { useScanner } from "../../lib/scanner-state";
import { Header, PairingPanel, ScreenRoot, StartCameraOverlay, styles } from "./index";

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
  const [focusMode, setFocusMode] = useState<"on" | "off">("off");
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [gridVisible, setGridVisible] = useState(true);
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
        setFocusMode("off");
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
      if (distance == null) {
        triggerFocus(event);
        return;
      }
      pinchStartDistanceRef.current = distance;
      pinchStartZoomRef.current = cameraZoom;
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
          <View style={[styles.cameraShell, localStyles.photoCameraShell]}>
            {cameraActive ? (
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
                {gridVisible ? <PhotoGridOverlay /> : null}
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

                <View style={localStyles.viewfinderTopRight}>
                  <Pressable
                    accessibilityLabel={scanner.torch ? "Turn flash off" : "Turn flash on"}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={[localStyles.overlayButton, scanner.torch && localStyles.overlayButtonActive]}
                    onPress={() => scanner.setTorch((value) => !value)}
                  >
                    <Ionicons
                      name={scanner.torch ? "flash" : "flash-outline"}
                      size={22}
                      color={scanner.torch ? "#facc15" : "#fafaf9"}
                    />
                  </Pressable>
                  <Pressable
                    accessibilityLabel={gridVisible ? "Hide photo grid" : "Show photo grid"}
                    accessibilityRole="button"
                    hitSlop={8}
                    style={[localStyles.overlayButton, gridVisible && localStyles.overlayButtonActive]}
                    onPress={() => setGridVisible((value) => !value)}
                  >
                    <Ionicons
                      name={gridVisible ? "grid" : "grid-outline"}
                      size={20}
                      color={gridVisible ? "#86efac" : "#fafaf9"}
                    />
                  </Pressable>
                </View>

                <View style={localStyles.viewfinderZoomBar} pointerEvents="box-none">
                  <View style={localStyles.zoomPill}>
                    <Pressable
                      accessibilityLabel="Zoom photo camera out"
                      accessibilityRole="button"
                      hitSlop={6}
                      style={localStyles.zoomPillButton}
                      onPress={() => setCameraZoom((value) => clampZoom(value - zoomStep))}
                    >
                      <Ionicons name="remove" size={20} color="#fafaf9" />
                    </Pressable>
                    <Text style={localStyles.zoomPillText}>{`${(1 + cameraZoom * 4).toFixed(1)}x`}</Text>
                    <Pressable
                      accessibilityLabel="Zoom photo camera in"
                      accessibilityRole="button"
                      hitSlop={6}
                      style={localStyles.zoomPillButton}
                      onPress={() => setCameraZoom((value) => clampZoom(value + zoomStep))}
                    >
                      <Ionicons name="add" size={20} color="#fafaf9" />
                    </Pressable>
                  </View>
                </View>
              </>
            ) : null}
            {!cameraActive ? <StartCameraOverlay onPress={() => setCameraActive(true)} /> : null}
          </View>

          <View style={localStyles.photoControls}>
            <View
              style={[
                localStyles.statusPill,
                scanner.photoError && localStyles.statusPillError,
                scanner.photoSending && localStyles.statusPillActive,
              ]}
            >
              <View
                style={[
                  localStyles.statusDot,
                  scanner.photoError && localStyles.statusDotError,
                  scanner.photoSending && localStyles.statusDotActive,
                ]}
              />
              <Text numberOfLines={1} style={localStyles.statusPillText}>
                {scanner.photoError
                  ? scanner.photoError
                  : scanner.photoSending
                    ? "Sending photo…"
                    : cameraActive
                      ? "Tap shutter to send to Chrome"
                      : "Tap Start to activate camera"}
              </Text>
            </View>

            <Pressable
              accessibilityLabel="Take and send photo"
              accessibilityRole="button"
              disabled={!cameraActive || scanner.photoSending}
              onPress={scanner.sendPhotoCapture}
              style={({ pressed }) => [
                localStyles.shutterRing,
                (!cameraActive || scanner.photoSending) && styles.disabled,
                pressed && cameraActive && !scanner.photoSending && localStyles.shutterRingPressed,
              ]}
            >
              <View
                style={[
                  localStyles.shutterCore,
                  scanner.photoSending && localStyles.shutterCoreBusy,
                ]}
              >
                <Ionicons
                  name={scanner.photoSending ? "hourglass-outline" : "camera"}
                  size={28}
                  color="#f0fdf4"
                />
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    </ScreenRoot>
  );
}

function PhotoGridOverlay() {
  return (
    <View pointerEvents="none" style={localStyles.gridOverlay}>
      <View style={[localStyles.gridLineVertical, { left: "33.333%" }]} />
      <View style={[localStyles.gridLineVertical, { left: "66.666%" }]} />
      <View style={[localStyles.gridLineHorizontal, { top: "33.333%" }]} />
      <View style={[localStyles.gridLineHorizontal, { top: "66.666%" }]} />
    </View>
  );
}

const localStyles = {
  photoContent: {
    paddingTop: 18,
    paddingBottom: 18,
    justifyContent: "flex-start" as const,
  },
  photoCameraShell: {
    flex: 0,
    aspectRatio: 1,
    width: "auto" as const,
  },
  viewfinderTopRight: {
    position: "absolute" as const,
    top: 12,
    right: 12,
    flexDirection: "column" as const,
    gap: 10,
  },
  overlayButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "rgba(28, 25, 23, 0.55)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.14)",
  },
  overlayButtonActive: {
    backgroundColor: "rgba(28, 25, 23, 0.82)",
    borderColor: "rgba(250, 250, 249, 0.32)",
  },
  viewfinderZoomBar: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    bottom: 14,
    alignItems: "center" as const,
  },
  zoomPill: {
    minHeight: 44,
    paddingHorizontal: 6,
    borderRadius: 999,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    backgroundColor: "rgba(28, 25, 23, 0.62)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.14)",
  },
  zoomPillButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  zoomPillText: {
    minWidth: 44,
    color: "#fafaf9",
    fontSize: 14,
    fontWeight: "800" as const,
    textAlign: "center" as const,
  },
  gridOverlay: {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  gridLineVertical: {
    position: "absolute" as const,
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "rgba(28, 25, 23, 0.45)",
  },
  gridLineHorizontal: {
    position: "absolute" as const,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(28, 25, 23, 0.45)",
  },
  photoControls: {
    marginTop: 22,
    marginHorizontal: 18,
    alignItems: "center" as const,
    gap: 20,
  },
  statusPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "#f5f5f4",
    borderWidth: 1,
    borderColor: "#e7e5e4",
    maxWidth: "100%" as const,
  },
  statusPillActive: {
    backgroundColor: "#fef3c7",
    borderColor: "#fde68a",
  },
  statusPillError: {
    backgroundColor: "#fee2e2",
    borderColor: "#fecaca",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#22c55e",
  },
  statusDotActive: {
    backgroundColor: "#f59e0b",
  },
  statusDotError: {
    backgroundColor: "#dc2626",
  },
  statusPillText: {
    color: "#1c1917",
    fontSize: 13,
    fontWeight: "600" as const,
    flexShrink: 1 as const,
  },
  shutterRing: {
    width: 82,
    height: 82,
    borderRadius: 41,
    padding: 5,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "transparent",
    borderWidth: 4,
    borderColor: "#1c1917",
  },
  shutterRingPressed: {
    transform: [{ scale: 0.96 }],
  },
  shutterCore: {
    flex: 1,
    width: "100%" as const,
    borderRadius: 999,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "#16a34a",
    shadowColor: "#15803d",
    shadowOpacity: 0.32,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  shutterCoreBusy: {
    backgroundColor: "#15803d",
  },
};
