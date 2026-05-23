import { Ionicons } from "@expo/vector-icons";
import { CameraView as ExpoCameraView, type BarcodeScanningResult } from "expo-camera";
import { useFocusEffect } from "expo-router";
import {
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";
import { useCallback, useEffect, useRef, useState, type ComponentType, type PropsWithChildren, type ReactNode } from "react";
import { LiveTextImageView } from "../../lib/live-text-image-view";
import { useScanner } from "../../lib/scanner-state";

const baseFloatingBottom = Platform.select({ ios: 94, default: 86 });
const CameraView = ExpoCameraView as unknown as ComponentType<any>;
const continuousCorners = Platform.select({ ios: { borderCurve: "continuous" as const }, default: null });
const absoluteFillObject = { position: "absolute" as const, top: 0, right: 0, bottom: 0, left: 0 };
const stableTopInset = initialWindowMetrics?.insets.top ?? 0;
const zoomStep = 0.08;
const captureZoomStep = 0.25;

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
  const insets = useSafeAreaInsets();
  const [pairScannerOpen, setPairScannerOpen] = useState(false);
  const [pairScannerLocked, setPairScannerLocked] = useState(false);
  const [pairScannerError, setPairScannerError] = useState<string | null>(null);
  const [viewfinderFocused, setViewfinderFocused] = useState(false);
  const [capturedViewportSize, setCapturedViewportSize] = useState<{ width: number; height: number } | null>(null);
  const [showTextPrompt, setShowTextPrompt] = useState(false);
  const pairScannerLockedRef = useRef(false);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capturedScrollRef = useRef<ScrollView | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      setViewfinderFocused(true);
      return () => {
        setViewfinderFocused(false);
        setPairScannerOpen(false);
        setPairScannerLocked(false);
        pairScannerLockedRef.current = false;
        scanner.clearCameraFocus();
        if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      };
    }, [scanner.clearCameraFocus])
  );

  const triggerFocus = useCallback((event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    scanner.setFocusMode("off");
    scanner.setFocusPoint({ x: locationX, y: locationY });
    requestAnimationFrame(() => scanner.setFocusMode("on"));
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(scanner.clearCameraFocus, 900);
  }, [scanner]);

  const handleCameraTouchStart = useCallback(
    (event: GestureResponderEvent) => {
      const distance = touchDistance(event);
      if (distance != null) {
        pinchStartDistanceRef.current = distance;
        pinchStartZoomRef.current = scanner.cameraZoom;
        return;
      }
      triggerFocus(event);
    },
    [scanner.cameraZoom, triggerFocus]
  );

  const handleCameraTouchMove = useCallback((event: GestureResponderEvent) => {
    const distance = touchDistance(event);
    if (distance == null || pinchStartDistanceRef.current == null) return;
    const delta = (distance - pinchStartDistanceRef.current) / 260;
    scanner.setCameraZoom(clampZoom(pinchStartZoomRef.current + delta));
  }, [scanner]);

  const handleCameraTouchEnd = useCallback(() => {
    pinchStartDistanceRef.current = null;
  }, []);

  const floatingBottom = Math.max(baseFloatingBottom, insets.bottom + 74);

  useEffect(() => {
    if (!scanner.textCapture) {
      setShowTextPrompt(false);
      return;
    }

    setShowTextPrompt(true);
    const timer = setTimeout(() => setShowTextPrompt(false), 4200);
    return () => clearTimeout(timer);
  }, [scanner.textCapture?.photoUri]);

  const handleCapturedViewportLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCapturedViewportSize({ width, height });
  }, []);

  const handleCapturedZoomScroll = useCallback((event: { nativeEvent: { zoomScale?: number } }) => {
    const nextZoom = event.nativeEvent.zoomScale;
    if (typeof nextZoom === "number" && Number.isFinite(nextZoom)) {
      scanner.setCaptureZoom(Math.max(1, Math.min(4, nextZoom)));
    }
  }, [scanner]);

  const setCapturedImageZoom = useCallback(
    (zoom: number) => {
      const nextZoom = Math.max(1, Math.min(4, zoom));
      scanner.setCaptureZoom(nextZoom);

      if (Platform.OS !== "ios" || !capturedViewportSize) return;

      const width = capturedViewportSize.width / nextZoom;
      const height = capturedViewportSize.height / nextZoom;
      const responder = (capturedScrollRef.current as any)?.getScrollResponder?.();
      responder?.scrollResponderZoomTo?.({
        animated: true,
        height,
        width,
        x: (capturedViewportSize.width - width) / 2,
        y: (capturedViewportSize.height - height) / 2,
      });
    },
    [capturedViewportSize, scanner]
  );

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
        <View style={styles.page}>
          <DisconnectedPairingView
            error={pairScannerError}
            pairingActive={pairScannerOpen || !!scanner.permission?.granted}
            pairingLocked={pairScannerLocked}
            onOpenScanner={openPairScanner}
            onPairingQrScanned={onPairingQrScanned}
          />
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
        <ViewfinderSurface>
            {scanner.textCapture ? (
              <View style={styles.capturedImageViewport} onLayout={handleCapturedViewportLayout}>
                <ScrollView
                  ref={capturedScrollRef}
                  bouncesZoom
                  centerContent
                  contentContainerStyle={[
                    styles.capturedImageZoomContent,
                    capturedViewportSize ?? undefined,
                  ]}
                  maximumZoomScale={4}
                  minimumZoomScale={1}
                  onScroll={handleCapturedZoomScroll}
                  pinchGestureEnabled
                  scrollEventThrottle={16}
                  showsHorizontalScrollIndicator={false}
                  showsVerticalScrollIndicator={false}
                  style={styles.capturedImageScroll}
                >
                  <LiveTextImageView
                    imageUri={scanner.textCapture.photoUri}
                    style={[
                      styles.capturedImage,
                      capturedViewportSize ?? styles.capturedImageFallbackSize,
                    ]}
                  />
                </ScrollView>
                {showTextPrompt ? (
                  <View pointerEvents="none" style={styles.ocrCopyPrompt}>
                    <Ionicons name="copy-outline" size={14} color="#bbf7d0" />
                    <Text numberOfLines={1} style={styles.ocrCopyPromptText}>
                      Select text and click Copy to send to browser
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <>
                {viewfinderFocused ? (
                  <CameraView
                    ref={scanner.cameraRef}
                    style={styles.camera}
                    facing="back"
                    enableTorch={scanner.torch}
                    zoom={scanner.cameraZoom}
                    autofocus={scanner.focusMode}
                    onTouchStart={handleCameraTouchStart}
                    onTouchMove={handleCameraTouchMove}
                    onTouchEnd={handleCameraTouchEnd}
                  />
                ) : null}
                {scanner.focusPoint ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.focusRing,
                      {
                        left: scanner.focusPoint.x - 34,
                        top: scanner.focusPoint.y - 34,
                      },
                    ]}
                  />
                ) : null}
                <PhotoNegativeOverlay>
                  <ViewfinderTopRightControls>
                    <CameraOverlayButton
                      active={scanner.torch}
                      accessibilityLabel={scanner.torch ? "Turn flash off" : "Turn flash on"}
                      onPress={() => scanner.setTorch((value) => !value)}
                    >
                      <Ionicons
                        name={scanner.torch ? "flash" : "flash-outline"}
                        size={22}
                        color={scanner.torch ? "#facc15" : "#fafaf9"}
                      />
                    </CameraOverlayButton>
                    <CursorInsertButton
                      active={scanner.settings.ocrInsertIntoCursor}
                      accessibilityLabel={
                        scanner.settings.ocrInsertIntoCursor
                          ? "Send OCR text to cursor"
                          : "Send OCR text to results"
                      }
                      onPress={() => scanner.setSetting("ocrInsertIntoCursor", !scanner.settings.ocrInsertIntoCursor)}
                    />
                  </ViewfinderTopRightControls>
                  <CameraControlStack
                    bottom={floatingBottom}
                    label={`${(1 + scanner.cameraZoom * 4).toFixed(1)}x`}
                    onZoomIn={() => scanner.setCameraZoom((value) => clampZoom(value + zoomStep))}
                    onZoomOut={() => scanner.setCameraZoom((value) => clampZoom(value - zoomStep))}
                    shutter={
                      <ViewfinderBottomShutter
                        disabled={scanner.recognizingText}
                        icon={scanner.recognizingText ? "hourglass-outline" : "camera"}
                        label="Capture text"
                        onPress={scanner.captureText}
                        status={scanner.recognizingText ? "Reading text..." : "Tap shutter to capture text"}
                        statusActive={scanner.recognizingText}
                      />
                    }
                  />
                </PhotoNegativeOverlay>
              </>
            )}
        </ViewfinderSurface>
        {scanner.textCapture ? (
          <OcrBottomControls
            bottom={floatingBottom}
            onZoomIn={() => setCapturedImageZoom(scanner.captureZoom + captureZoomStep)}
            onZoomOut={() => setCapturedImageZoom(scanner.captureZoom - captureZoomStep)}
          />
        ) : null}
      </View>
    </ScreenRoot>
  );
}

