import { Ionicons } from "@expo/vector-icons";
import { CameraView, type BarcodeScanningResult } from "expo-camera";
import { useFocusEffect } from "expo-router";
import { Alert, Image, Platform, Pressable, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from "react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { barcodeTypes, useScanner } from "../../lib/scanner-state";
import { Header, PairingPanel, ScreenRoot, StartCameraOverlay, TorchButton, styles } from "./index";

const scannerFloatingBottom = Platform.select({ ios: 94, default: 86 });
const scannerControlsHeight = 122;
const scannerCameraGap = 18;
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

  return {
    left: (size.width - width) / 2,
    top: (size.height - height) / 2,
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
  const permission = scanner.permission;
  const [pairScannerOpen, setPairScannerOpen] = useState(false);
  const [pairScannerLocked, setPairScannerLocked] = useState(false);
  const [pairScannerError, setPairScannerError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraZoom, setCameraZoom] = useState(0);
  const [activeBarcode, setActiveBarcode] = useState<BarcodeScanningResult | null>(null);
  const [viewfinderSize, setViewfinderSize] = useState<ViewfinderSize | null>(null);
  const pairScannerLockedRef = useRef(false);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(0);
  const activeBarcodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setCameraActive(false);
        setPairScannerOpen(false);
        setPairScannerLocked(false);
        pairScannerLockedRef.current = false;
        scanner.setTorch(false);
        setCameraZoom(0);
        setActiveBarcode(null);
        if (activeBarcodeTimerRef.current) clearTimeout(activeBarcodeTimerRef.current);
      };
    }, [scanner.setTorch])
  );

  const targetFrame = useMemo(() => (viewfinderSize ? getTargetFrame(viewfinderSize) : null), [viewfinderSize]);
  const activeBarcodeBox = useMemo(
    () => getBarcodeBox(activeBarcode, viewfinderSize),
    [activeBarcode, viewfinderSize]
  );

  const handleCameraLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewfinderSize({ width, height });
  }, []);

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
      <View style={[styles.page, !scanner.connected && styles.disconnectedPage]}>
        <View style={[styles.content, scanner.connected && localStyles.scannerContent]}>
          {!scanner.connected ? (
            pairScannerOpen ? (
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
            )
          ) : (
            <>
              <View style={styles.cameraShell}>
                {cameraActive ? (
                  <>
                    <CameraView
                      style={styles.camera}
                      facing="back"
                      enableTorch={scanner.torch}
                      zoom={cameraZoom}
                      barcodeScannerSettings={{ barcodeTypes: [...barcodeTypes] }}
                      onBarcodeScanned={onCandidateBarcodeScanned}
                      onLayout={handleCameraLayout}
                      onTouchStart={handleCameraTouchStart}
                      onTouchMove={handleCameraTouchMove}
                      onTouchEnd={handleCameraTouchEnd}
                    />
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
                    <View style={styles.zoomControls}>
                      <Pressable
                        accessibilityLabel="Zoom scanner out"
                        accessibilityRole="button"
                        style={styles.zoomButton}
                        onPress={() => setCameraZoom((value) => clampZoom(value - zoomStep))}
                      >
                        <Ionicons name="remove" size={18} color="#fafaf9" />
                      </Pressable>
                      <Text style={styles.zoomText}>{Math.round(cameraZoom * 100)}%</Text>
                      <Pressable
                        accessibilityLabel="Zoom scanner in"
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
              <ScannerBottomControls activeBarcode={activeBarcode} cameraActive={cameraActive} onScan={sendActiveBarcode} />
            </>
          )}
        </View>
      </View>
    </ScreenRoot>
  );
}

function ScannerBottomControls({
  activeBarcode,
  cameraActive,
  onScan,
}: {
  activeBarcode: BarcodeScanningResult | null;
  cameraActive: boolean;
  onScan: () => void;
}) {
  const scanDisabled = !cameraActive || !activeBarcode;
  const scanLabel = activeBarcode?.data.trim() || "Center a barcode in the frame";

  return (
    <View style={[styles.bottomControls, { bottom: scannerFloatingBottom }]}>
      <View style={localStyles.scanStatusPanel}>
        <Ionicons name={activeBarcode ? "scan" : "scan-outline"} size={18} color={activeBarcode ? "#16a34a" : "#78716c"} />
        <View style={localStyles.scanStatusTextGroup}>
          <Text style={localStyles.scanStatusTitle}>{activeBarcode ? "Ready to scan" : "No active barcode"}</Text>
          <Text numberOfLines={1} style={localStyles.scanStatusValue}>{scanLabel}</Text>
        </View>
      </View>
      <Pressable
        accessibilityLabel="Scan active barcode"
        accessibilityRole="button"
        disabled={scanDisabled}
        onPress={onScan}
        style={[localStyles.scanButton, scanDisabled && styles.disabled]}
      >
        <Ionicons name="barcode-outline" size={22} color="#f0fdf4" />
        <Text style={localStyles.scanButtonText}>Scan</Text>
      </Pressable>
    </View>
  );
}

const localStyles = {
  scannerContent: {
    paddingBottom: scannerFloatingBottom + scannerControlsHeight + scannerCameraGap,
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
  scanStatusPanel: {
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
  scanStatusTextGroup: { flex: 1 },
  scanStatusTitle: { color: "#1c1917", fontSize: 13, fontWeight: "800" as const },
  scanStatusValue: { color: "#78716c", fontSize: 13, marginTop: 2 },
  scanButton: {
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
  scanButtonText: { color: "#f0fdf4", fontSize: 17, fontWeight: "800" as const },
};
