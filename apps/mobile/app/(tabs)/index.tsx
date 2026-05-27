import { Ionicons } from "@expo/vector-icons";
import { InputLongTextIcon } from "@hugeicons/core-free-icons";
import { Host, Toggle } from "@expo/ui/swift-ui";
import { CameraView as ExpoCameraView, type BarcodeScanningResult } from "../../lib/expo-camera";
import { useFocusEffect } from "expo-router";
import {
  Image,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  Switch as RNSwitch,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ViewProps,
} from "react-native";
import Svg, { Circle, G, Line, Path, Rect } from "react-native-svg";
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
const cursorIconSize = 23;

function clampZoom(value: number) {
  return Math.max(0, Math.min(1, value));
}

function touchDistance(event: GestureResponderEvent) {
  const touches = event.nativeEvent.touches;
  if (touches.length < 2) return null;
  const [first, second] = touches;
  return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
}

function normalizeHugeIconAttrs(attrs: Record<string, string | number>, color: string) {
  const normalized: Record<string, string | number> = { ...attrs };
  delete normalized.key;
  if (normalized.stroke === "currentColor") normalized.stroke = color;
  if (normalized.fill === "currentColor") normalized.fill = color;
  if (normalized.strokeWidth != null) normalized.strokeWidth = 1.8;
  return normalized as any;
}

