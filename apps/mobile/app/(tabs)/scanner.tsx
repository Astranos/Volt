import { Ionicons } from "@expo/vector-icons";
import { CameraView as ExpoCameraView, type BarcodeScanningResult } from "../../lib/expo-camera";
import { useFocusEffect } from "expo-router";
import { Alert, Animated, Image, Platform, Pressable, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { useCallback, useMemo, useRef, useState, type ComponentType } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { barcodeTypes, useScanner } from "../../lib/scanner-state";
import { usePairingScanner } from "../../lib/use-pairing-scanner";
import {
  CameraOverlayButton,
  CameraControlStack,
  CursorInsertButton,
  DisconnectedPairingView,
  Header,
  PhotoNegativeOverlay,
  ScreenRoot,
  ViewfinderBottomShutter,
  ViewfinderMessageToast,
  ViewfinderSurface,
  styles,
} from "./index";

const scannerFloatingBottom = Platform.select({ ios: 94, default: 86 });
const CameraView = ExpoCameraView as unknown as ComponentType<any>;
const zoomStep = 0.08;

type ViewfinderSize = {
  width: number;
  height: number;
};

type BarcodeBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function clampZoom(value: number) {
  return Math.max(0, Math.min(1, value));
}

function touchDistance(event: GestureResponderEvent) {
  const touches = event.nativeEvent.touches;
  if (touches.length < 2) return null;
  const [first, second] = touches;
  return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
}

function getTargetFrame(size: ViewfinderSize): BarcodeBox {
  const width = size.width * 0.78;
  const height = Math.max(108, size.height * 0.24);
  const centerY = size.height * 0.4;

  return {
    left: (size.width - width) / 2,
    top: Math.max(24, centerY - height / 2),
    width,
    height,
  };
}

function boxCenter(box: BarcodeBox) {
  return {
    x: box.left + box.width / 2,
    y: box.top + box.height / 2,
  };
}

function containsPoint(box: BarcodeBox, point: { x: number; y: number }) {
  return point.x >= box.left && point.x <= box.left + box.width && point.y >= box.top && point.y <= box.top + box.height;
}

function clampBox(box: BarcodeBox, size: ViewfinderSize): BarcodeBox {
  const left = Math.max(0, Math.min(size.width - 12, box.left));
  const top = Math.max(0, Math.min(size.height - 12, box.top));
  return {
    left,
    top,
    width: Math.max(12, Math.min(size.width - left, box.width)),
    height: Math.max(12, Math.min(size.height - top, box.height)),
  };
}

function getBarcodeBox(result: BarcodeScanningResult | null, size: ViewfinderSize | null): BarcodeBox | null {
  if (!result || !size) return null;

  if (result.cornerPoints?.length) {
    const xs = result.cornerPoints.map((point) => point.x);
    const ys = result.cornerPoints.map((point) => point.y);
    return clampBox(
      {
        left: Math.min(...xs),
        top: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      },
      size
    );
  }

  const bounds = result.bounds;
  if (!bounds?.size?.width || !bounds?.size?.height) return null;

  return clampBox(
    {
      left: bounds.origin.x,
      top: bounds.origin.y,
      width: bounds.size.width,
      height: bounds.size.height,
    },
    size
  );
}

export default function ScannerTab() {
  const scanner = useScanner();
  const insets = useSafeAreaInsets();
  const permission = scanner.permission;
  const {
    openPairScanner,
    onPairingQrScanned,
    pairScannerError,
    pairScannerLocked,
    pairScannerOpen,
    resetPairingScanner,
  } = usePairingScanner();
  const [viewfinderFocused, setViewfinderFocused] = useState(false);
  const [activeBarcode, setActiveBarcode] = useState<BarcodeScanningResult | null>(null);
  const [cursorToastMessage, setCursorToastMessage] = useState<string | null>(null);
  const [viewfinderSize, setViewfinderSize] = useState<ViewfinderSize | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(0);
  const activeBarcodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cursorToastOpacity = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      setViewfinderFocused(true);
      return () => {
        setViewfinderFocused(false);
        resetPairingScanner();
        scanner.clearCameraFocus();
        setActiveBarcode(null);
        if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
        if (activeBarcodeTimerRef.current) clearTimeout(activeBarcodeTimerRef.current);
      };
    }, [resetPairingScanner, scanner.clearCameraFocus])
  );

  const targetFrame = useMemo(() => (viewfinderSize ? getTargetFrame(viewfinderSize) : null), [viewfinderSize]);
  const activeBarcodeBox = useMemo(
    () => getBarcodeBox(activeBarcode, viewfinderSize),
    [activeBarcode, viewfinderSize]
  );
  const floatingBottom = Math.max(scannerFloatingBottom, insets.bottom + 74);

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

  const handleCameraLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewfinderSize({ width, height });
  }, []);

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

  const onCandidateBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      const value = result.data.trim();
      if (!value) return;

      const detectedBox = getBarcodeBox(result, viewfinderSize);
      if (detectedBox && targetFrame && !containsPoint(targetFrame, boxCenter(detectedBox))) {
        return;
      }

      setActiveBarcode(result);
      if (activeBarcodeTimerRef.current) clearTimeout(activeBarcodeTimerRef.current);
      activeBarcodeTimerRef.current = setTimeout(() => setActiveBarcode(null), 1600);
    },
    [targetFrame, viewfinderSize]
  );

  const sendActiveBarcode = useCallback(async () => {
    if (!activeBarcode) {
      Alert.alert("No barcode selected", "Center a barcode or QR code inside the scan frame first.");
      return;
    }

    await scanner.sendBarcodeScanResult(activeBarcode);
    setActiveBarcode(null);
  }, [activeBarcode, scanner]);

  if (scanner.connected) {
    if (!permission || !permission.granted) {
      return (
        <ScreenRoot>
          <Header />
          <View style={styles.page}>
            <View style={styles.permissionPanel}>
              <Image source={require("../../assets/volt-logo.png")} style={styles.permissionLogo} resizeMode="contain" />
              <Text style={styles.bodyText}>
                Camera access is needed to auto scan barcodes and QR codes into Chrome.
              </Text>
              <Pressable style={styles.primaryButton} onPress={scanner.requestPermission}>
                <Text style={styles.primaryButtonText}>Allow Camera</Text>
              </Pressable>
            </View>
          </View>
        </ScreenRoot>
      );
    }
  }

  return (
    <ScreenRoot>
      <Header />
      <View style={styles.page}>
        <View style={localStyles.connectedBody}>
          {!scanner.connected ? (
            <DisconnectedPairingView
              error={pairScannerError}
              pairingActive={pairScannerOpen || !!scanner.permission?.granted}
              pairingLocked={pairScannerLocked}
              onOpenScanner={openPairScanner}
              onPairingQrScanned={onPairingQrScanned}
            />
          ) : (
            <>
              <ViewfinderSurface>
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
                    barcodeScannerSettings={{ barcodeTypes: [...barcodeTypes] }}
                    onBarcodeScanned={onCandidateBarcodeScanned}
                    onLayout={handleCameraLayout}
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
                <View style={localStyles.viewfinderOverlay} pointerEvents="none">
                  {targetFrame ? (
                    <View
                      style={[
                        localStyles.scanFrame,
                        {
                          left: targetFrame.left,
                          top: targetFrame.top,
                          width: targetFrame.width,
                          height: targetFrame.height,
                        },
                      ]}
                    >
                      <View style={localStyles.scanLine} />
                    </View>
                  ) : null}
                  {activeBarcodeBox ? (
                    <View
                      style={[
                        localStyles.activeBarcodeBox,
                        {
                          left: activeBarcodeBox.left,
                          top: activeBarcodeBox.top,
                          width: activeBarcodeBox.width,
                          height: activeBarcodeBox.height,
                        },
                      ]}
                    />
                  ) : null}
                </View>
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
                          active={scanner.settings.scannerInsertIntoCursor}
                          accessibilityLabel={
                            scanner.settings.scannerInsertIntoCursor
                              ? "Send barcode scans to cursor"
                              : "Send barcode scans to results"
                          }
                          onValueChange={(value) => {
                            scanner.setSetting("scannerInsertIntoCursor", value);
                            showCursorInsertToast(value);
                          }}
                        />
                    }
                    bottom={floatingBottom}
                    label={`${(1 + scanner.cameraZoom * 4).toFixed(1)}x`}
                    onZoomIn={() => scanner.setCameraZoom((value) => clampZoom(value + zoomStep))}
                    onZoomOut={() => scanner.setCameraZoom((value) => clampZoom(value - zoomStep))}
                    shutter={
                      <ScannerBottomControls activeBarcode={activeBarcode} onScan={sendActiveBarcode} />
                    }
                  />
                </PhotoNegativeOverlay>
              </ViewfinderSurface>
            </>
          )}
        </View>
      </View>
    </ScreenRoot>
  );
}

