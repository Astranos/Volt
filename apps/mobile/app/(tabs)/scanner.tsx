import { Ionicons } from "@expo/vector-icons";
import { CameraView as ExpoCameraView, type BarcodeScanningResult } from "../../lib/expo-camera";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "expo-router";
import {
  Alert,
  Animated,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LiveTextImageView } from "../../lib/live-text-image-view";
import { barcodeTypes, useScanner, type PendingPhotoSummary } from "../../lib/scanner-state";
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

const CameraView = ExpoCameraView as unknown as ComponentType<any>;
const floatingBottomBase = Platform.select({ ios: 94, default: 86 });
const zoomStep = 0.08;
const captureZoomStep = 0.25;

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

const modeOptions = [
  { id: "ocr", label: "Text", icon: "document-text-outline" },
  { id: "barcode", label: "Barcode", icon: "barcode-outline" },
  { id: "photo", label: "Photo", icon: "camera-outline" },
  { id: "dictation", label: "Dictate", icon: "mic-outline" },
] as const;

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

function boxCenter(box: BarcodeBox) {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

function containsPoint(box: BarcodeBox, point: { x: number; y: number }) {
  return point.x >= box.left && point.x <= box.left + box.width && point.y >= box.top && point.y <= box.top + box.height;
}

function getBarcodeBox(result: BarcodeScanningResult | null, size: ViewfinderSize | null): BarcodeBox | null {
  if (!result || !size) return null;
  if (result.cornerPoints?.length) {
    const xs = result.cornerPoints.map((point) => point.x);
    const ys = result.cornerPoints.map((point) => point.y);
    return clampBox({
      left: Math.min(...xs),
      top: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    }, size);
  }
  const bounds = result.bounds;
  if (!bounds?.size?.width || !bounds?.size?.height) return null;
  return clampBox({
    left: bounds.origin.x,
    top: bounds.origin.y,
    width: bounds.size.width,
    height: bounds.size.height,
  }, size);
}

export default function ScannerTab() {
  const scanner = useScanner();
  const {
    activeMode,
    clearCameraFocus,
    connected,
    dictating,
    dictationStarting,
    prepareDictation,
    stopDictation,
  } = scanner;
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
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
  const [viewfinderSize, setViewfinderSize] = useState<ViewfinderSize | null>(null);
  const [capturedViewportSize, setCapturedViewportSize] = useState<ViewfinderSize | null>(null);
  const [cursorToastMessage, setCursorToastMessage] = useState<string | null>(null);
  const [showTextPrompt, setShowTextPrompt] = useState(false);
  const [gridVisible, setGridVisible] = useState(true);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeBarcodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(0);
  const capturedScrollRef = useRef<ScrollView | null>(null);
  const cursorToastOpacity = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      setViewfinderFocused(true);
      return () => {
        setViewfinderFocused(false);
        resetPairingScanner();
        clearCameraFocus();
        if (dictating || dictationStarting) stopDictation();
        if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
        if (activeBarcodeTimerRef.current) clearTimeout(activeBarcodeTimerRef.current);
      };
    }, [clearCameraFocus, dictating, dictationStarting, resetPairingScanner, stopDictation])
  );

  useEffect(() => {
    if (connected && activeMode === "dictation") void prepareDictation();
    if (activeMode !== "dictation" && (dictating || dictationStarting)) stopDictation();
  }, [activeMode, connected, dictating, dictationStarting, prepareDictation, stopDictation]);

  useEffect(() => {
    if (!scanner.textCapture) {
      setShowTextPrompt(false);
      return;
    }
    setShowTextPrompt(true);
    const timer = setTimeout(() => setShowTextPrompt(false), 4200);
    return () => clearTimeout(timer);
  }, [scanner.textCapture?.photoUri]);

  const floatingBottom = Math.max(floatingBottomBase, insets.bottom + 74);
  const targetFrame = useMemo(() => (viewfinderSize ? getTargetFrame(viewfinderSize) : null), [viewfinderSize]);
  const activeBarcodeBox = useMemo(() => getBarcodeBox(activeBarcode, viewfinderSize), [activeBarcode, viewfinderSize]);
  const photoFrameGap = 18;
  const photoFrameSize = Math.max(0, (viewfinderSize?.width ?? windowWidth) - photoFrameGap * 2);

  const showCursorInsertToast = useCallback((enabled: boolean) => {
    setCursorToastMessage(enabled ? "Typing to cursor is on" : "Saving to results only");
    cursorToastOpacity.stopAnimation();
    cursorToastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(cursorToastOpacity, { duration: 160, toValue: 1, useNativeDriver: true }),
      Animated.delay(1500),
      Animated.timing(cursorToastOpacity, { duration: 220, toValue: 0, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) setCursorToastMessage(null);
    });
  }, [cursorToastOpacity]);

  const triggerFocus = useCallback((event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    scanner.setFocusMode("off");
    scanner.setFocusPoint({ x: locationX, y: locationY });
    requestAnimationFrame(() => scanner.setFocusMode("on"));
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    focusTimerRef.current = setTimeout(scanner.clearCameraFocus, 900);
  }, [scanner]);

  const handleCameraTouchStart = useCallback((event: GestureResponderEvent) => {
    const distance = touchDistance(event);
    if (distance == null) {
      triggerFocus(event);
      return;
    }
    pinchStartDistanceRef.current = distance;
    pinchStartZoomRef.current = scanner.cameraZoom;
  }, [scanner.cameraZoom, triggerFocus]);

  const handleCameraTouchMove = useCallback((event: GestureResponderEvent) => {
    const distance = touchDistance(event);
    if (distance == null || pinchStartDistanceRef.current == null) return;
    const delta = (distance - pinchStartDistanceRef.current) / 260;
    scanner.setCameraZoom(clampZoom(pinchStartZoomRef.current + delta));
  }, [scanner]);

  const handleCameraTouchEnd = useCallback(() => {
    pinchStartDistanceRef.current = null;
  }, []);

  const handleViewfinderLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewfinderSize({ width, height });
  }, []);

  const handleCapturedViewportLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCapturedViewportSize({ width, height });
  }, []);

  const handleCapturedZoomScroll = useCallback((event: { nativeEvent: { zoomScale?: number } }) => {
    const nextZoom = event.nativeEvent.zoomScale;
    if (typeof nextZoom === "number" && Number.isFinite(nextZoom)) scanner.setCaptureZoom(Math.max(1, Math.min(4, nextZoom)));
  }, [scanner]);

  const setCapturedImageZoom = useCallback((zoom: number) => {
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
  }, [capturedViewportSize, scanner]);

  const onCandidateBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    const value = result.data.trim();
    if (!value || scanner.activeMode !== "barcode") return;
    const detectedBox = getBarcodeBox(result, viewfinderSize);
    if (detectedBox && targetFrame && !containsPoint(targetFrame, boxCenter(detectedBox))) return;
    setActiveBarcode(result);
    scanner.onBarcodeScanned(result);
    if (activeBarcodeTimerRef.current) clearTimeout(activeBarcodeTimerRef.current);
    activeBarcodeTimerRef.current = setTimeout(() => setActiveBarcode(null), 1600);
  }, [scanner, targetFrame, viewfinderSize]);

  const sendActiveBarcode = useCallback(async () => {
    if (!activeBarcode) {
      Alert.alert("No barcode selected", "Center a barcode or QR code inside the scan frame first.");
      return;
    }
    await scanner.sendBarcodeScanResult(activeBarcode);
    setActiveBarcode(null);
  }, [activeBarcode, scanner]);

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
            <Text style={styles.bodyText}>Camera access is needed for text, barcode, and photo capture.</Text>
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
        <View style={localStyles.connectedBody}>
          <ViewfinderSurface onLayout={handleViewfinderLayout}>
            <ModePicker />
            <StatusHint text={scanner.statusHint} />
            {scanner.activeMode === "dictation" ? (
              <DictationWorkspace />
            ) : scanner.activeMode === "ocr" && scanner.textCapture ? (
              <View style={styles.capturedImageViewport} onLayout={handleCapturedViewportLayout}>
                <ScrollView
                  key={`${scanner.textCapture.photoUri}-${capturedViewportSize?.width ?? 0}x${capturedViewportSize?.height ?? 0}`}
                  ref={capturedScrollRef}
                  automaticallyAdjustContentInsets={false}
                  bouncesZoom
                  centerContent
                  contentInsetAdjustmentBehavior="never"
                  contentContainerStyle={[
                    styles.capturedImageZoomContent,
                    capturedViewportSize
                      ? {
                          minHeight: capturedViewportSize.height + 240,
                          minWidth: capturedViewportSize.width,
                          paddingBottom: 180,
                          paddingTop: 72,
                        }
                      : undefined,
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
                    style={[styles.capturedImage, capturedViewportSize ?? styles.capturedImageFallbackSize]}
                  />
                </ScrollView>
                {showTextPrompt ? (
                  <View pointerEvents="none" style={styles.ocrCopyPrompt}>
                    <Ionicons name="copy-outline" size={14} color="#bbf7d0" />
                    <Text numberOfLines={1} style={styles.ocrCopyPromptText}>Select text, copy, then confirm send</Text>
                  </View>
                ) : null}
                <OcrPreviewActions bottom={floatingBottom} onZoomIn={() => setCapturedImageZoom(scanner.captureZoom + captureZoomStep)} onZoomOut={() => setCapturedImageZoom(scanner.captureZoom - captureZoomStep)} />
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
                    barcodeScannerSettings={{ barcodeTypes: [...barcodeTypes] }}
                    onBarcodeScanned={scanner.activeMode === "barcode" ? onCandidateBarcodeScanned : undefined}
                    onTouchStart={handleCameraTouchStart}
                    onTouchMove={handleCameraTouchMove}
                    onTouchEnd={handleCameraTouchEnd}
                  />
                ) : null}
                {scanner.focusPoint ? (
                  <View pointerEvents="none" style={[styles.focusRing, { left: scanner.focusPoint.x - 34, top: scanner.focusPoint.y - 34 }]} />
                ) : null}
                {scanner.activeMode === "barcode" ? <BarcodeOverlay targetFrame={targetFrame} activeBarcodeBox={activeBarcodeBox} /> : null}
                {scanner.activeMode === "photo" ? <PhotoFrameOverlay gridVisible={gridVisible} size={photoFrameSize} gap={photoFrameGap} /> : null}
                <PhotoNegativeOverlay>
                  <ViewfinderMessageToast message={cursorToastMessage} opacity={cursorToastOpacity} />
                  {scanner.activeMode === "photo" ? <PhotoRecentStrip photos={scanner.pendingPhotos} onCancel={scanner.cancelPendingPhoto} onRetry={scanner.retryPendingPhotos} /> : null}
                  <CameraControlStack
                    leftControls={
                      <CameraOverlayButton
                        active={scanner.torch}
                        accessibilityLabel={scanner.torch ? "Turn flash off" : "Turn flash on"}
                        onPress={() => scanner.setTorch((value) => !value)}
                      >
                        <Ionicons name={scanner.torch ? "flash" : "flash-outline"} size={22} color={scanner.torch ? "#facc15" : "#fafaf9"} />
                      </CameraOverlayButton>
                    }
                    rightControls={
                      scanner.activeMode === "photo" ? (
                        <CameraOverlayButton
                          active={gridVisible}
                          accessibilityLabel={gridVisible ? "Hide photo grid" : "Show photo grid"}
                          onPress={() => setGridVisible((value) => !value)}
                        >
                          <Ionicons name={gridVisible ? "grid" : "grid-outline"} size={20} color={gridVisible ? "#86efac" : "#fafaf9"} />
                        </CameraOverlayButton>
                      ) : (
                        <CursorInsertButton
                          active={scanner.activeMode === "ocr" ? scanner.settings.ocrInsertIntoCursor : scanner.settings.scannerInsertIntoCursor}
                          accessibilityLabel="Toggle cursor insertion"
                          onValueChange={(value) => {
                            scanner.setSetting(scanner.activeMode === "ocr" ? "ocrInsertIntoCursor" : "scannerInsertIntoCursor", value);
                            showCursorInsertToast(value);
                          }}
                        />
                      )
                    }
                    bottom={floatingBottom}
                    label={`${(1 + scanner.cameraZoom * 4).toFixed(1)}x`}
                    onZoomIn={() => scanner.setCameraZoom((value) => clampZoom(value + zoomStep))}
                    onZoomOut={() => scanner.setCameraZoom((value) => clampZoom(value - zoomStep))}
                    shutter={
                      scanner.activeMode === "ocr" ? (
                        <ViewfinderBottomShutter
                          disabled={scanner.recognizingText}
                          icon={scanner.recognizingText ? "hourglass-outline" : "camera"}
                          label="Capture text"
                          onPress={scanner.captureText}
                          status={scanner.recognizingText ? "Reading text..." : "Capture text preview"}
                          statusActive={scanner.recognizingText}
                        />
                      ) : scanner.activeMode === "barcode" ? (
                        <ViewfinderBottomShutter
                          disabled={!activeBarcode}
                          icon="barcode-outline"
                          label="Send active barcode"
                          onPress={sendActiveBarcode}
                          status={activeBarcode ? `Ready: ${activeBarcode.data.trim()}` : "Center a barcode"}
                        />
                      ) : (
                        <ViewfinderBottomShutter
                          disabled={false}
                          error={scanner.photoError}
                          icon={scanner.photoSending ? "hourglass-outline" : "camera"}
                          label="Take photo"
                          onPress={() => scanner.sendPhotoCapture()}
                          status={scanner.photoProgressLabel ?? "Tap shutter to queue photo"}
                          statusActive={scanner.photoSending}
                        />
                      )
                    }
                  />
                </PhotoNegativeOverlay>
              </>
            )}
          </ViewfinderSurface>
        </View>
      </View>
    </ScreenRoot>
  );
}

