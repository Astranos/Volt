import { Ionicons } from "@expo/vector-icons";
import { CameraView as ExpoCameraView, type CameraOrientation } from "../../lib/expo-camera";
import { useFocusEffect } from "expo-router";
import { Image, Platform, Pressable, Text, View, useWindowDimensions, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useScanner } from "../../lib/scanner-state";
import { usePairingScanner } from "../../lib/use-pairing-scanner";
import type { PhotoCropFrame } from "../../lib/photo-crop";
import {
  CameraOverlayButton,
  CameraControlStack,
  DisconnectedPairingView,
  Header,
  ScreenRoot,
  ViewfinderBottomShutter,
  ViewfinderSurface,
  styles,
} from "./index";

const photoFloatingBottom = Platform.select({ ios: 94, default: 86 });
const CameraView = ExpoCameraView as unknown as ComponentType<any>;
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

function cameraOrientationRotationDegrees(orientation: CameraOrientation) {
  switch (orientation) {
    case "landscapeLeft":
      return 90;
    case "landscapeRight":
      return -90;
    case "portraitUpsideDown":
      return 180;
    default:
      return 0;
  }
}

export default function PhotosTab() {
  const scanner = useScanner();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const {
    openPairScanner,
    onPairingQrScanned,
    pairScannerError,
    pairScannerLocked,
    pairScannerOpen,
    resetPairingScanner,
  } = usePairingScanner();
  const [viewfinderFocused, setViewfinderFocused] = useState(false);
  const [gridVisible, setGridVisible] = useState(true);
  const [showPhotoSent, setShowPhotoSent] = useState(false);
  const [cameraOrientation, setCameraOrientation] = useState<CameraOrientation>("portrait");
  const [cameraLayout, setCameraLayout] = useState<{ width: number; height: number } | null>(null);
  const [photoFrameLayout, setPhotoFrameLayout] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      setViewfinderFocused(true);
      return () => {
        setViewfinderFocused(false);
        resetPairingScanner();
        scanner.clearCameraFocus();
        if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      };
    }, [resetPairingScanner, scanner.clearCameraFocus])
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
      if (distance == null) {
        triggerFocus(event);
        return;
      }
      pinchStartDistanceRef.current = distance;
      pinchStartZoomRef.current = scanner.cameraZoom;
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

  const floatingBottom = Math.max(photoFloatingBottom, insets.bottom + 74);
  const photoFrameGap = 18;
  const photoFrameSize = Math.max(0, (cameraLayout?.width ?? windowWidth) - photoFrameGap * 2);
  const photoMaskBorderWidth = Math.max(windowHeight, windowWidth);
  const photoCropFrame = useMemo<PhotoCropFrame | null>(() => {
    if (!cameraLayout || !photoFrameLayout || photoFrameLayout.width <= 0 || photoFrameLayout.height <= 0) return null;
    return {
      previewWidth: cameraLayout.width,
      previewHeight: cameraLayout.height,
      frameX: photoFrameLayout.x,
      frameY: photoFrameLayout.y,
      frameWidth: photoFrameLayout.width,
      frameHeight: photoFrameLayout.height,
    };
  }, [cameraLayout, photoFrameLayout]);
  const controlRotationStyle = useMemo(
    () => ({ transform: [{ rotate: `${cameraOrientationRotationDegrees(cameraOrientation)}deg` }] }),
    [cameraOrientation]
  );

  const handleCameraLayout = useCallback((event: LayoutChangeEvent) => {
    const { height, width } = event.nativeEvent.layout;
    setCameraLayout({ width, height });
  }, []);

  const handlePhotoFrameLayout = useCallback((event: LayoutChangeEvent) => {
    const { height, width, x, y } = event.nativeEvent.layout;
    setPhotoFrameLayout({ x, y, width, height });
  }, []);

  useEffect(() => {
    if (!scanner.photoSentAt) return;

    setShowPhotoSent(true);
    const timer = setTimeout(() => setShowPhotoSent(false), 1700);
    return () => clearTimeout(timer);
  }, [scanner.photoSentAt]);

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
        <ViewfinderSurface>
          {viewfinderFocused ? (
            <CameraView
              ref={scanner.cameraRef}
              style={styles.camera}
              onLayout={handleCameraLayout}
              facing="back"
              enableTorch={scanner.torch}
              zoom={scanner.cameraZoom}
              autofocus={scanner.focusMode}
              focusPoint={scanner.focusPoint}
              animateShutter
              responsiveOrientationWhenOrientationLocked={Platform.OS === "ios"}
              onResponsiveOrientationChanged={({ orientation }: { orientation: CameraOrientation }) => {
                setCameraOrientation(orientation);
              }}
              onTouchStart={handleCameraTouchStart}
              onTouchMove={handleCameraTouchMove}
              onTouchEnd={handleCameraTouchEnd}
            />
          ) : null}
          <PhotoFrameOverlay
            gap={photoFrameGap}
            gridVisible={gridVisible}
            maskBorderWidth={photoMaskBorderWidth}
            onFrameLayout={handlePhotoFrameLayout}
            size={photoFrameSize}
          />
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

          <View pointerEvents="box-none" style={localStyles.photoControlsOverlay}>
            {showPhotoSent ? (
              <View pointerEvents="none" style={localStyles.photoSentToast}>
                <Ionicons name="checkmark-circle" size={18} color="#bbf7d0" />
                <Text numberOfLines={1} style={localStyles.photoSentToastText}>Photo sent to browser</Text>
              </View>
            ) : null}
            <CameraControlStack
              leftControls={
                <View style={controlRotationStyle}>
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
                </View>
              }
              rightControls={
                <View style={controlRotationStyle}>
                  <CameraOverlayButton
                    active={gridVisible}
                    accessibilityLabel={gridVisible ? "Hide photo grid" : "Show photo grid"}
                    onPress={() => setGridVisible((value) => !value)}
                  >
                    <Ionicons
                      name={gridVisible ? "grid" : "grid-outline"}
                      size={20}
                      color={gridVisible ? "#86efac" : "#fafaf9"}
                    />
                  </CameraOverlayButton>
                </View>
              }
              bottom={floatingBottom}
              label={`${(1 + scanner.cameraZoom * 4).toFixed(1)}x`}
              onZoomIn={() => scanner.setCameraZoom((value) => clampZoom(value + zoomStep))}
              onZoomOut={() => scanner.setCameraZoom((value) => clampZoom(value - zoomStep))}
              shutter={
                <View style={controlRotationStyle}>
                  <ViewfinderBottomShutter
                    disabled={scanner.photoSending || !photoCropFrame}
                    error={scanner.photoError}
                    icon={scanner.photoSending ? "hourglass-outline" : "camera"}
                    label="Take and send photo"
                    onPress={() => scanner.sendPhotoCapture(photoCropFrame)}
                    status={
                      scanner.photoSending
                        ? "Sending photo..."
                        : !photoCropFrame
                          ? "Preparing camera frame..."
                        : showPhotoSent
                          ? "Photo sent to browser"
                          : "Tap shutter to send to Chrome"
                    }
                    statusActive={scanner.photoSending}
                  />
                </View>
              }
            />
          </View>
        </ViewfinderSurface>
      </View>
    </ScreenRoot>
  );
}