function InputLongTextHugeIcon({ color }: { color: string }) {
  return (
    <View style={styles.cursorToggleIconSlot} pointerEvents="none">
      <Svg width={cursorIconSize} height={cursorIconSize} viewBox="0 0 24 24" fill="none">
        {InputLongTextIcon.map(([tag, rawAttrs], index) => {
          const attrs = normalizeHugeIconAttrs(rawAttrs as Record<string, string | number>, color);
          if (tag === "path") return <Path key={index} {...attrs} />;
          if (tag === "circle") return <Circle key={index} {...attrs} />;
          if (tag === "rect") return <Rect key={index} {...attrs} />;
          if (tag === "line") return <Line key={index} {...attrs} />;
          if (tag === "g") return <G key={index} {...attrs} />;
          return null;
        })}
      </Svg>
    </View>
  );
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
  const [cursorToastMessage, setCursorToastMessage] = useState<string | null>(null);
  const pairScannerLockedRef = useRef(false);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capturedScrollRef = useRef<ScrollView | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(0);
  const cursorToastOpacity = useRef(new Animated.Value(0)).current;

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

  const showCursorInsertToast = useCallback((enabled: boolean) => {
    setCursorToastMessage(
      enabled
        ? "Copied text will be pasted into browser's current position"
        : "Copied text will NOT be pasted into browser's current position"
    );
    cursorToastOpacity.stopAnimation();
    cursorToastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(cursorToastOpacity, {
        duration: 160,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.delay(1500),
      Animated.timing(cursorToastOpacity, {
        duration: 220,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setCursorToastMessage(null);
    });
  }, [cursorToastOpacity]);

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
        <ViewfinderSurface onLayout={handleCapturedViewportLayout}>
            {scanner.textCapture ? (
              <View style={styles.capturedImageViewport} onLayout={handleCapturedViewportLayout}>
                <ScrollView
                  key={`${scanner.textCapture.photoUri}-${capturedViewportSize?.width ?? 0}x${capturedViewportSize?.height ?? 0}`}
                  ref={capturedScrollRef}
                  automaticallyAdjustContentInsets={false}
                  bouncesZoom
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
                      Select the text & hit copy to send to browser
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
                    focusPoint={scanner.focusPoint}
                    animateShutter
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
                  <ViewfinderMessageToast message={cursorToastMessage} opacity={cursorToastOpacity} />
                  <CameraControlStack
                    leftControls={
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
                    }
                    rightControls={
                        <CursorInsertButton
                          active={scanner.settings.ocrInsertIntoCursor}
                          accessibilityLabel={
                            scanner.settings.ocrInsertIntoCursor
                              ? "Send OCR text to cursor"
                              : "Send OCR text to results"
                          }
                          onValueChange={(value) => {
                            scanner.setSetting("ocrInsertIntoCursor", value);
                            showCursorInsertToast(value);
                          }}
                        />
                    }
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

export function ViewfinderSurface({ children, onLayout }: PropsWithChildren<{ onLayout?: ViewProps["onLayout"] }>) {
  return (
    <View style={[styles.content, styles.viewfinderContent]} onLayout={onLayout}>
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
  onValueChange,
}: {
  active: boolean;
  accessibilityLabel: string;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View accessibilityLabel={accessibilityLabel} style={[styles.cursorTogglePill, active && styles.cursorTogglePillActive]}>
      <InputLongTextHugeIcon color={active ? "#86efac" : "#fafaf9"} />
      <View style={styles.cursorNativeToggle}>
        {Platform.OS === "ios" ? (
          <Host matchContents>
            <Toggle isOn={active} onIsOnChange={onValueChange} />
          </Host>
        ) : (
          <RNSwitch
            value={active}
            onValueChange={onValueChange}
            trackColor={{ false: "#44403c", true: "#bbf7d0" }}
            thumbColor={active ? "#16a34a" : "#fafaf9"}
          />
        )}
      </View>
    </View>
  );
}

export function ViewfinderMessageToast({
  message,
  opacity,
}: {
  message: string | null;
  opacity: Animated.Value;
}) {
  if (!message) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.viewfinderMessageToast,
        {
          opacity,
          transform: [
            {
              translateY: opacity.interpolate({
                inputRange: [0, 1],
                outputRange: [-8, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.viewfinderMessagePill}>
        <Ionicons name="information-circle" size={17} color="#16a34a" />
        <Text numberOfLines={2} style={styles.viewfinderMessageText}>{message}</Text>
      </View>
    </Animated.View>
  );
}

export function CameraControlStack({
  bottom,
  label,
  leftControls,
  onZoomIn,
  onZoomOut,
  rightControls,
  shutter,
}: {
  bottom: number;
  label: string;
  leftControls?: ReactNode;
  onZoomIn: () => void;
  onZoomOut: () => void;
  rightControls?: ReactNode;
  shutter: ReactNode;
}) {
  return (
    <View style={[styles.cameraControlStack, { bottom }]} pointerEvents="box-none">
      <View style={styles.liquidControlDrawer} pointerEvents="box-none">
        <View style={styles.liquidDrawerHandle} />
        {shutter}
        <View style={styles.cameraControlRow} pointerEvents="auto">
          <View style={styles.cameraControlSide}>{leftControls}</View>
          <View style={styles.zoomPill}>
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
          <View style={styles.cameraControlSide}>{rightControls}</View>
        </View>
      </View>
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
  const pairingPulse = useRef(new Animated.Value(0)).current;
  const cameraReady = !!scanner.permission?.granted;
  const showCamera = cameraReady && viewfinderFocused;
  const scanEnabled = showCamera && pairingActive && !pairingLocked;
  const pairingBottomInset = Math.max(baseFloatingBottom, insets.bottom + 126);
  const reconnecting = !pairingLocked && scanner.status === "pairing";
  const pairingInProgress = pairingLocked || reconnecting;
  const pairingTitle = !cameraReady
    ? "Allow camera to pair"
    : pairingLocked
      ? "Pairing with browser..."
      : reconnecting
        ? "Reconnecting to browser..."
      : "Aim at browser QR code";
  const pairingMessage = !cameraReady
    ? "Camera access is needed to scan the pairing code."
    : pairingLocked
      ? "QR code found. Keep this screen open while Volt connects."
      : reconnecting
        ? "Trying the saved pairing. Scan the current browser QR if this does not connect."
      : "Open the Chrome extension and center its pairing code in the square.";
  const pairingIcon = !cameraReady ? "camera-outline" : pairingInProgress ? "sync" : "qr-code-outline";

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

  useEffect(() => {
    pairingPulse.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pairingPulse, {
          duration: pairingInProgress ? 520 : 900,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pairingPulse, {
          duration: pairingInProgress ? 520 : 900,
          toValue: 0,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pairingInProgress, pairingPulse]);

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
          <Animated.View
            pointerEvents="none"
            style={[
              styles.disconnectedQrPulse,
              {
                opacity: pairingPulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: pairingInProgress ? [0.3, 0.72] : [0.12, 0.34],
                }),
                transform: [
                  {
                    scale: pairingPulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: pairingInProgress ? [0.98, 1.08] : [0.99, 1.04],
                    }),
                  },
                ],
              },
            ]}
          />
          <View pointerEvents="none" style={styles.disconnectedQrCornerTopLeft} />
          <View pointerEvents="none" style={styles.disconnectedQrCornerTopRight} />
          <View pointerEvents="none" style={styles.disconnectedQrCornerBottomLeft} />
          <View pointerEvents="none" style={styles.disconnectedQrCornerBottomRight} />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.disconnectedQrScanLine,
              {
                opacity: cameraReady ? 1 : 0,
                transform: [
                  {
                    translateY: pairingPulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-58, 58],
                    }),
                  },
                ],
              },
            ]}
          />
          <View style={styles.disconnectedPairingCopy}>
            <Animated.View
              style={[
                styles.disconnectedPairingIcon,
                {
                  transform: [
                    {
                      rotate: pairingInProgress
                        ? pairingPulse.interpolate({
                            inputRange: [0, 1],
                            outputRange: ["0deg", "180deg"],
                          })
                        : "0deg",
                    },
                  ],
                },
              ]}
            >
              <Ionicons name={pairingIcon} size={24} color="#f0fdf4" />
            </Animated.View>
            <Text style={styles.disconnectedPairingTitle}>{pairingTitle}</Text>
            <Text style={styles.disconnectedPairingText}>{pairingMessage}</Text>
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
      <View style={styles.headerStatusPill}>
        <View style={styles.headerStatusDot} />
        <Text numberOfLines={1} style={styles.status}>{statusLabel}</Text>
      </View>
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
  const copiedToastOpacity = useRef(new Animated.Value(0)).current;

  const floatingBottom = bottom ?? Math.max(baseFloatingBottom, insets.bottom + 74);
  const actionPress = textCapture ? clearTextCapture : captureText;
  const actionDisabled = !textCapture && recognizingText;

  useEffect(() => {
    if (!textCaptureResult) return;

    copiedToastOpacity.stopAnimation();
    copiedToastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(copiedToastOpacity, {
        duration: 180,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.delay(1400),
      Animated.timing(copiedToastOpacity, {
        duration: 240,
        toValue: 0,
        useNativeDriver: true,
      }),
    ]).start();
  }, [copiedToastOpacity, textCaptureResult?.sentAt]);

  return (
    <>
      {textCaptureResult ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.bottomControls,
            styles.copiedToastTopPosition,
            {
              opacity: copiedToastOpacity,
              transform: [
                {
                  translateY: copiedToastOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.copiedPanel}>
          <View style={styles.copiedHeader}>
            <Ionicons name="checkmark-circle" size={18} color="#16a34a" />
            <Text style={styles.copiedTitle}>
              {textCaptureResult.target === "browser" ? "Copied and sent to browser" : "Copied to scan history"}
            </Text>
          </View>
          <Text numberOfLines={2} style={styles.copiedText}>{textCaptureResult.text}</Text>
          </View>
        </Animated.View>
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
            status={textCapture ? "Select text & hit copy to send to browser" : "Tap shutter to capture text"}
            statusActive={recognizingText}
          />
        }
      />
    </>
  );
}

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  scannerRoot: { flex: 1, backgroundColor: "#1c1917" },
  header: {
    position: "absolute",
    top: stableTopInset + 10,
    left: 14,
    right: 14,
    zIndex: 30,
    height: 48,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 24,
    ...continuousCorners,
    backgroundColor: "rgba(28, 25, 23, 0.54)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.14)",
  },
  headerStatusPill: {
    minHeight: 30,
    maxWidth: "72%",
    paddingHorizontal: 10,
    borderRadius: 999,
    ...continuousCorners,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "rgba(0, 0, 0, 0.22)",
  },
  headerStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#86efac",
  },
  status: { color: "#f5f5f4", fontSize: 12, lineHeight: 15, maxWidth: 250, textAlign: "right", fontWeight: "700" },
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
    backgroundColor: "#1c1917",
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    overflow: "hidden",
  },
  disconnectedPage: {
    paddingBottom: 104,
  },
  content: { flex: 1, paddingTop: 0, paddingBottom: 0 },
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
    backgroundColor: "rgba(0, 0, 0, 0.18)",
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
  cursorTogglePill: {
    minWidth: 94,
    minHeight: 44,
    borderRadius: 22,
    ...continuousCorners,
    paddingLeft: 10,
    paddingRight: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    backgroundColor: "rgba(28, 25, 23, 0.55)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.14)",
  },
  cursorTogglePillActive: {
    backgroundColor: "rgba(28, 25, 23, 0.82)",
    borderColor: "rgba(250, 250, 249, 0.32)",
  },
  cursorToggleIconSlot: {
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  cursorNativeToggle: {
    minWidth: 48,
    alignItems: "flex-end",
  },
  viewfinderMessageToast: {
    position: "absolute",
    top: 16,
    left: 18,
    right: 18,
    zIndex: 25,
    alignItems: "center",
  },
  viewfinderMessagePill: {
    maxWidth: "100%",
    minHeight: 42,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 999,
    ...continuousCorners,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
    shadowColor: "#1c1917",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  viewfinderMessageText: {
    flexShrink: 1,
    color: "#14532d",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "700",
  },
  viewfinderZoomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  cameraControlStack: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 0,
    alignItems: "center",
  },
  liquidControlDrawer: {
    width: "100%",
    minHeight: 174,
    paddingTop: 10,
    paddingHorizontal: 12,
    paddingBottom: 14,
    borderRadius: 38,
    ...continuousCorners,
    alignItems: "center",
    gap: 18,
    overflow: "hidden",
    backgroundColor: "rgba(28, 25, 23, 0.62)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.18)",
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  liquidDrawerHandle: {
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(250, 250, 249, 0.34)",
  },
  cameraControlRow: {
    minHeight: 48,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  cameraControlSide: {
    minWidth: 54,
    alignItems: "center",
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
    top: "18%",
    width: "68%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  disconnectedQrPulse: {
    position: "absolute",
    top: 8,
    right: 8,
    bottom: 8,
    left: 8,
    borderRadius: 28,
    ...continuousCorners,
    backgroundColor: "rgba(34, 197, 94, 0.22)",
    borderWidth: 1,
    borderColor: "rgba(187, 247, 208, 0.5)",
  },
  disconnectedQrScanLine: {
    position: "absolute",
    left: 24,
    right: 24,
    top: "50%",
    height: 2,
    borderRadius: 1,
    backgroundColor: "#86efac",
    shadowColor: "#22c55e",
    shadowOpacity: 0.8,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
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
  disconnectedPairingIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(22, 163, 74, 0.5)",
    borderWidth: 1,
    borderColor: "rgba(187, 247, 208, 0.28)",
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
    alignItems: "stretch",
    justifyContent: "flex-start",
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
    gap: 16,
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
    backgroundColor: "rgba(250, 250, 249, 0.92)",
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
    width: 78,
    height: 78,
    borderRadius: 39,
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
  copiedToastTopPosition: {
    top: 16,
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