function ModePicker() {
  const scanner = useScanner();
  return (
    <View style={localStyles.modePicker}>
      {modeOptions.map((mode) => {
        const active = scanner.activeMode === mode.id;
        return (
          <Pressable
            key={mode.id}
            accessibilityLabel={`Switch to ${mode.label}`}
            accessibilityRole="button"
            onPress={() => scanner.setActiveMode(mode.id)}
            style={[localStyles.modeButton, active && localStyles.modeButtonActive]}
          >
            <Ionicons name={mode.icon} size={17} color={active ? "#14532d" : "#f5f5f4"} />
            <Text style={[localStyles.modeLabel, active && localStyles.modeLabelActive]}>{mode.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StatusHint({ text }: { text: string }) {
  return (
    <View pointerEvents="none" style={localStyles.statusHint}>
      <Text numberOfLines={2} style={localStyles.statusHintText}>{text}</Text>
    </View>
  );
}

function BarcodeOverlay({ targetFrame, activeBarcodeBox }: { targetFrame: BarcodeBox | null; activeBarcodeBox: BarcodeBox | null }) {
  return (
    <View style={localStyles.viewfinderOverlay} pointerEvents="none">
      {targetFrame ? (
        <View style={[localStyles.scanFrame, { left: targetFrame.left, top: targetFrame.top, width: targetFrame.width, height: targetFrame.height }]}>
          <View style={localStyles.scanLine} />
        </View>
      ) : null}
      {activeBarcodeBox ? (
        <View style={[localStyles.activeBarcodeBox, { left: activeBarcodeBox.left, top: activeBarcodeBox.top, width: activeBarcodeBox.width, height: activeBarcodeBox.height }]} />
      ) : null}
    </View>
  );
}

function PhotoFrameOverlay({ gap, gridVisible, size }: { gap: number; gridVisible: boolean; size: number }) {
  return (
    <View pointerEvents="none" style={localStyles.viewfinderOverlay}>
      <View style={[localStyles.photoFrame, { top: gap, left: gap, width: size, height: size }]}>
        {gridVisible ? (
          <>
            <View style={[localStyles.gridLineVertical, { left: "33.333%" }]} />
            <View style={[localStyles.gridLineVertical, { left: "66.666%" }]} />
            <View style={[localStyles.gridLineHorizontal, { top: "33.333%" }]} />
            <View style={[localStyles.gridLineHorizontal, { top: "66.666%" }]} />
          </>
        ) : null}
      </View>
    </View>
  );
}

function PhotoRecentStrip({ photos, onCancel, onRetry }: { photos: PendingPhotoSummary[]; onCancel: (id: string) => void; onRetry: () => void }) {
  if (!photos.length) return null;
  return (
    <View style={localStyles.photoStrip}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={localStyles.photoStripContent}>
        {photos.slice(0, 8).map((photo) => (
          <View key={photo.id} style={localStyles.photoPill}>
            <Ionicons
              name={photo.status === "failed" ? "alert-circle" : photo.status === "sent" ? "time" : "image-outline"}
              size={15}
              color={photo.status === "failed" ? "#fecaca" : "#bbf7d0"}
            />
            <Text numberOfLines={1} style={localStyles.photoPillText}>{Math.round(photo.progress * 100)}%</Text>
            {photo.status === "failed" ? (
              <Pressable accessibilityLabel="Retry pending photos" hitSlop={8} onPress={onRetry}>
                <Ionicons name="refresh" size={15} color="#f5f5f4" />
              </Pressable>
            ) : photo.status !== "sent" ? (
              <Pressable accessibilityLabel="Cancel photo" hitSlop={8} onPress={() => onCancel(photo.id)}>
                <Ionicons name="close" size={15} color="#f5f5f4" />
              </Pressable>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function OcrPreviewActions({ bottom, onZoomIn, onZoomOut }: { bottom: number; onZoomIn: () => void; onZoomOut: () => void }) {
  const scanner = useScanner();
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    Clipboard.getStringAsync()
      .then((value) => {
        if (!cancelled) setDraft(value.trim());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [scanner.textCapture?.photoUri]);

  return (
    <View pointerEvents="box-none" style={localStyles.ocrActions}>
      <View style={localStyles.ocrPreviewPanel}>
        <Text numberOfLines={2} selectable style={localStyles.ocrPreviewText}>{draft || "Copy selected text to preview it here."}</Text>
        <View style={localStyles.ocrPreviewActionsRow}>
          <Pressable accessibilityRole="button" style={localStyles.previewActionButton} onPress={scanner.clearTextCapture}>
            <Ionicons name="refresh" size={16} color="#f5f5f4" />
            <Text style={localStyles.previewActionText}>Retake</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!draft}
            style={[localStyles.previewActionButton, localStyles.previewSendButton, !draft && localStyles.previewActionDisabled]}
            onPress={() => scanner.sendTextCapture(draft)}
          >
            <Ionicons name="send" size={16} color="#052e16" />
            <Text style={localStyles.previewSendText}>Send</Text>
          </Pressable>
        </View>
      </View>
      <CameraControlStack
        bottom={bottom}
        label={`${Math.round(scanner.captureZoom * 100)}%`}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        shutter={
          <ViewfinderBottomShutter
            icon="copy-outline"
            label="Send text"
            onPress={() => {
              if (draft) void scanner.sendTextCapture(draft);
            }}
            disabled={!draft}
            status={draft ? "Review text, then send" : "Select and copy text"}
          />
        }
      />
    </View>
  );
}

function DictationWorkspace() {
  const scanner = useScanner();
  const pulse = useRef(new Animated.Value(0)).current;
  const dictationActive = scanner.dictating || scanner.dictationStarting;

  useEffect(() => {
    pulse.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { duration: dictationActive ? 560 : 1100, toValue: 1, useNativeDriver: true }),
        Animated.timing(pulse, { duration: dictationActive ? 560 : 1100, toValue: 0, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [dictationActive, pulse]);

  return (
    <View style={localStyles.dictationBackdrop}>
      <Animated.View
        pointerEvents="none"
        style={[
          localStyles.micPulse,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: dictationActive ? [0.28, 0.66] : [0.1, 0.22] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: dictationActive ? [0.92, 1.18] : [0.98, 1.06] }) }],
          },
        ]}
      />
      <Pressable
        accessibilityLabel="Start or stop dictation"
        accessibilityRole="button"
        onPress={() => (dictationActive ? scanner.stopDictation() : void scanner.startDictation())}
        style={[localStyles.micButton, scanner.dictating && localStyles.micButtonActive, scanner.dictationStarting && localStyles.micButtonStarting]}
      >
        <Ionicons name={scanner.dictating ? "mic" : "mic-outline"} size={54} color="#f0fdf4" />
      </Pressable>
      <View style={localStyles.dictationStatus}>
        <View style={[localStyles.statusDot, scanner.dictationStarting && localStyles.statusDotStarting, scanner.dictating && localStyles.statusDotActive, scanner.dictationError && localStyles.statusDotError]} />
        <Text numberOfLines={1} style={localStyles.holdLabel}>
          {scanner.dictationError ? "Dictation unavailable" : scanner.dictating ? "Listening" : scanner.dictationStarting ? "Getting ready" : "Tap to speak"}
        </Text>
      </View>
      {scanner.dictationTranscript || scanner.dictationError ? (
        <Text numberOfLines={5} selectable style={[localStyles.transcriptText, scanner.dictationError && localStyles.transcriptError]}>
          {scanner.dictationTranscript || scanner.dictationError}
        </Text>
      ) : null}
    </View>
  );
}

const localStyles = {
  connectedBody: { flex: 1 },
  modePicker: {
    position: "absolute" as const,
    zIndex: 28,
    top: 72,
    left: 12,
    right: 12,
    minHeight: 44,
    padding: 4,
    borderRadius: 22,
    flexDirection: "row" as const,
    gap: 4,
    backgroundColor: "rgba(28, 25, 23, 0.58)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.14)",
  },
  modeButton: {
    flex: 1,
    minHeight: 36,
    borderRadius: 18,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    flexDirection: "row" as const,
    gap: 5,
  },
  modeButtonActive: { backgroundColor: "#bbf7d0" },
  modeLabel: { color: "#f5f5f4", fontSize: 12, fontWeight: "800" as const },
  modeLabelActive: { color: "#14532d" },
  statusHint: {
    position: "absolute" as const,
    zIndex: 27,
    top: 124,
    alignSelf: "center" as const,
    maxWidth: "86%" as const,
    minHeight: 34,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(28, 25, 23, 0.7)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.14)",
  },
  statusHintText: { color: "#f5f5f4", fontSize: 12, lineHeight: 16, fontWeight: "800" as const, textAlign: "center" as const },
  viewfinderOverlay: { position: "absolute" as const, top: 0, right: 0, bottom: 0, left: 0 },
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
  photoFrame: {
    position: "absolute" as const,
    borderRadius: 34,
    overflow: "hidden" as const,
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.25)",
    backgroundColor: "rgba(0, 0, 0, 0.08)",
  },
  gridLineVertical: { position: "absolute" as const, top: 0, bottom: 0, width: 1, backgroundColor: "rgba(250, 250, 249, 0.36)" },
  gridLineHorizontal: { position: "absolute" as const, left: 0, right: 0, height: 1, backgroundColor: "rgba(250, 250, 249, 0.36)" },
  photoStrip: {
    position: "absolute" as const,
    left: 10,
    right: 10,
    bottom: 282,
    zIndex: 25,
  },
  photoStripContent: { gap: 8, paddingHorizontal: 4 },
  photoPill: {
    minHeight: 34,
    maxWidth: 118,
    paddingHorizontal: 10,
    borderRadius: 17,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 7,
    backgroundColor: "rgba(28, 25, 23, 0.76)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.16)",
  },
  photoPillText: { color: "#f5f5f4", fontSize: 12, fontWeight: "800" as const },
  ocrActions: { position: "absolute" as const, top: 0, right: 0, bottom: 0, left: 0 },
  ocrPreviewPanel: {
    position: "absolute" as const,
    left: 12,
    right: 12,
    bottom: 280,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "rgba(28, 25, 23, 0.78)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.16)",
    gap: 10,
  },
  ocrPreviewText: { color: "#f5f5f4", fontSize: 13, lineHeight: 18, fontWeight: "700" as const },
  ocrPreviewActionsRow: { flexDirection: "row" as const, gap: 8 },
  previewActionButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 6,
    backgroundColor: "rgba(250, 250, 249, 0.12)",
  },
  previewSendButton: { flex: 1, backgroundColor: "#bbf7d0" },
  previewActionDisabled: { opacity: 0.45 },
  previewActionText: { color: "#f5f5f4", fontSize: 13, fontWeight: "800" as const },
  previewSendText: { color: "#052e16", fontSize: 13, fontWeight: "900" as const },
  dictationBackdrop: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
    padding: 26,
    backgroundColor: "#0c1912",
  },
  micPulse: { position: "absolute" as const, width: 310, height: 310, borderRadius: 155, backgroundColor: "#22c55e" },
  micButton: {
    width: 148,
    height: 148,
    borderRadius: 74,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "#16a34a",
    borderWidth: 10,
    borderColor: "rgba(240, 253, 244, 0.22)",
  },
  micButtonActive: { backgroundColor: "#dc2626", transform: [{ scale: 1.04 }] },
  micButtonStarting: { backgroundColor: "#d97706", transform: [{ scale: 1.02 }] },
  dictationStatus: {
    marginTop: 28,
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: 19,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    backgroundColor: "rgba(250, 250, 249, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.16)",
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#a8a29e" },
  statusDotStarting: { backgroundColor: "#f59e0b" },
  statusDotActive: { backgroundColor: "#22c55e" },
  statusDotError: { backgroundColor: "#ef4444" },
  holdLabel: { color: "#f5f5f4", fontSize: 14, fontWeight: "800" as const },
  transcriptText: { marginTop: 22, color: "#dcfce7", fontSize: 18, lineHeight: 26, textAlign: "center" as const },
  transcriptError: { color: "#fecaca" },
};