export function ScreenRoot({ children }: PropsWithChildren) {
  return <View style={styles.scannerRoot}>{children}</View>;
}

export function ViewfinderSurface({ children }: PropsWithChildren) {
  return (
    <View style={[styles.content, styles.viewfinderContent]}>
      <View style={styles.viewfinderShell}>{children}</View>
    </View>
  );
}

export function PhotoNegativeOverlay({ children }: { children: ReactNode }) {
  return (
    <View pointerEvents="box-none" style={styles.photoNegativeOverlay}>
      {children}
    </View>
  );
}

export function ViewfinderTopRightControls({ children }: PropsWithChildren) {
  return <View style={styles.viewfinderTopRight}>{children}</View>;
}

export function CameraOverlayButton({
  active,
  accessibilityLabel,
  children,
  onPress,
}: PropsWithChildren<{
  active?: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}>) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      style={[styles.cameraOverlayButton, active && styles.cameraOverlayButtonActive]}
      onPress={onPress}
    >
      {children}
    </Pressable>
  );
}

export function CursorInsertButton({
  active,
  accessibilityLabel,
  onPress,
}: {
  active: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  return (
    <CameraOverlayButton active={active} accessibilityLabel={accessibilityLabel} onPress={onPress}>
      <Ionicons name={active ? "enter" : "enter-outline"} size={21} color={active ? "#86efac" : "#fafaf9"} />
    </CameraOverlayButton>
  );
}

export function CameraControlStack({
  bottom,
  label,
  onZoomIn,
  onZoomOut,
  shutter,
}: {
  bottom: number;
  label: string;
  onZoomIn: () => void;
  onZoomOut: () => void;
  shutter: ReactNode;
}) {
  return (
    <View style={[styles.cameraControlStack, { bottom }]} pointerEvents="box-none">
      <View style={styles.zoomPill} pointerEvents="auto">
        <Pressable
          accessibilityLabel="Zoom camera out"
          accessibilityRole="button"
          hitSlop={6}
          style={styles.zoomPillButton}
          onPress={onZoomOut}
        >
          <Ionicons name="remove" size={20} color="#fafaf9" />
        </Pressable>
        <Text style={styles.zoomPillText}>{label}</Text>
        <Pressable
          accessibilityLabel="Zoom camera in"
          accessibilityRole="button"
          hitSlop={6}
          style={styles.zoomPillButton}
          onPress={onZoomIn}
        >
          <Ionicons name="add" size={20} color="#fafaf9" />
        </Pressable>
      </View>
      {shutter}
    </View>
  );
}

export function ViewfinderBottomShutter({
  bottom,
  disabled,
  error,
  icon,
  label,
  onPress,
  status,
  statusActive,
}: {
  bottom?: number;
  disabled?: boolean;
  error?: string | null;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  status: string;
  statusActive?: boolean;
}) {
  return (
    <View
      style={[
        styles.photoControls,
        bottom == null ? null : styles.photoControlsFloating,
        bottom == null ? null : { bottom },
      ]}
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.statusPill,
          error && styles.statusPillError,
          statusActive && styles.statusPillActive,
        ]}
      >
        <View
          style={[
            styles.statusDot,
            error && styles.statusDotError,
            statusActive && styles.statusDotActive,
          ]}
        />
        <Text numberOfLines={1} style={styles.statusPillText}>{error || status}</Text>
      </View>

      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.shutterRing,
          disabled && styles.disabled,
          pressed && !disabled && styles.shutterRingPressed,
        ]}
      >
        <View style={[styles.shutterCore, statusActive && styles.shutterCoreBusy]}>
          <Ionicons name={icon} size={28} color="#f0fdf4" />
        </View>
      </Pressable>
    </View>
  );
}