function PhotoFrameOverlay({
  gap,
  gridVisible,
  maskBorderWidth,
  onFrameLayout,
  size,
}: {
  gap: number;
  gridVisible: boolean;
  maskBorderWidth: number;
  onFrameLayout: (event: LayoutChangeEvent) => void;
  size: number;
}) {
  return (
    <View pointerEvents="none" style={localStyles.photoFrameOverlay}>
      <View
        style={[
          localStyles.photoRoundedDimMask,
          {
            top: gap - maskBorderWidth,
            left: gap - maskBorderWidth,
            width: size + maskBorderWidth * 2,
            height: size + maskBorderWidth * 2,
            borderRadius: maskBorderWidth + 34,
            borderWidth: maskBorderWidth,
          },
        ]}
      />
      <View
        onLayout={onFrameLayout}
        style={[localStyles.photoFrameBorder, { top: gap, left: gap, width: size, height: size }]}
      >
        {gridVisible ? <PhotoGridOverlay /> : null}
      </View>
    </View>
  );
}

function PhotoGridOverlay() {
  return (
    <>
      <View style={[localStyles.gridLineVertical, { left: "33.333%" }]} />
      <View style={[localStyles.gridLineVertical, { left: "66.666%" }]} />
      <View style={[localStyles.gridLineHorizontal, { top: "33.333%" }]} />
      <View style={[localStyles.gridLineHorizontal, { top: "66.666%" }]} />
    </>
  );
}

const localStyles = {
  photoFrameOverlay: {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  photoRoundedDimMask: {
    position: "absolute" as const,
    borderColor: "rgba(0, 0, 0, 0.56)",
  },
  photoFrameBorder: {
    position: "absolute" as const,
    borderRadius: 34,
    overflow: "hidden" as const,
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.14)",
  },
  photoControlsOverlay: {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  photoSentToast: {
    position: "absolute" as const,
    top: "16%" as const,
    alignSelf: "center" as const,
    minHeight: 38,
    maxWidth: "82%" as const,
    paddingHorizontal: 13,
    borderRadius: 999,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 7,
    backgroundColor: "rgba(28, 25, 23, 0.74)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.16)",
  },
  photoSentToastText: {
    flexShrink: 1,
    color: "#f5f5f4",
    fontSize: 13,
    fontWeight: "800" as const,
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
};