function ScannerBottomControls({
  activeBarcode,
  onScan,
}: {
  activeBarcode: BarcodeScanningResult | null;
  onScan: () => void;
}) {
  const scanDisabled = !activeBarcode;
  const scanLabel = activeBarcode?.data.trim() || "Center a barcode in the frame";

  return (
    <ViewfinderBottomShutter
      disabled={scanDisabled}
      icon="barcode-outline"
      label="Scan active barcode"
      onPress={onScan}
      status={activeBarcode ? `Ready: ${scanLabel}` : scanLabel}
    />
  );
}

const localStyles = {
  connectedBody: {
    flex: 1,
  },
  viewfinderOverlay: {
    position: "absolute" as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  scanFrame: {
    position: "absolute" as const,
    borderWidth: 2,
    borderColor: "#f0fdf4",
    borderRadius: 18,
    backgroundColor: "rgba(240, 253, 244, 0.05)",
  },
  scanLine: {
    position: "absolute" as const,
    left: 14,
    right: 14,
    top: "50%" as const,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#22c55e",
  },
  activeBarcodeBox: {
    position: "absolute" as const,
    borderWidth: 3,
    borderColor: "#22c55e",
    borderRadius: 10,
    backgroundColor: "rgba(34, 197, 94, 0.12)",
  },
};