export function DisconnectedPairingView({
  error,
  pairingActive,
  pairingLocked,
  onOpenScanner,
  onPairingQrScanned,
}: {
  error: string | null;
  pairingActive: boolean;
  pairingLocked: boolean;
  onOpenScanner: () => void;
  onPairingQrScanned: (result: BarcodeScanningResult) => void;
}) {
  const scanner = useScanner();
  const insets = useSafeAreaInsets();
  const [viewfinderFocused, setViewfinderFocused] = useState(false);
  const cameraReady = !!scanner.permission?.granted;
  const showCamera = cameraReady && viewfinderFocused;
  const scanEnabled = showCamera && pairingActive && !pairingLocked;
  const pairingBottomInset = Math.max(baseFloatingBottom, insets.bottom + 126);

  useFocusEffect(
    useCallback(() => {
      setViewfinderFocused(true);
      return () => setViewfinderFocused(false);
    }, [])
  );

  useEffect(() => {
    if (cameraReady || scanner.permission?.canAskAgain === false) return;
    void scanner.requestPermission();
  }, [cameraReady, scanner.permission?.canAskAgain, scanner.requestPermission]);

  return (
    <ViewfinderSurface>
      {showCamera ? (
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={scanEnabled ? onPairingQrScanned : undefined}
        />
      ) : null}
      <View
        style={[styles.disconnectedPairingOverlay, { paddingBottom: pairingBottomInset }]}
        pointerEvents="box-none"
      >
        <View pointerEvents="box-none" style={styles.disconnectedQrFrame}>
          <View pointerEvents="none" style={styles.disconnectedQrCornerTopLeft} />
          <View pointerEvents="none" style={styles.disconnectedQrCornerTopRight} />
          <View pointerEvents="none" style={styles.disconnectedQrCornerBottomLeft} />
          <View pointerEvents="none" style={styles.disconnectedQrCornerBottomRight} />
          <View style={styles.disconnectedPairingCopy}>
            <Ionicons name="qr-code-outline" size={30} color="#f0fdf4" />
            <Text style={styles.disconnectedPairingTitle}>Point camera at browser QR code</Text>
            <Text style={styles.disconnectedPairingText}>
              Open the Chrome extension and aim this square at its pairing code.
            </Text>
            {error ? <Text style={styles.disconnectedPairingError}>{error}</Text> : null}
            {!cameraReady ? (
              <Pressable style={styles.disconnectedPairingButton} onPress={onOpenScanner}>
                <Ionicons name="camera-outline" size={18} color="#f0fdf4" />
                <Text style={styles.disconnectedPairingButtonText}>Allow camera</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </ViewfinderSurface>
  );
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

export function OcrBottomControls({
  bottom,
  onZoomIn,
  onZoomOut,
}: {
  bottom?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const {
    captureZoom,
    captureText,
    clearTextCapture,
    recognizingText,
    textCapture,
    textCaptureResult,
  } = useScanner();

  const floatingBottom = bottom ?? Math.max(baseFloatingBottom, insets.bottom + 74);
  const actionPress = textCapture ? clearTextCapture : captureText;
  const actionDisabled = !textCapture && recognizingText;

  return (
    <>
      {textCaptureResult ? (
        <View style={[styles.bottomControls, { bottom: floatingBottom + 122 }]}>
          <View style={styles.copiedPanel}>
          <View style={styles.copiedHeader}>
            <Ionicons name="checkmark-circle" size={18} color="#16a34a" />
            <Text style={styles.copiedTitle}>Copied and sent to {textCaptureResult.target}</Text>
          </View>
          <Text numberOfLines={2} style={styles.copiedText}>{textCaptureResult.text}</Text>
          </View>
        </View>
      ) : null}
      <CameraControlStack
        bottom={floatingBottom}
        label={`${Math.round(captureZoom * 100)}%`}
        onZoomIn={onZoomIn ?? (() => {})}
        onZoomOut={onZoomOut ?? (() => {})}
        shutter={
          <ViewfinderBottomShutter
            disabled={actionDisabled}
            icon={textCapture ? "refresh" : recognizingText ? "hourglass-outline" : "camera"}
            label={textCapture ? "Retake text capture" : "Capture text"}
            onPress={actionPress}
            status={textCapture ? "Select text in the image to send to results" : "Tap shutter to capture text"}
            statusActive={recognizingText}
          />
        }
      />
    </>
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
    top: 12,
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
    shadowColor: "#000000",
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -3 },
    elevation: 8,
  },
  disconnectedPage: {
    paddingBottom: 104,
  },
  content: { flex: 1, paddingTop: 18, paddingBottom: 18 },
  viewfinderContent: { paddingTop: 0, paddingBottom: 0, position: "relative" },
  viewfinderShell: {
    flex: 1,
    position: "relative",
    marginHorizontal: 0,
    borderRadius: 0,
    borderWidth: 0,
    overflow: "hidden",
    backgroundColor: "#1c1917",
  },
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
  camera: absoluteFillObject,
  photoNegativeOverlay: {
    ...absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.34)",
  },
  viewfinderTopRight: {
    position: "absolute",
    top: 12,
    right: 12,
    flexDirection: "column",
    gap: 10,
  },
  cameraOverlayButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(28, 25, 23, 0.55)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.14)",
  },
  cameraOverlayButtonActive: {
    backgroundColor: "rgba(28, 25, 23, 0.82)",
    borderColor: "rgba(250, 250, 249, 0.32)",
  },
  viewfinderZoomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  cameraControlStack: {
    position: "absolute",
    left: 18,
    right: 18,
    bottom: 0,
    alignItems: "center",
    gap: 12,
  },
  zoomPill: {
    minHeight: 44,
    paddingHorizontal: 6,
    borderRadius: 999,
    ...continuousCorners,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(28, 25, 23, 0.62)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.14)",
  },
  zoomPillButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
  },
  zoomPillText: {
    minWidth: 44,
    color: "#fafaf9",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  disconnectedPairingOverlay: {
    ...absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 0,
    paddingHorizontal: 28,
  },
  disconnectedQrFrame: {
    position: "absolute",
    width: "68%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  disconnectedQrCornerTopLeft: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 54,
    height: 54,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: "#f0fdf4",
    borderTopLeftRadius: 24,
  },
  disconnectedQrCornerTopRight: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 54,
    height: 54,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: "#f0fdf4",
    borderTopRightRadius: 24,
  },
  disconnectedQrCornerBottomLeft: {
    position: "absolute",
    bottom: 0,
    left: 0,
    width: 54,
    height: 54,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: "#f0fdf4",
    borderBottomLeftRadius: 24,
  },
  disconnectedQrCornerBottomRight: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 54,
    height: 54,
    borderRightWidth: 3,
    borderBottomWidth: 3,
    borderColor: "#f0fdf4",
    borderBottomRightRadius: 24,
  },
  disconnectedPairingCopy: {
    width: "84%",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 24,
    ...continuousCorners,
    backgroundColor: "rgba(28, 25, 23, 0.72)",
  },
  disconnectedPairingTitle: {
    marginTop: 10,
    color: "#fafaf9",
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "800",
    textAlign: "center",
  },
  disconnectedPairingText: {
    marginTop: 7,
    color: "#d6d3d1",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  disconnectedPairingError: {
    marginTop: 10,
    color: "#fecaca",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  disconnectedPairingButton: {
    minHeight: 46,
    marginTop: 18,
    paddingHorizontal: 18,
    borderRadius: 999,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#16a34a",
  },
  disconnectedPairingButtonText: { color: "#f0fdf4", fontWeight: "800" },
  capturedImage: {
    backgroundColor: "#1c1917",
  },
  capturedImageFallbackSize: {
    width: 1,
    height: 1,
  },
  capturedImageViewport: {
    ...absoluteFillObject,
    overflow: "hidden",
    backgroundColor: "#1c1917",
  },
  capturedImageScroll: {
    flex: 1,
  },
  capturedImageZoomContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  ocrCopyPrompt: {
    position: "absolute",
    top: 14,
    alignSelf: "center",
    maxWidth: "88%",
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    ...continuousCorners,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "rgba(28, 25, 23, 0.74)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.14)",
  },
  ocrCopyPromptText: {
    flexShrink: 1,
    color: "#f5f5f4",
    fontSize: 12,
    lineHeight: 15,
    fontWeight: "700",
  },
  captureZoomControls: {
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
    ...absoluteFillObject,
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
    ...absoluteFillObject,
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
  ocrCaptureButton: {
    height: 64,
    borderRadius: 32,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#16a34a",
    shadowColor: "#15803d",
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  ocrCaptureButtonPressed: {
    transform: [{ scale: 0.98 }],
  },
  ocrCaptureButtonText: {
    color: "#f0fdf4",
    fontSize: 17,
    fontWeight: "800",
  },
  photoControls: {
    alignItems: "center",
    gap: 8,
  },
  photoControlsFloating: {
    position: "absolute",
    left: 18,
    right: 18,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    ...continuousCorners,
    backgroundColor: "#f5f5f4",
    borderWidth: 1,
    borderColor: "#e7e5e4",
    maxWidth: "100%",
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
    fontWeight: "600",
    flexShrink: 1,
  },
  shutterRing: {
    width: 82,
    height: 82,
    borderRadius: 41,
    padding: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 4,
    borderColor: "rgba(250, 250, 249, 0.78)",
  },
  shutterRingPressed: {
    transform: [{ scale: 0.96 }],
  },
  shutterCore: {
    flex: 1,
    width: "100%",
    borderRadius: 999,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
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
  disabled: { opacity: 0.45 },
  bottomControls: {
    position: "absolute",
    left: 18,
    right: 18,
    zIndex: 10,
    gap: 10,
    backgroundColor: "transparent",
  },
  copiedPanel: {
    padding: 12,
    borderRadius: 22,
    ...continuousCorners,
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
    shadowColor: "#1c1917",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  copiedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  copiedTitle: {
    flex: 1,
    color: "#166534",
    fontSize: 13,
    fontWeight: "800",
  },
  copiedText: {
    marginTop: 6,
    color: "#14532d",
    fontSize: 13,
    lineHeight: 18,
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
