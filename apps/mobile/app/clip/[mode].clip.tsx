import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  Alert,
  Animated,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  UIManager,
  View,
  requireNativeComponent,
  useWindowDimensions,
} from "react-native";
import type { ViewProps } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { initialWindowMetrics } from "react-native-safe-area-context";
import { SCANNER_SIGNAL_URL } from "@volt/scanner-protocol";
import { createBarcodeCandidateGuard } from "../../lib/barcode-candidate-guard";
import { makeClipRelayResult, messageForClipRelayStatus } from "../../lib/clip-result-relay";
import { parseCaptureInvocation, type CaptureInvocation } from "../../lib/capture-url";
import { LiveTextImageView } from "../../lib/live-text-image-view";
import {
  makeBarcodeMessage,
  makeDictationMessage,
  makePhotoMessage,
  makeOcrMessage,
  type ScannerCaptureMode,
} from "../../lib/scanner-messages";
import {
  addVoltClipBarcodeErrorListener,
  addVoltClipBarcodeCandidateListener,
  hasVoltClipBarcodeScanner,
  startVoltClipBarcodeScanner,
  stopVoltClipBarcodeScanner,
  type VoltClipBarcodeCandidate,
} from "../../lib/volt-clip-barcode-scanner";
import {
  addVoltClipDictationErrorListener,
  addVoltClipDictationFinalListener,
  addVoltClipDictationPartialListener,
  getVoltClipDictationPermissions,
  hasVoltClipDictation,
  requestVoltClipDictationPermissions,
  startVoltClipDictation,
  stopVoltClipDictation,
} from "../../lib/volt-clip-dictation";
import {
  getVoltClipClipboardChangeCount,
  getVoltClipClipboardString,
  hasVoltClipClipboard,
} from "../../lib/volt-clip-clipboard";
import {
  captureAndRecognizeVoltClipText,
  addVoltClipTextCaptureListener,
  focusVoltClipTextCamera,
  hideVoltClipTextPreview,
  hasVoltClipTextRecognizer,
  playVoltClipSelectionHaptic,
  setVoltClipTextCameraTorch,
  setVoltClipTextCameraZoom,
  showVoltClipTextPreview,
  VoltClipTextCameraView,
} from "../../lib/volt-clip-text-recognizer";

const OCR_ZOOM_MIN = 0.5;
const OCR_ZOOM_DEFAULT = 1;
const OCR_ZOOM_MAX = 4;
const OCR_ZOOM_WHEEL_DRAG_PER_STOP = 38;
const OCR_ZOOM_WHEEL_STOPS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4] as const;
const OCR_ZOOM_WHEEL_TICK_SPACING = 58;

function getOcrZoomStops(min = OCR_ZOOM_MIN, max = OCR_ZOOM_MAX) {
  return OCR_ZOOM_WHEEL_STOPS.filter((stop) => stop >= min - 0.01 && stop <= max + 0.01);
}

function nearestOcrZoomStopIndex(factor: number, min = OCR_ZOOM_MIN, max = OCR_ZOOM_MAX) {
  const stops = getOcrZoomStops(min, max);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  stops.forEach((stop, index) => {
    const distance = Math.abs(factor - stop);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function snapOcrZoomToStop(factor: number, min = OCR_ZOOM_MIN, max = OCR_ZOOM_MAX) {
  const stops = getOcrZoomStops(min, max);
  return stops[nearestOcrZoomStopIndex(factor, min, max)] ?? Math.max(min, OCR_ZOOM_DEFAULT);
}

function formatOcrZoomLabel(factor: number) {
  return `${factor.toFixed(factor % 1 === 0 ? 0 : 1)}x`;
}

function ocrZoomToWheelOffset(factor: number, min = OCR_ZOOM_MIN, max = OCR_ZOOM_MAX) {
  return nearestOcrZoomStopIndex(factor, min, max) * OCR_ZOOM_WHEEL_TICK_SPACING;
}

const modeTitles = {
  ocr: "OCR Capture",
  barcode: "Barcode Scanner",
  dictation: "Dictation",
  photo: "Photo Capture",
};
const clipModes = ["ocr", "barcode", "photo", "dictation"] as const;
const modeLabels: Record<ScannerCaptureMode, string> = {
  ocr: "OCR",
  barcode: "Scanner",
  photo: "Photos",
  dictation: "Dictation",
};
const RESULT_SEND_TIMEOUT_MS = 12_000;
const CLIPBOARD_POLL_MS = 650;
const stableTopInset = initialWindowMetrics?.insets.top ?? 0;
const stableBottomInset = initialWindowMetrics?.insets.bottom ?? 0;
const continuousCorners = Platform.select({ ios: { borderCurve: "continuous" as const }, default: {} }) ?? {};
const absoluteFillObject = { position: "absolute" as const, top: 0, right: 0, bottom: 0, left: 0 };
const TextCameraView = VoltClipTextCameraView as ComponentType<{
  onPreviewState?: (event: { nativeEvent?: { state?: "starting" | "ready" | "failed" } }) => void;
  style?: ViewProps["style"];
  collapsable?: boolean;
}> | null;
const LiquidTabBarView = Platform.OS === "ios" && UIManager.getViewManagerConfig("VoltClipLiquidTabBarView") != null
  ? requireNativeComponent<ViewProps & {
      selectedMode?: ScannerCaptureMode;
      onModeChange?: (event: { nativeEvent?: { mode?: ScannerCaptureMode } }) => void;
    }>("VoltClipLiquidTabBarView")
  : null;
const LiquidGlassView = Platform.OS === "ios" && UIManager.getViewManagerConfig("VoltClipLiquidGlassView") != null
  ? requireNativeComponent<ViewProps & {
      progress?: number;
      cornerRadius?: number;
      tone?: "adaptive" | "dark" | "bright";
    }>("VoltClipLiquidGlassView")
  : null;
const AnimatedLiquidGlassView = LiquidGlassView ? Animated.createAnimatedComponent(LiquidGlassView) : null;

function canRequestDictationPermissionAgain(speechStatus: string, microphoneGranted: boolean) {
  return speechStatus === "notDetermined" || (!microphoneGranted && speechStatus === "authorized");
}

function makeTestMessage(mode: ScannerCaptureMode) {
  if (mode === "ocr") return makeOcrMessage("hello from Volt Clip");
  if (mode === "dictation") return makeDictationMessage("hello from Volt Clip", `clip-${Date.now()}`);
  if (mode === "photo") {
    return makePhotoMessage({
      id: `clip-photo-${Date.now()}`,
      name: "volt-photo.jpg",
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,",
      size: 0,
      capturedAt: new Date().toISOString(),
    });
  }
  return makeBarcodeMessage("hello-from-volt-clip", "qr");
}

function ModeIcon({ mode, selected }: { mode: ScannerCaptureMode; selected: boolean }) {
  const iconTone = selected ? styles.ocrModeNavIconSelected : styles.ocrModeNavIconDefault;
  const lineTone = selected ? styles.ocrModeNavIconLineSelected : styles.ocrModeNavIconLineDefault;

  if (mode === "ocr") {
    return (
      <View style={styles.ocrModeNavIconBox}>
        <View style={[styles.ocrModeDocIcon, iconTone]}>
          <View style={[styles.ocrModeDocFold, selected && styles.ocrModeDocFoldSelected]} />
          <View style={[styles.ocrModeDocLine, lineTone]} />
          <View style={[styles.ocrModeDocLineShort, lineTone]} />
        </View>
        <View style={[styles.ocrModeViewfinderTopLeft, iconTone]} />
        <View style={[styles.ocrModeViewfinderTopRight, iconTone]} />
        <View style={[styles.ocrModeViewfinderBottomLeft, iconTone]} />
        <View style={[styles.ocrModeViewfinderBottomRight, iconTone]} />
      </View>
    );
  }

  if (mode === "barcode") {
    return (
      <View style={styles.ocrModeNavIconBox}>
        <View style={[styles.ocrModeBarcodeBars, selected && styles.ocrModeBarcodeBarsSelected]}>
          {[4, 2, 6, 3, 5].map((width, index) => (
            <View key={index} style={[styles.ocrModeBarcodeBar, lineTone, { width }]} />
          ))}
        </View>
        <View style={[styles.ocrModeViewfinderTopLeft, iconTone]} />
        <View style={[styles.ocrModeViewfinderTopRight, iconTone]} />
        <View style={[styles.ocrModeViewfinderBottomLeft, iconTone]} />
        <View style={[styles.ocrModeViewfinderBottomRight, iconTone]} />
      </View>
    );
  }

  if (mode === "photo") {
    return (
      <View style={styles.ocrModeNavIconBox}>
        <View style={[styles.ocrModePhotoBack, iconTone]} />
        <View style={[styles.ocrModePhotoFront, iconTone, selected && styles.ocrModePhotoFrontSelected]}>
          <View style={[styles.ocrModePhotoSun, lineTone]} />
          <View style={[styles.ocrModePhotoMountain, lineTone]} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.ocrModeNavIconBox}>
      <View style={[styles.ocrModeMicCapsule, iconTone, selected && styles.ocrModeMicCapsuleSelected]} />
      <View style={[styles.ocrModeMicStem, lineTone]} />
      <View style={[styles.ocrModeMicBase, lineTone]} />
      <View style={[styles.ocrModeMicArc, selected ? styles.ocrModeMicArcSelected : styles.ocrModeMicArcDefault]} />
    </View>
  );
}

function NativeBarcodeHighlight({ candidate }: { candidate: VoltClipBarcodeCandidate | null }) {
  if (!candidate?.bounds) return null;

  const { bounds, corners } = candidate;
  const hasCorners = Array.isArray(corners) && corners.length >= 4;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.ocrNativeBarcodeBounds,
        {
          left: bounds.x,
          top: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
      ]}
    >
      {hasCorners
        ? corners.slice(0, 4).map((corner, index) => (
            <View
              key={`${corner.x}-${corner.y}-${index}`}
              style={[
                styles.ocrNativeBarcodeCornerDot,
                {
                  left: corner.x - bounds.x - 5,
                  top: corner.y - bounds.y - 5,
                },
              ]}
            />
          ))
        : null}
    </View>
  );
}

export default function ClipInvocationScreen() {
  const [invocation, setInvocation] = useState<CaptureInvocation | null>(null);
  const initialMode = invocation?.mode ?? "ocr";
  const [activeMode, setActiveMode] = useState<ScannerCaptureMode>(initialMode);
  const mode = activeMode;
  const session = invocation?.sessionId ?? "";
  const isPairingMode = !session;
  const isDiscoveryMode = isPairingMode;
  const [sessionTarget, setSessionTarget] = useState<{
    browser?: string;
    tabTitle?: string;
    url?: string;
    cursor?: string;
  } | null>(null);
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [scannerState, setScannerState] = useState<"idle" | "starting" | "ready" | "unavailable" | "error">("idle");
  const [barcodeCandidate, setBarcodeCandidate] = useState<VoltClipBarcodeCandidate | null>(null);
  const [dictationState, setDictationState] = useState<"idle" | "requesting" | "ready" | "recording" | "unavailable" | "error">(
    "idle"
  );
  const [dictationTranscript, setDictationTranscript] = useState("");
  const [dictationFinal, setDictationFinal] = useState(false);
  const dictationLongPressRef = useRef(false);
  const [ocrState, setOcrState] = useState<"idle" | "capturing" | "ready" | "unavailable" | "error">("idle");
  const [ocrPreviewState, setOcrPreviewState] = useState<"idle" | "starting" | "ready" | "failed">("idle");
  const [ocrText, setOcrText] = useState("");
  const [ocrImageUri, setOcrImageUri] = useState<string | null>(null);
  const [ocrFrozenImageUri, setOcrFrozenImageUri] = useState<string | null>(null);
  const windowDimensions = useWindowDimensions();
  const lastOcrClipboardRef = useRef<string | null>(null);
  const lastOcrClipboardChangeCountRef = useRef<number | null>(null);
  const ocrDrawerProgress = useRef(new Animated.Value(0)).current;
  const ocrWheelEngagement = useRef(new Animated.Value(1)).current;
  const ocrDrawerProgressRef = useRef(0);
  const ocrWheelEngagementRef = useRef(1);
  const ocrDrawerDragStartRef = useRef(0);
  const ocrDrawerGestureAxisRef = useRef<"horizontal" | "vertical" | null>(null);
  const ocrWheelDragStartStopIndexRef = useRef(0);
  const ocrWheelDragStartEngagementRef = useRef(0);
  const ocrWheelDragDidEngageRef = useRef(false);
  const ocrLastHapticStopIndexRef = useRef(0);
  const ocrZoomNativeSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ocrZoomMinRef = useRef(OCR_ZOOM_DEFAULT);
  const ocrZoomMaxRef = useRef(OCR_ZOOM_MAX);
  const ocrZoomFactorRef = useRef(OCR_ZOOM_DEFAULT);
  const isOcrMode = Boolean(mode);
  const [ocrAutoTypeCopiedText, setOcrAutoTypeCopiedText] = useState(true);
  const [barcodeInsertIntoCursor, setBarcodeInsertIntoCursor] = useState(true);
  const [barcodeAutoSend, setBarcodeAutoSend] = useState(false);
  const [barcodeFullFrameScan, setBarcodeFullFrameScan] = useState(false);
  const [dictationAddsPunctuation, setDictationAddsPunctuation] = useState(true);
  const [ocrGlassTone, setOcrGlassTone] = useState<"adaptive" | "bright" | "dark">("adaptive");
  const [ocrTorchEnabled, setOcrTorchEnabled] = useState(false);
  const [ocrZoomFactor, setOcrZoomFactor] = useState(OCR_ZOOM_DEFAULT);
  const [ocrZoomMin, setOcrZoomMin] = useState(OCR_ZOOM_DEFAULT);
  const [ocrZoomMax, setOcrZoomMax] = useState(OCR_ZOOM_MAX);
  const [ocrFocusPoint, setOcrFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const isCameraCaptureMode = isPairingMode || mode === "ocr" || mode === "barcode" || mode === "photo";
  const resetToDiscoveryMode = useCallback((message?: string) => {
    setInvocation(null);
    setActiveMode("ocr");
    setSessionTarget(null);
    setBarcodeCandidate(null);
    setDictationTranscript("");
    setDictationFinal(false);
    setSendState("idle");
    setOcrImageUri(null);
    setOcrFrozenImageUri(null);
    setOcrText("");
    setError(message ?? "Browser session lost. Scan the Mobile Scanner QR in Chrome to pair again.");
  }, []);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetch(`${SCANNER_SIGNAL_URL}/${encodeURIComponent(session)}/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openedAt: new Date().toISOString() }),
    }).catch(() => {});
    const fetchTarget = () => {
      fetch(`${SCANNER_SIGNAL_URL}/${encodeURIComponent(session)}`)
        .then((response) => {
          if (response.status === 404 || response.status === 410) {
            if (!cancelled) resetToDiscoveryMode();
            return null;
          }
          return response.ok ? response.json() : null;
        })
        .then((payload) => {
          if (cancelled || !payload?.target || typeof payload.target !== "object") return;
          setSessionTarget(payload.target);
        })
        .catch(() => {});
    };
    fetchTarget();
    const interval = setInterval(fetchTarget, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [resetToDiscoveryMode, session]);
  const resetOcrCapture = useCallback(() => {
    setOcrImageUri(null);
    setOcrFrozenImageUri(null);
    setOcrText("");
    setOcrState("ready");
    setOcrPreviewState("ready");
    setSendState("idle");
    setError(null);
    lastOcrClipboardRef.current = null;
    lastOcrClipboardChangeCountRef.current = null;
  }, []);
  const capturedOcrImageUri = ocrImageUri ?? ocrFrozenImageUri;
  const canSend = Boolean(
    mode &&
      session &&
      sendState !== "sending" &&
      (mode === "dictation" || sendState !== "sent") &&
      (mode !== "ocr" || ocrText.trim()) &&
      (mode !== "barcode" || barcodeCandidate) &&
      (mode !== "dictation" || dictationTranscript.trim()) &&
      (mode !== "photo" || capturedOcrImageUri)
  );
  const ocrDrawerCollapsedHeight = 158;
  const ocrDrawerEdgeBleed = 2;
  const ocrDrawerExpandedHeight = Math.min(
    Math.max(windowDimensions.height * 0.64, 420),
    Math.max(windowDimensions.height - stableTopInset - 36, ocrDrawerCollapsedHeight)
  );
  const ocrDrawerCollapsedInset = 7;
  const ocrDrawerExpandedInset = -ocrDrawerEdgeBleed;
  const ocrDrawerCollapsedRadius = 48;
  const ocrDrawerExpandedRadius = 34;
  const ocrDrawerCollapsedBottom = ocrDrawerCollapsedInset;
  const ocrDrawerExpandedBottom = -ocrDrawerEdgeBleed;
  const animateOcrDrawerTo = useCallback(
    (value: number) => {
      Animated.spring(ocrDrawerProgress, {
        toValue: Math.max(0, Math.min(1, value)),
        damping: 24,
        mass: 0.9,
        stiffness: 210,
        overshootClamping: true,
        restDisplacementThreshold: 0.4,
        restSpeedThreshold: 0.4,
        useNativeDriver: false,
      }).start();
    },
    [ocrDrawerProgress]
  );
  const animateOcrWheelEngagementTo = useCallback(
    (value: number) => {
      Animated.spring(ocrWheelEngagement, {
        toValue: Math.max(0, Math.min(1, value)),
        damping: 22,
        mass: 0.82,
        stiffness: 240,
        overshootClamping: true,
        useNativeDriver: false,
      }).start();
    },
    [ocrWheelEngagement]
  );
  const syncOcrZoomToNative = useCallback((factor: number) => {
    if (ocrZoomNativeSyncRef.current) clearTimeout(ocrZoomNativeSyncRef.current);
    ocrZoomNativeSyncRef.current = setTimeout(() => {
      ocrZoomNativeSyncRef.current = null;
      void setVoltClipTextCameraZoom(factor)
        .then((result) => {
          setOcrZoomFactor(result.factor);
          setOcrZoomMin(result.min ?? OCR_ZOOM_DEFAULT);
          setOcrZoomMax(result.max);
          ocrZoomMinRef.current = result.min ?? OCR_ZOOM_DEFAULT;
          ocrZoomMaxRef.current = result.max;
        })
        .catch((zoomError) => {
          setOcrZoomFactor(OCR_ZOOM_DEFAULT);
          setError(zoomError instanceof Error ? zoomError.message : "Camera zoom is not available.");
        });
    }, 36);
  }, []);
  const applyOcrZoomStop = useCallback(
    (factor: number, stopIndex: number, { haptic = true }: { haptic?: boolean } = {}) => {
      if (haptic && stopIndex !== ocrLastHapticStopIndexRef.current) {
        ocrLastHapticStopIndexRef.current = stopIndex;
        playVoltClipSelectionHaptic();
      }
      if (Math.abs(factor - ocrZoomFactorRef.current) < 0.001) return;
      setOcrZoomFactor(factor);
      ocrZoomFactorRef.current = factor;
      syncOcrZoomToNative(factor);
    },
    [syncOcrZoomToNative]
  );
  const commitOcrZoomSnap = useCallback(
    (factor: number) => {
      const max = ocrZoomMaxRef.current;
      const min = ocrZoomMinRef.current;
      const snapped = snapOcrZoomToStop(factor, min, max);
      const stopIndex = nearestOcrZoomStopIndex(snapped, min, max);
      applyOcrZoomStop(snapped, stopIndex, { haptic: stopIndex !== ocrLastHapticStopIndexRef.current });
      void setVoltClipTextCameraZoom(snapped)
        .then((result) => {
          setOcrZoomFactor(result.factor);
          setOcrZoomMin(result.min ?? OCR_ZOOM_DEFAULT);
          setOcrZoomMax(result.max);
          ocrZoomMinRef.current = result.min ?? OCR_ZOOM_DEFAULT;
          ocrZoomMaxRef.current = result.max;
          ocrZoomFactorRef.current = result.factor;
          ocrLastHapticStopIndexRef.current = nearestOcrZoomStopIndex(result.factor, result.min ?? OCR_ZOOM_DEFAULT, result.max);
        })
        .catch((zoomError) => {
          setOcrZoomFactor(OCR_ZOOM_DEFAULT);
          ocrZoomFactorRef.current = OCR_ZOOM_DEFAULT;
          setError(zoomError instanceof Error ? zoomError.message : "Camera zoom is not available.");
        });
    },
    [applyOcrZoomStop]
  );
  const ocrDrawerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dy) > 6 || Math.abs(gestureState.dx) > 6,
        onMoveShouldSetPanResponderCapture: (_, gestureState) =>
          Math.abs(gestureState.dy) > 6 || Math.abs(gestureState.dx) > 6,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          ocrDrawerDragStartRef.current = ocrDrawerProgressRef.current;
          ocrWheelDragStartStopIndexRef.current = nearestOcrZoomStopIndex(
            ocrZoomFactorRef.current,
            ocrZoomMinRef.current,
            ocrZoomMaxRef.current
          );
          ocrWheelDragStartEngagementRef.current = ocrWheelEngagementRef.current;
          ocrWheelDragDidEngageRef.current = false;
          ocrDrawerGestureAxisRef.current = null;
        },
        onPanResponderMove: (_, gestureState) => {
          if (!ocrDrawerGestureAxisRef.current) {
            const absDx = Math.abs(gestureState.dx);
            const absDy = Math.abs(gestureState.dy);
            if (absDx > 8 || absDy > 8) {
              if (ocrDrawerProgressRef.current < 0.12 && absDx > absDy * 0.92) {
                ocrDrawerGestureAxisRef.current = "horizontal";
                ocrWheelDragDidEngageRef.current = true;
                playVoltClipSelectionHaptic();
              } else {
                ocrDrawerGestureAxisRef.current = "vertical";
              }
            }
          }

          if (ocrDrawerGestureAxisRef.current === "horizontal" && ocrDrawerProgressRef.current < 0.18) {
            const engagement = Math.min(1, Math.max(ocrWheelDragStartEngagementRef.current, Math.abs(gestureState.dx) / 54));
            ocrWheelEngagement.setValue(engagement);
            const stops = getOcrZoomStops(ocrZoomMinRef.current, ocrZoomMaxRef.current);
            const deltaStops = Math.round(-gestureState.dx / OCR_ZOOM_WHEEL_DRAG_PER_STOP);
            const nextIndex = Math.max(0, Math.min(stops.length - 1, ocrWheelDragStartStopIndexRef.current + deltaStops));
            applyOcrZoomStop(stops[nextIndex], nextIndex);
            return;
          }

          const dragRange = Math.max(ocrDrawerExpandedHeight - ocrDrawerCollapsedHeight, 220);
          const nextValue = ocrDrawerDragStartRef.current - gestureState.dy / dragRange;
          ocrDrawerProgress.setValue(Math.max(0, Math.min(1, nextValue)));
        },
        onPanResponderRelease: (_, gestureState) => {
          if (ocrDrawerGestureAxisRef.current === "horizontal" && ocrDrawerProgressRef.current < 0.18) {
            commitOcrZoomSnap(ocrZoomFactorRef.current);
            animateOcrWheelEngagementTo(1);
            ocrDrawerGestureAxisRef.current = null;
            return;
          }

          ocrDrawerGestureAxisRef.current = null;
          const shouldExpand = gestureState.vy < -0.35 || (gestureState.vy < 0.35 && ocrDrawerProgressRef.current > 0.42);
          animateOcrDrawerTo(shouldExpand ? 1 : 0);
          if (shouldExpand) {
            animateOcrWheelEngagementTo(1);
          }
        },
        onPanResponderTerminate: () => {
          ocrDrawerGestureAxisRef.current = null;
          animateOcrDrawerTo(ocrDrawerProgressRef.current > 0.5 ? 1 : 0);
        },
      }),
    [
      animateOcrDrawerTo,
      animateOcrWheelEngagementTo,
      applyOcrZoomStop,
      commitOcrZoomSnap,
      ocrDrawerCollapsedHeight,
      ocrDrawerExpandedHeight,
      ocrDrawerProgress,
      ocrWheelEngagement,
    ]
  );
  const statusText = useMemo(() => {
    if (!session) {
      if (scannerState === "starting") return "Starting QR scanner";
      if (scannerState === "ready") return "Scan the Chrome side-panel QR";
      if (scannerState === "unavailable") return "QR scanner unavailable";
      if (scannerState === "error") return "QR scanner failed";
      return "Ready to pair";
    }
    if (sendState === "sending") return "Sending result";
    if (sendState === "sent") return "Result sent";
    if (sendState === "error") return "Send failed";
    if (mode === "barcode" && scannerState === "starting") return "Starting camera";
    if (mode === "barcode" && scannerState === "ready") return "Scanning for barcode";
    if (mode === "barcode" && scannerState === "unavailable") return "Scanner unavailable";
    if (mode === "barcode" && scannerState === "error") return "Scanner failed";
    if (mode === "ocr" && ocrState === "capturing") return "Reading text";
    if (mode === "ocr" && ocrPreviewState === "starting") return "Starting camera";
    if (mode === "ocr" && ocrPreviewState === "failed") return "Camera preview unavailable";
    if (mode === "ocr" && capturedOcrImageUri) return "Select text and copy";
    if (mode === "ocr" && ocrText.trim()) return "Text ready";
    if (mode === "ocr" && ocrState === "unavailable") return "OCR unavailable";
    if (mode === "ocr" && ocrState === "error") return "OCR failed";
    if (mode === "dictation" && dictationState === "requesting") return "Requesting microphone";
    if (mode === "dictation" && dictationState === "recording") return "Listening";
    if (mode === "dictation" && dictationFinal) return "Transcript ready";
    if (mode === "dictation" && dictationState === "unavailable") return "Dictation unavailable";
    if (mode === "dictation" && dictationState === "error") return "Dictation failed";
    return "Browser session found";
  }, [capturedOcrImageUri, dictationFinal, dictationState, mode, ocrPreviewState, ocrState, ocrText, scannerState, sendState, session]);

  const showMeasuredOcrPreview = useCallback(() => {
    if (!isCameraCaptureMode || !hasVoltClipTextRecognizer || capturedOcrImageUri) return;

    setOcrPreviewState("starting");
    showVoltClipTextPreview({
      x: 0,
      y: 0,
      width: windowDimensions.width,
      height: windowDimensions.height,
    });
    setOcrPreviewState("ready");
  }, [capturedOcrImageUri, isCameraCaptureMode, windowDimensions.height, windowDimensions.width]);

  useEffect(() => {
    if (!isCameraCaptureMode || !hasVoltClipTextRecognizer || capturedOcrImageUri) {
      hideVoltClipTextPreview();
      return;
    }

    showMeasuredOcrPreview();
    const timer = setTimeout(showMeasuredOcrPreview, 150);
    return () => {
      clearTimeout(timer);
      hideVoltClipTextPreview();
    };
  }, [capturedOcrImageUri, isCameraCaptureMode, showMeasuredOcrPreview]);

  useEffect(() => {
    let mounted = true;

    Linking.getInitialURL()
      .then((url) => {
        if (!mounted || !url) return;
        setInvocation(parseCaptureInvocation(url));
      })
      .catch(() => {
        if (mounted) setInvocation(null);
      });

    const subscription = Linking.addEventListener("url", ({ url }) => {
      setInvocation(parseCaptureInvocation(url));
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    setActiveMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (!isCameraCaptureMode) return;

    if (!hasVoltClipTextRecognizer) {
      setOcrState("unavailable");
      setError("OCR camera is unavailable in this App Clip build.");
      return;
    }

    setOcrState("ready");
    void setVoltClipTextCameraZoom(OCR_ZOOM_DEFAULT)
      .then((result) => {
        setOcrZoomFactor(result.factor);
        setOcrZoomMin(result.min ?? OCR_ZOOM_DEFAULT);
        setOcrZoomMax(result.max);
        ocrZoomFactorRef.current = result.factor;
        ocrZoomMinRef.current = result.min ?? OCR_ZOOM_DEFAULT;
        ocrZoomMaxRef.current = result.max;
        ocrLastHapticStopIndexRef.current = nearestOcrZoomStopIndex(result.factor, result.min ?? OCR_ZOOM_DEFAULT, result.max);
      })
      .catch(() => {
        setOcrZoomFactor(OCR_ZOOM_DEFAULT);
        ocrZoomFactorRef.current = OCR_ZOOM_DEFAULT;
      });
  }, [isCameraCaptureMode]);

  useEffect(() => {
    if (mode !== "barcode" && !isDiscoveryMode) return;

    if (!hasVoltClipBarcodeScanner) {
      setScannerState("unavailable");
      return;
    }

    let isMounted = true;
    const shouldAcceptCandidate = createBarcodeCandidateGuard();
    const candidateSubscription = addVoltClipBarcodeCandidateListener((candidate) => {
      if (!shouldAcceptCandidate(candidate)) return;
      playVoltClipSelectionHaptic();
      if (isDiscoveryMode) {
        setBarcodeCandidate(candidate);
        const nextInvocation = parseCaptureInvocation(candidate.value);
        if (nextInvocation) {
          setInvocation(nextInvocation);
          setActiveMode(nextInvocation.mode);
          setBarcodeCandidate(null);
          setError(null);
          setSendState("idle");
        }
        return;
      }
      setBarcodeCandidate(candidate);
    });
    const errorSubscription = addVoltClipBarcodeErrorListener((message) => {
      setScannerState("error");
      setError(message);
    });

    setScannerState("starting");
    startVoltClipBarcodeScanner({ fullFrame: isDiscoveryMode || barcodeFullFrameScan })
      .then(() => {
        if (isMounted) setScannerState("ready");
      })
      .catch((startError) => {
        if (!isMounted) return;
        setScannerState("error");
        setError(startError instanceof Error ? startError.message : "Unable to start barcode scanner");
      });

    return () => {
      isMounted = false;
      candidateSubscription.remove();
      errorSubscription.remove();
      void stopVoltClipBarcodeScanner();
    };
  }, [barcodeFullFrameScan, isDiscoveryMode, mode]);

  useEffect(() => {
    if (mode !== "dictation") return;

    if (!hasVoltClipDictation) {
      setDictationState("unavailable");
      return;
    }

    const partialSubscription = addVoltClipDictationPartialListener((transcript) => {
      setDictationTranscript(transcript);
      setDictationFinal(false);
    });
    const finalSubscription = addVoltClipDictationFinalListener((transcript) => {
      setDictationTranscript(transcript);
      setDictationFinal(true);
      setDictationState("ready");
      void sendRelayMessage("dictation", makeDictationMessage(transcript, `clip-${session}`));
    });
    const errorSubscription = addVoltClipDictationErrorListener((message) => {
      setDictationState("error");
      setError(message);
    });

    setDictationState("ready");

    return () => {
      partialSubscription.remove();
      finalSubscription.remove();
      errorSubscription.remove();
      void stopVoltClipDictation();
    };
  }, [mode, session]);

  useEffect(() => {
    if (mode !== "ocr" && mode !== "photo") return;

    const subscription = addVoltClipTextCaptureListener((result) => {
      if (result.imageUri) {
        setOcrFrozenImageUri(result.imageUri);
        setOcrImageUri(result.imageUri);
        hideVoltClipTextPreview();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [mode]);

  async function toggleDictation() {
    if (mode !== "dictation") return;

    if (dictationState === "recording") {
      setDictationState("ready");
      await stopVoltClipDictation();
      return;
    }

    setError(null);
    setDictationFinal(false);
    setSendState("idle");
    setDictationState("requesting");
    await stopVoltClipBarcodeScanner();
    hideVoltClipTextPreview();

    try {
      const permissions = await requestVoltClipDictationPermissions();
      if (!permissions.granted) {
        setDictationState("error");
        setError("Microphone and speech recognition permissions are required.");
        showDictationPermissionRecovery(permissions.speechStatus, permissions.microphoneGranted);
        return;
      }

      setDictationTranscript("");
      const result = await startVoltClipDictation({ addsPunctuation: dictationAddsPunctuation });
      if (!result.running) {
        setDictationState("error");
        setError("Dictation did not start. Try again.");
        return;
      }
      setDictationState("recording");
    } catch (dictationError) {
      setDictationState("error");
      const message = dictationError instanceof Error ? dictationError.message : "Unable to start dictation";
      setError(message);
      if (/permission|authorized|microphone/i.test(message)) {
        const permissions = await getVoltClipDictationPermissions().catch(() => ({
          granted: false,
          speechStatus: "denied",
          microphoneGranted: false,
        }));
        showDictationPermissionRecovery(permissions.speechStatus, permissions.microphoneGranted);
      }
    }
  }

  async function startDictationFromShutter() {
    if (mode !== "dictation" || dictationState === "recording" || dictationState === "requesting" || sendState === "sending") return;
    if (dictationFinal) {
      setDictationTranscript("");
      setDictationFinal(false);
      setSendState("idle");
      setError(null);
    }
    await toggleDictation();
  }

  async function stopDictationFromShutter() {
    if (mode !== "dictation" || dictationState !== "recording") return;
    await toggleDictation();
  }

  function undoDictation() {
    if (mode !== "dictation" || !dictationFinal) return;
    setDictationTranscript("");
    setDictationFinal(false);
    setSendState("idle");
    setError(null);
  }

  function showDictationPermissionRecovery(speechStatus: string, microphoneGranted: boolean) {
    const canPromptAgain = canRequestDictationPermissionAgain(speechStatus, microphoneGranted);
    Alert.alert(
      "Enable dictation",
      "Volt needs microphone and speech recognition access to dictate into Chrome.",
      [
        { text: "Cancel", style: "cancel" },
        canPromptAgain
          ? {
              text: "Try Again",
              onPress: () => void toggleDictation(),
            }
          : {
              text: "Open Settings",
              onPress: () => {
                void Linking.openSettings().catch(() => {
                  setError("Open Settings and allow Microphone and Speech Recognition for Volt.");
                });
              },
            },
      ]
    );
  }

  async function captureText() {
    if ((mode !== "ocr" && mode !== "photo") || sendState === "sending" || sendState === "sent") return;

    setError(null);
    setOcrState("capturing");
    hideVoltClipTextPreview();

    try {
      const result = await captureAndRecognizeVoltClipText();
      setOcrText(result.text);
      setOcrImageUri(result.imageUri ?? null);
      hideVoltClipTextPreview();
      setOcrState("ready");
      if (mode === "photo" && result.dataUrl) {
        await sendRelayMessage(
          "photo",
          makePhotoMessage({
            id: `clip-photo-${Date.now()}`,
            name: `volt-photo-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`,
            mimeType: "image/jpeg",
            dataUrl: result.dataUrl,
            size: Number(result.size ?? 0),
            width: result.width ? Number(result.width) : undefined,
            height: result.height ? Number(result.height) : undefined,
            capturedAt: new Date().toISOString(),
          })
        );
      }
    } catch (captureError) {
      setOcrState("error");
      setError(captureError instanceof Error ? captureError.message : "Unable to capture text");
    }
  }

  function renderOcrShutter() {
    const isBusy = ocrState === "capturing" || sendState === "sending";
    const renderMicIcon = () => (
      <View style={styles.ocrMicIcon}>
        <View style={styles.ocrMicCapsule} />
        <View style={styles.ocrMicStem} />
        <View style={styles.ocrMicBase} />
      </View>
    );
    const renderUndoIcon = () => (
      <View style={styles.ocrUndoIcon}>
        <Text style={styles.ocrUndoIconText}>↶</Text>
      </View>
    );
    const renderRefreshIcon = () => (
      <View style={styles.ocrRefreshIcon}>
        <Text style={styles.ocrRefreshIconText}>↻</Text>
      </View>
    );
    const renderBarcodeIcon = () => (
      <View style={styles.ocrBarcodeIcon}>
        {[4, 2, 6, 3, 5].map((width, index) => (
          <View key={index} style={[styles.ocrBarcodeIconBar, { width }]} />
        ))}
      </View>
    );
    if (mode === "dictation") {
      const dictationBusy = dictationState === "requesting" || sendState === "sending";
      const handleDictationPress = () => {
        if (dictationLongPressRef.current) {
          dictationLongPressRef.current = false;
          return;
        }
        if (dictationFinal) {
          undoDictation();
          return;
        }
        void toggleDictation();
      };
      const handleDictationLongPress = () => {
        dictationLongPressRef.current = true;
        void startDictationFromShutter();
      };
      const handleDictationPressOut = () => {
        if (!dictationLongPressRef.current) return;
        void stopDictationFromShutter();
        setTimeout(() => {
          dictationLongPressRef.current = false;
        }, 0);
      };
      return (
        <Pressable
          accessibilityLabel={dictationFinal ? "Undo dictation" : "Hold to dictate"}
          accessibilityRole="button"
          disabled={dictationBusy}
          delayLongPress={180}
          onLongPress={handleDictationLongPress}
          onPress={handleDictationPress}
          onPressOut={handleDictationPressOut}
          style={[
            styles.ocrShutterButton,
            dictationState === "recording" && styles.ocrShutterButtonActive,
            dictationBusy && styles.ocrShutterButtonDisabled,
          ]}
        >
          <View style={styles.ocrShutterInner}>
            {dictationFinal ? renderUndoIcon() : renderMicIcon()}
          </View>
        </Pressable>
      );
    }
    if (mode === "barcode") {
      const barcodeBusy = sendState === "sending";
      const barcodeDisabled = !barcodeCandidate || barcodeBusy;
      return (
        <Pressable
          accessibilityLabel={barcodeCandidate ? "Send barcode to Chrome" : "Center a barcode"}
          accessibilityRole="button"
          disabled={barcodeDisabled}
          onPress={() => void sendResult()}
          style={[
            styles.ocrShutterButton,
            barcodeCandidate && styles.ocrShutterButtonActive,
            barcodeDisabled && styles.ocrShutterButtonDisabled,
          ]}
        >
          <View style={styles.ocrShutterInner}>
            {barcodeBusy ? <Text style={styles.ocrShutterIcon}>...</Text> : renderBarcodeIcon()}
          </View>
        </Pressable>
      );
    }
    return (
      <Pressable
        accessibilityLabel={capturedOcrImageUri ? "Retake text capture" : "Capture text"}
        accessibilityRole="button"
        disabled={isBusy}
        onPress={() => {
          if (capturedOcrImageUri) {
            resetOcrCapture();
            return;
          }
          void captureText();
        }}
        style={[styles.ocrShutterButton, isBusy && styles.ocrShutterButtonDisabled]}
      >
        <View style={styles.ocrShutterInner}>
          {isBusy ? (
            <Text style={styles.ocrShutterIcon}>...</Text>
          ) : capturedOcrImageUri && mode === "ocr" ? (
            renderRefreshIcon()
          ) : (
            <View style={styles.ocrShutterDot} />
          )}
        </View>
      </Pressable>
    );
  }

  const sendOcrClipboardText = useCallback(
    async (text: string, insertIntoCursor: boolean) => {
      const value = text.trim();
      if (!session || !value || value === lastOcrClipboardRef.current || sendState === "sending") return;

      lastOcrClipboardRef.current = value;
      setOcrText(value);
      setSendState("sending");
      setError(null);

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), RESULT_SEND_TIMEOUT_MS);

      try {
        const response = await fetch(`${SCANNER_SIGNAL_URL}/${encodeURIComponent(session)}/result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abortController.signal,
          body: JSON.stringify(makeClipRelayResult("ocr", makeOcrMessage(value, insertIntoCursor))),
        });

        if (!response.ok) {
          if (response.status === 400 || response.status === 404 || response.status === 410) {
            resetToDiscoveryMode();
            return;
          }
          throw new Error(messageForClipRelayStatus(response.status));
        }

        setSendState("sent");
      } catch (sendError) {
        if (sendError instanceof Error && sendError.name === "AbortError") {
          resetToDiscoveryMode("Browser session stopped responding. Scan the Mobile Scanner QR in Chrome to pair again.");
          return;
        }
        setSendState("error");
        setError(
          sendError instanceof Error
              ? sendError.message
              : "Unable to send copied text"
        );
      } finally {
        clearTimeout(timeoutId);
      }
    },
    [resetToDiscoveryMode, sendState, session]
  );

  useEffect(() => {
    if (mode !== "ocr" || !capturedOcrImageUri || !hasVoltClipClipboard) return;

    let cancelled = false;
    let checkingClipboard = false;

    void getVoltClipClipboardChangeCount()
      .then((value) => {
        if (!cancelled) lastOcrClipboardChangeCountRef.current = value;
      })
      .catch(() => {
        if (!cancelled) lastOcrClipboardChangeCountRef.current = null;
      });

    const checkClipboard = async () => {
      if (cancelled || checkingClipboard || sendState === "sending") return;
      checkingClipboard = true;
      try {
        const changeCount = await getVoltClipClipboardChangeCount();
        if (cancelled || changeCount === lastOcrClipboardChangeCountRef.current) return;
        lastOcrClipboardChangeCountRef.current = changeCount;

        const value = (await getVoltClipClipboardString()).trim();
        if (!cancelled && value && value !== lastOcrClipboardRef.current) {
          await sendOcrClipboardText(value, ocrAutoTypeCopiedText);
        }
      } finally {
        checkingClipboard = false;
      }
    };

    const pollTimer = setInterval(checkClipboard, CLIPBOARD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(pollTimer);
    };
  }, [capturedOcrImageUri, mode, ocrAutoTypeCopiedText, sendOcrClipboardText, sendState]);

  useEffect(() => {
    const subscription = ocrDrawerProgress.addListener(({ value }) => {
      ocrDrawerProgressRef.current = value;
    });
    return () => {
      ocrDrawerProgress.removeListener(subscription);
    };
  }, [ocrDrawerProgress]);

  useEffect(() => {
    const subscription = ocrWheelEngagement.addListener(({ value }) => {
      ocrWheelEngagementRef.current = value;
    });
    return () => {
      ocrWheelEngagement.removeListener(subscription);
    };
  }, [ocrWheelEngagement]);

  useEffect(() => {
    ocrZoomFactorRef.current = ocrZoomFactor;
  }, [ocrZoomFactor]);

  useEffect(() => {
    ocrZoomMaxRef.current = ocrZoomMax;
  }, [ocrZoomMax]);

  useEffect(
    () => () => {
      if (ocrZoomNativeSyncRef.current) clearTimeout(ocrZoomNativeSyncRef.current);
    },
    []
  );

  useEffect(() => {
    if (mode !== "barcode" || !barcodeAutoSend || !barcodeCandidate || sendState !== "idle") return;
    void sendResult();
  }, [barcodeAutoSend, barcodeCandidate, mode, sendState]);

  async function sendRelayMessage(relayMode: ScannerCaptureMode, message: ReturnType<typeof makeBarcodeMessage> | ReturnType<typeof makeDictationMessage> | ReturnType<typeof makePhotoMessage>) {
    if (!session) return;
    setSendState("sending");
    setError(null);
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), RESULT_SEND_TIMEOUT_MS);

    try {
      const response = await fetch(`${SCANNER_SIGNAL_URL}/${encodeURIComponent(session)}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify(makeClipRelayResult(relayMode, message)),
      });

      if (!response.ok) {
        if (response.status === 400 || response.status === 404 || response.status === 410) {
          resetToDiscoveryMode();
          return;
        }
        throw new Error(messageForClipRelayStatus(response.status));
      }

      setSendState("sent");
      if (relayMode === "barcode") {
        void stopVoltClipBarcodeScanner();
      }
      if (relayMode === "dictation" && "dictationPhase" in message && message.dictationPhase === "final") {
        void stopVoltClipDictation();
      }
    } catch (sendError) {
      if (sendError instanceof Error && sendError.name === "AbortError") {
        resetToDiscoveryMode("Browser session stopped responding. Scan the Mobile Scanner QR in Chrome to pair again.");
        return;
      }
      setSendState("error");
      setError(
        sendError instanceof Error
            ? sendError.message
            : "Unable to send result"
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function sendResult() {
    if (!mode || !session) return;

    const message =
      mode === "barcode" && barcodeCandidate
        ? makeBarcodeMessage(barcodeCandidate.value, barcodeCandidate.format, barcodeInsertIntoCursor)
        : mode === "ocr" && ocrText.trim()
          ? makeOcrMessage(ocrText.trim(), ocrAutoTypeCopiedText)
        : mode === "dictation" && dictationTranscript.trim()
          ? makeDictationMessage(dictationTranscript.trim(), `clip-${session}`)
        : makeTestMessage(mode);

    await sendRelayMessage(mode, message);
  }

  const sessionTargetHost = (() => {
    if (!sessionTarget?.url) return null;
    try {
      return new URL(sessionTarget.url).hostname.replace(/^www\./, "");
    } catch (_error) {
      return null;
    }
  })();

  const shutterHint = (() => {
    if (isDiscoveryMode) {
      if (scannerState === "starting") return "Starting QR discovery...";
      if (barcodeCandidate) return "QR code detected. Looking for Volt pairing session...";
      if (scannerState === "unavailable") return "QR discovery unavailable. Open Mobile Scanner in Chrome.";
      if (scannerState === "error") return "QR discovery failed. Open a fresh Mobile Scanner QR in Chrome.";
      return "Scan Chrome QR";
    }
    if (mode === "dictation") {
      if (dictationState === "error" && error) return "Dictation needs permission";
      if (dictationState === "requesting") return "Starting...";
      if (dictationState === "recording") return "Tap or release to end dictation";
      if (dictationFinal) return "Transcript ready";
      return "Hold to dictate";
    }
    if (mode === "ocr") {
      if (ocrState === "capturing") return "Reading text...";
      if (capturedOcrImageUri) return "Select & copy text to send";
      return "Tap shutter to capture text";
    }
    if (mode === "photo") {
      if (ocrState === "capturing" || sendState === "sending") return "Sending photo...";
      if (ocrImageUri) return "Photo sent to Chrome";
      return "Tap shutter to capture photo";
    }
    if (mode === "barcode") return barcodeCandidate ? "Barcode found. Tap shutter to send." : "Center a barcode or QR code";
    return "Scan a fresh QR code from the Volt Chrome extension.";
  })();

  const footerMessage = (() => {
    if (!mode || !session) return "Open the Volt Chrome extension side panel and scan its Mobile Scanner QR to pair this App Clip.";
    if (sendState === "sent") {
      return "Result sent. Return to Chrome; if the page blocked insertion, Volt will use its clipboard fallback.";
    }
    if (sendState === "error") return error || "Send failed. Keep the QR overlay open and try again.";
    if (error) return error;
    if (mode === "barcode") return "Camera detection runs in the App Clip target.";
    if (mode === "ocr") {
      if (ocrImageUri) return "Select text in the captured image, then tap Copy to send it to Chrome.";
      return "Vision OCR runs in the App Clip target.";
    }
    if (mode === "dictation") {
      return dictationFinal ? "Final transcript is ready to send." : "Dictation sends only a final transcript.";
    }
    return "Ready for the App Clip capture module.";
  })();
  const ocrBottomSheetAnimatedStyle = {
    left: ocrDrawerProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [ocrDrawerCollapsedInset, ocrDrawerExpandedInset],
      extrapolate: "clamp",
    }),
    right: ocrDrawerProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [ocrDrawerCollapsedInset, ocrDrawerExpandedInset],
      extrapolate: "clamp",
    }),
    bottom: ocrDrawerProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [ocrDrawerCollapsedBottom, ocrDrawerExpandedBottom],
      extrapolate: "clamp",
    }),
    height: ocrDrawerProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [ocrDrawerCollapsedHeight, ocrDrawerExpandedHeight],
      extrapolate: "clamp",
    }),
    paddingTop: ocrDrawerProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [12, 14],
      extrapolate: "clamp",
    }),
    borderRadius: ocrDrawerProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [ocrDrawerCollapsedRadius, ocrDrawerExpandedRadius],
      extrapolate: "clamp",
    }),
    borderBottomLeftRadius: ocrDrawerProgress.interpolate({
      inputRange: [0, 0.82, 1],
      outputRange: [ocrDrawerCollapsedRadius, ocrDrawerExpandedRadius, ocrDrawerExpandedRadius],
      extrapolate: "clamp",
    }),
    borderBottomRightRadius: ocrDrawerProgress.interpolate({
      inputRange: [0, 0.82, 1],
      outputRange: [ocrDrawerCollapsedRadius, ocrDrawerExpandedRadius, ocrDrawerExpandedRadius],
      extrapolate: "clamp",
    }),
    transform: [
      {
        translateY: ocrDrawerProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, 0],
        }),
      },
    ],
  };
  const ocrBottomSheetGlassAnimatedStyle = {
    opacity: ocrDrawerProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0.82, 1],
      extrapolate: "clamp",
    }),
  };
  const ocrBottomSheetTintAnimatedStyle = {
    opacity: ocrDrawerProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0.12, 0.28],
      extrapolate: "clamp",
    }),
  };
  const ocrHintAnimatedStyle = {
    bottom: ocrDrawerProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [ocrDrawerCollapsedBottom + ocrDrawerCollapsedHeight + 12, ocrDrawerExpandedBottom + ocrDrawerExpandedHeight + 12],
    }),
    opacity: ocrDrawerProgress.interpolate({
      inputRange: [0, 0.25],
      outputRange: [1, 0],
      extrapolate: "clamp",
    }),
  };
  const ocrFloatingShutterAnimatedStyle = {
    bottom: ocrDrawerProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [ocrDrawerCollapsedBottom + ocrDrawerCollapsedHeight + 62, ocrDrawerExpandedBottom + ocrDrawerExpandedHeight + 62],
    }),
    opacity: ocrDrawerProgress.interpolate({
      inputRange: [0, 0.82, 1],
      outputRange: [1, 1, 0],
      extrapolate: "clamp",
    }),
  };
  const ocrExpandedControlsAnimatedStyle = {
    maxHeight: ocrDrawerProgress.interpolate({
      inputRange: [0, 0.28, 1],
      outputRange: [0, 0, 720],
      extrapolate: "clamp",
    }),
    opacity: ocrDrawerProgress.interpolate({
      inputRange: [0, 0.35, 1],
      outputRange: [0, 0, 1],
      extrapolate: "clamp",
    }),
    overflow: "hidden" as const,
    transform: [
      {
        translateY: ocrDrawerProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0],
        }),
      },
    ],
  };
  const ocrCollapsedControlsAnimatedStyle = {
    opacity: ocrDrawerProgress.interpolate({
      inputRange: [0, 0.22, 0.42],
      outputRange: [1, 0.42, 0],
      extrapolate: "clamp",
    }),
    transform: [
      {
        translateY: ocrDrawerProgress.interpolate({
          inputRange: [0, 0.35],
          outputRange: [0, 10],
          extrapolate: "clamp",
        }),
      },
    ],
  };
  const ocrZoomWheelAnimatedStyle = {
    opacity: ocrWheelEngagement.interpolate({
      inputRange: [0, 0.18, 1],
      outputRange: [0, 0.35, 1],
      extrapolate: "clamp",
    }),
    transform: [
      {
        translateY: ocrWheelEngagement.interpolate({
          inputRange: [0, 1],
          outputRange: [12, 0],
          extrapolate: "clamp",
        }),
      },
      {
        scale: ocrWheelEngagement.interpolate({
          inputRange: [0, 1],
          outputRange: [0.94, 1],
          extrapolate: "clamp",
        }),
      },
    ],
  };
  const ocrZoomWheelTrackOffset = ocrZoomToWheelOffset(ocrZoomFactor, ocrZoomMin, ocrZoomMax);
  const ocrZoomWheelViewportWidth = Math.max(windowDimensions.width - 36, 240);
  const ocrZoomWheelTranslateX = ocrZoomWheelViewportWidth / 2 - ocrZoomWheelTrackOffset - OCR_ZOOM_WHEEL_TICK_SPACING / 2;
  const ocrDrawerHandleAnimatedStyle = {
    width: ocrDrawerProgress.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [44, 58, 38],
      extrapolate: "clamp",
    }),
    opacity: ocrDrawerProgress.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.72, 1, 0.66],
      extrapolate: "clamp",
    }),
    transform: [
      {
        translateY: ocrDrawerProgress.interpolate({
          inputRange: [0, 0.55, 1],
          outputRange: [0, -1, 1],
          extrapolate: "clamp",
        }),
      },
      {
        scaleX: ocrDrawerProgress.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [1, 1.08, 0.92],
          extrapolate: "clamp",
        }),
      },
    ],
  };
  const ocrExpandedSheetTabAnimatedStyle = {
    opacity: ocrDrawerProgress.interpolate({
      inputRange: [0, 0.72, 1],
      outputRange: [0, 0, 1],
      extrapolate: "clamp",
    }),
    transform: [
      {
        translateY: ocrDrawerProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0],
          extrapolate: "clamp",
        }),
      },
      {
        scale: ocrDrawerProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0.92, 1],
          extrapolate: "clamp",
        }),
      },
    ],
  };
  const switchClipMode = useCallback((nextMode: ScannerCaptureMode) => {
    if (nextMode === mode) return;
    setActiveMode(nextMode);
    setSendState("idle");
    setError(null);
    setBarcodeCandidate(null);
    if (nextMode !== "dictation") {
      setDictationTranscript("");
      setDictationFinal(false);
    }
    if (nextMode !== "ocr" && nextMode !== "photo") {
      setOcrImageUri(null);
      setOcrFrozenImageUri(null);
      setOcrText("");
    }
  }, [mode]);
  const ocrBottomSheetToneStyle =
    ocrGlassTone === "bright"
      ? styles.ocrBottomSheetBright
      : ocrGlassTone === "dark"
        ? styles.ocrBottomSheetDark
        : styles.ocrBottomSheetAdaptive;
  const setOcrTorch = useCallback(async (enabled: boolean) => {
    setOcrTorchEnabled(enabled);
    try {
      const result = await setVoltClipTextCameraTorch(enabled);
      setOcrTorchEnabled(result.enabled);
    } catch (torchError) {
      setOcrTorchEnabled(false);
      setError(torchError instanceof Error ? torchError.message : "Torch is not available.");
    }
  }, []);
  const setOcrZoom = useCallback(async (factor: number) => {
    const min = ocrZoomMinRef.current;
    const max = ocrZoomMaxRef.current;
    const snapped = snapOcrZoomToStop(factor, min, max);
    const stopIndex = nearestOcrZoomStopIndex(snapped, min, max);
    setOcrZoomFactor(snapped);
    ocrZoomFactorRef.current = snapped;
    ocrLastHapticStopIndexRef.current = stopIndex;
    try {
      const result = await setVoltClipTextCameraZoom(snapped);
      setOcrZoomFactor(result.factor);
      setOcrZoomMin(result.min ?? OCR_ZOOM_DEFAULT);
      setOcrZoomMax(result.max);
      ocrZoomMinRef.current = result.min ?? OCR_ZOOM_DEFAULT;
      ocrZoomMaxRef.current = result.max;
      ocrZoomFactorRef.current = result.factor;
      ocrLastHapticStopIndexRef.current = nearestOcrZoomStopIndex(result.factor, result.min ?? OCR_ZOOM_DEFAULT, result.max);
    } catch (zoomError) {
      setOcrZoomFactor(OCR_ZOOM_DEFAULT);
      ocrZoomFactorRef.current = OCR_ZOOM_DEFAULT;
      ocrLastHapticStopIndexRef.current = nearestOcrZoomStopIndex(OCR_ZOOM_DEFAULT, min, max);
      setError(zoomError instanceof Error ? zoomError.message : "Camera zoom is not available.");
    }
  }, []);
  const focusOcrCamera = useCallback(
    (event: GestureResponderEvent) => {
      if (capturedOcrImageUri || !isCameraCaptureMode) return;

      const { locationX, locationY, pageX, pageY } = event.nativeEvent;
      const x = Math.max(0, Math.min(pageX / windowDimensions.width, 1));
      const y = Math.max(0, Math.min(pageY / windowDimensions.height, 1));
      setOcrFocusPoint({ x: locationX, y: locationY });
      setError(null);
      void focusVoltClipTextCamera(x, y).catch((focusError) => {
        setError(focusError instanceof Error ? focusError.message : "Tap to focus is unavailable.");
      });
      setTimeout(() => setOcrFocusPoint(null), 900);
    },
    [capturedOcrImageUri, isCameraCaptureMode, windowDimensions.height, windowDimensions.width]
  );

  if (isOcrMode) {
    return (
      <View style={styles.ocrRoot}>
        <View style={styles.ocrCameraSurface}>
            {!capturedOcrImageUri && hasVoltClipTextRecognizer ? (
              <Pressable
                accessibilityLabel="Tap camera preview to focus"
                accessibilityRole="button"
                onPress={focusOcrCamera}
                style={styles.ocrCameraTapLayer}
              />
            ) : null}
            {ocrFocusPoint ? (
              <View
                pointerEvents="none"
                style={[
                  styles.ocrFocusReticle,
                  {
                    left: ocrFocusPoint.x - 34,
                    top: ocrFocusPoint.y - 34,
                  },
                ]}
              />
            ) : null}
            {mode === "dictation" ? (
              <View style={styles.ocrDictationPanel}>
                <Text style={styles.ocrDictationKicker}>Dictating to</Text>
                <Text numberOfLines={2} style={styles.ocrDictationTargetTitle}>
                  {sessionTarget?.tabTitle || sessionTargetHost || "Current Chrome tab"}
                </Text>
                <Text numberOfLines={1} style={styles.ocrDictationTargetMeta}>
                  {sessionTarget?.browser || "Chrome"}{sessionTargetHost ? ` · ${sessionTargetHost}` : ""}
                </Text>
                <Text numberOfLines={2} style={styles.ocrDictationTargetCursor}>
                  {sessionTarget?.cursor || "Last focused editable field"}
                </Text>
                <View style={styles.ocrDictationTranscriptBox}>
                  <Text style={styles.ocrDictationText}>
                    {dictationTranscript || "Hold the mic and speak"}
                  </Text>
                </View>
              </View>
            ) : capturedOcrImageUri ? (
              <View style={styles.ocrCapturedSheet}>
                <View style={styles.ocrCapturedViewport}>
                  <ScrollView
                    automaticallyAdjustContentInsets={false}
                    bouncesZoom
                    centerContent
                    contentContainerStyle={[
                      styles.ocrCapturedScrollContent,
                      {
                        minHeight: windowDimensions.height + stableBottomInset + 240,
                        paddingBottom: ocrDrawerCollapsedHeight + stableBottomInset + 180,
                        paddingTop: stableTopInset + 72,
                      },
                    ]}
                    contentInsetAdjustmentBehavior="never"
                    maximumZoomScale={4}
                    minimumZoomScale={1}
                    pinchGestureEnabled
                    scrollEventThrottle={16}
                    showsHorizontalScrollIndicator={false}
                    showsVerticalScrollIndicator={false}
                    style={styles.ocrCapturedScroll}
                  >
                    <LiveTextImageView
                      imageUri={capturedOcrImageUri}
                      style={[
                        styles.ocrCapturedImage,
                        {
                          height: windowDimensions.height,
                          width: windowDimensions.width,
                        },
                      ]}
                    />
                  </ScrollView>
                </View>
                {mode === "ocr" ? (
                  <View pointerEvents="none" style={styles.ocrCopyPrompt}>
                    <Text style={styles.ocrCopyPromptText}>
                      {ocrText.trim() ? "Text found. Select and copy." : "Image frozen. Select text to copy."}
                    </Text>
                  </View>
                ) : null}
              </View>
          ) : hasVoltClipTextRecognizer ? (
            <></>
            ) : (
              <View style={styles.ocrUnavailablePanel}>
                <Text style={styles.ocrUnavailableText}>OCR camera unavailable</Text>
              </View>
            )}

            {isDiscoveryMode ? (
              <View pointerEvents="none" style={[styles.ocrBarcodeGuide, styles.ocrDiscoveryGuide]}>
                <View style={[styles.ocrDiscoveryFrame, barcodeCandidate && styles.ocrBarcodeGuideFrameActive]} />
                <NativeBarcodeHighlight candidate={barcodeCandidate} />
              </View>
            ) : mode === "barcode" ? (
              <View pointerEvents="none" style={styles.ocrBarcodeGuide}>
                <View style={[styles.ocrBarcodeGuideFrame, barcodeCandidate && styles.ocrBarcodeGuideFrameActive]} />
                <NativeBarcodeHighlight candidate={barcodeCandidate} />
                <Text numberOfLines={2} style={styles.ocrBarcodeGuideText}>
                  {barcodeCandidate ? barcodeCandidate.value : "Center barcode or QR code"}
                </Text>
              </View>
            ) : null}

        </View>
        <Animated.View style={[styles.ocrFloatingShutter, ocrFloatingShutterAnimatedStyle]}>
          {renderOcrShutter()}
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.ocrFloatingHint, ocrHintAnimatedStyle]}>
          <Text style={styles.ocrShutterLabel}>{shutterHint}</Text>
        </Animated.View>
        <Animated.View
          {...ocrDrawerPanResponder.panHandlers}
          style={[styles.ocrBottomSheet, ocrBottomSheetToneStyle, ocrBottomSheetAnimatedStyle]}
        >
          {AnimatedLiquidGlassView ? (
            <AnimatedLiquidGlassView
              pointerEvents="none"
              progress={ocrDrawerProgress as any}
              cornerRadius={ocrDrawerProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [ocrDrawerCollapsedRadius, ocrDrawerExpandedRadius],
              }) as any}
              tone={ocrGlassTone}
              style={[styles.ocrBottomSheetNativeGlass, ocrBottomSheetGlassAnimatedStyle]}
            />
          ) : (
            <Animated.View pointerEvents="none" style={[styles.ocrBottomSheetTint, ocrBottomSheetTintAnimatedStyle]} />
          )}
          <Pressable
            accessibilityLabel="Toggle controls drawer"
            accessibilityRole="button"
            onPress={() => animateOcrDrawerTo(ocrDrawerProgressRef.current > 0.5 ? 0 : 1)}
            style={styles.ocrDrawerHandleHitArea}
          >
            <Animated.View pointerEvents="none" style={[styles.ocrDrawerHandle, ocrDrawerHandleAnimatedStyle]} />
          </Pressable>
          <View style={styles.ocrBottomControls}>
            <Animated.View
              style={[
                styles.ocrCollapsedControls,
                ocrCollapsedControlsAnimatedStyle,
              ]}
            >
              {mode === "dictation" ? (
                <View style={styles.ocrDictationDestinationCard}>
                  <Text style={styles.ocrDictationDestinationLabel}>Destination</Text>
                  <Text numberOfLines={1} style={styles.ocrDictationDestinationTitle}>
                    {sessionTarget?.tabTitle || sessionTargetHost || "Current Chrome tab"}
                  </Text>
                  <Text numberOfLines={1} style={styles.ocrDictationDestinationMeta}>
                    {(sessionTarget?.browser || "Chrome") + (sessionTargetHost ? ` · ${sessionTargetHost}` : "")}
                  </Text>
                  <Text numberOfLines={1} style={styles.ocrDictationDestinationCursor}>
                    {sessionTarget?.cursor || "Last focused editable field"}
                  </Text>
                </View>
              ) : (
                <Animated.View style={[styles.ocrZoomWheel, ocrZoomWheelAnimatedStyle]}>
                  <Text style={styles.ocrZoomWheelLabel}>Zoom</Text>
                  <View style={[styles.ocrZoomWheelViewport, { width: ocrZoomWheelViewportWidth }]}>
                    <View style={[styles.ocrZoomWheelTrack, { transform: [{ translateX: ocrZoomWheelTranslateX }] }]}>
                      {getOcrZoomStops(ocrZoomMin, ocrZoomMax).map((stop) => (
                        <Pressable
                          accessibilityLabel={`Set zoom to ${formatOcrZoomLabel(stop)}`}
                          accessibilityRole="button"
                          accessibilityState={{ selected: Math.abs(ocrZoomFactor - stop) < 0.01 }}
                          key={stop}
                          onPress={() => commitOcrZoomSnap(stop)}
                          style={[
                            styles.ocrZoomWheelTick,
                            Math.abs(ocrZoomFactor - stop) < 0.01 && styles.ocrZoomWheelTickActive,
                          ]}
                        >
                          <View
                            style={[
                              styles.ocrZoomWheelTickMark,
                              Math.abs(ocrZoomFactor - stop) < 0.01 && styles.ocrZoomWheelTickMarkActive,
                            ]}
                          />
                          <Text
                            style={[
                              styles.ocrZoomWheelTickText,
                              Math.abs(ocrZoomFactor - stop) < 0.01 && styles.ocrZoomWheelTickTextActive,
                            ]}
                          >
                            {formatOcrZoomLabel(stop)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                </Animated.View>
              )}
            </Animated.View>
            <Animated.View style={[styles.ocrExpandedControls, ocrExpandedControlsAnimatedStyle]}>
              {mode !== "dictation" ? (
              <View style={styles.ocrCameraControls}>
                <Pressable
                  accessibilityLabel={ocrTorchEnabled ? "Turn torch off" : "Turn torch on"}
                  accessibilityRole="button"
                  accessibilityState={{ selected: ocrTorchEnabled }}
                  onPress={() => void setOcrTorch(!ocrTorchEnabled)}
                  style={[styles.ocrCameraControlButton, ocrTorchEnabled && styles.ocrCameraControlButtonActive]}
                >
                  <Text style={[styles.ocrCameraControlButtonText, ocrTorchEnabled && styles.ocrCameraControlButtonTextActive]}>
                    Torch
                  </Text>
                  <Text style={styles.ocrCameraControlButtonMeta}>{ocrTorchEnabled ? "On" : "Off"}</Text>
                </Pressable>
                <View style={styles.ocrCameraControlReadout}>
                  <Text style={styles.ocrCameraControlReadoutLabel}>Zoom</Text>
                  <Text style={styles.ocrCameraControlReadoutValue}>{formatOcrZoomLabel(ocrZoomFactor)}</Text>
                </View>
                <Pressable
                  accessibilityLabel="Reset zoom to 1x"
                  accessibilityRole="button"
                  disabled={Math.abs(ocrZoomFactor - OCR_ZOOM_DEFAULT) < 0.04}
                  onPress={() => {
                    void setOcrZoom(OCR_ZOOM_DEFAULT);
                    animateOcrWheelEngagementTo(1);
                  }}
                  style={[
                    styles.ocrCameraControlButton,
                    Math.abs(ocrZoomFactor - OCR_ZOOM_DEFAULT) < 0.01 && styles.ocrCameraControlButtonDisabled,
                  ]}
                >
                  <Text style={styles.ocrCameraControlButtonText}>Reset</Text>
                  <Text style={styles.ocrCameraControlButtonMeta}>1x</Text>
                </Pressable>
              </View>
              ) : null}
              {mode === "ocr" ? (
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: ocrAutoTypeCopiedText }}
                  onPress={() => setOcrAutoTypeCopiedText((value) => !value)}
                  style={styles.ocrSettingRow}
                >
                  <View style={styles.ocrSettingCopy}>
                    <Text style={styles.ocrSettingTitle}>OCR writes to cursor</Text>
                    <Text style={styles.ocrSettingText}>Copied Live Text relays to Chrome; this controls cursor typing.</Text>
                  </View>
                  <View style={styles.ocrSettingSwitchSlot}>
                    <Switch
                      ios_backgroundColor="rgba(255, 255, 255, 0.18)"
                      onValueChange={setOcrAutoTypeCopiedText}
                      thumbColor="#ffffff"
                      trackColor={{ false: "rgba(255, 255, 255, 0.22)", true: "rgba(255, 255, 255, 0.5)" }}
                      value={ocrAutoTypeCopiedText}
                    />
                  </View>
                </Pressable>
              ) : null}
              {mode === "barcode" ? (
                <>
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: barcodeInsertIntoCursor }}
                    onPress={() => setBarcodeInsertIntoCursor((value) => !value)}
                    style={styles.ocrSettingRow}
                  >
                    <View style={styles.ocrSettingCopy}>
                      <Text style={styles.ocrSettingTitle}>Scanner writes to cursor</Text>
                      <Text style={styles.ocrSettingText}>Send barcode scans to the active browser field by default.</Text>
                    </View>
                    <View style={styles.ocrSettingSwitchSlot}>
                      <Switch
                        ios_backgroundColor="rgba(255, 255, 255, 0.18)"
                        onValueChange={setBarcodeInsertIntoCursor}
                        thumbColor="#ffffff"
                        trackColor={{ false: "rgba(255, 255, 255, 0.22)", true: "rgba(255, 255, 255, 0.5)" }}
                        value={barcodeInsertIntoCursor}
                      />
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: barcodeAutoSend }}
                    onPress={() => setBarcodeAutoSend((value) => !value)}
                    style={styles.ocrSettingRow}
                  >
                    <View style={styles.ocrSettingCopy}>
                      <Text style={styles.ocrSettingTitle}>Auto-send scanner codes</Text>
                      <Text style={styles.ocrSettingText}>Send the first confirmed code without tapping the shutter.</Text>
                    </View>
                    <View style={styles.ocrSettingSwitchSlot}>
                      <Switch
                        ios_backgroundColor="rgba(255, 255, 255, 0.18)"
                        onValueChange={setBarcodeAutoSend}
                        thumbColor="#ffffff"
                        trackColor={{ false: "rgba(255, 255, 255, 0.22)", true: "rgba(255, 255, 255, 0.5)" }}
                        value={barcodeAutoSend}
                      />
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityState={{ checked: barcodeFullFrameScan }}
                    onPress={() => setBarcodeFullFrameScan((value) => !value)}
                    style={styles.ocrSettingRow}
                  >
                    <View style={styles.ocrSettingCopy}>
                      <Text style={styles.ocrSettingTitle}>Full-frame scanning</Text>
                      <Text style={styles.ocrSettingText}>Detect codes anywhere in the camera view instead of the center frame.</Text>
                    </View>
                    <View style={styles.ocrSettingSwitchSlot}>
                      <Switch
                        ios_backgroundColor="rgba(255, 255, 255, 0.18)"
                        onValueChange={setBarcodeFullFrameScan}
                        thumbColor="#ffffff"
                        trackColor={{ false: "rgba(255, 255, 255, 0.22)", true: "rgba(255, 255, 255, 0.5)" }}
                        value={barcodeFullFrameScan}
                      />
                    </View>
                  </Pressable>
                </>
              ) : null}
              {mode === "dictation" ? (
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: dictationAddsPunctuation }}
                  onPress={() => setDictationAddsPunctuation((value) => !value)}
                  style={styles.ocrSettingRow}
                >
                  <View style={styles.ocrSettingCopy}>
                    <Text style={styles.ocrSettingTitle}>Dictation punctuation</Text>
                    <Text style={styles.ocrSettingText}>Add punctuation to spoken text before sending it to Chrome.</Text>
                  </View>
                  <View style={styles.ocrSettingSwitchSlot}>
                    <Switch
                      ios_backgroundColor="rgba(255, 255, 255, 0.18)"
                      onValueChange={setDictationAddsPunctuation}
                      thumbColor="#ffffff"
                      trackColor={{ false: "rgba(255, 255, 255, 0.22)", true: "rgba(255, 255, 255, 0.5)" }}
                      value={dictationAddsPunctuation}
                    />
                  </View>
                </Pressable>
              ) : null}
              <View style={styles.ocrSettingBlock}>
                <View>
                  <Text style={styles.ocrSettingTitle}>Glass contrast</Text>
                  <Text style={styles.ocrSettingText}>Adjusts legibility over light or dark camera scenes.</Text>
                </View>
                <View style={styles.ocrGlassOptions}>
                  {(["adaptive", "dark", "bright"] as const).map((tone) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: ocrGlassTone === tone }}
                      key={tone}
                      onPress={() => setOcrGlassTone(tone)}
                      style={[styles.ocrGlassOption, ocrGlassTone === tone && styles.ocrGlassOptionActive]}
                    >
                      <Text style={[styles.ocrGlassOptionText, ocrGlassTone === tone && styles.ocrGlassOptionTextActive]}>
                        {tone === "adaptive" ? "Auto" : tone === "dark" ? "Dark" : "Light"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </Animated.View>
            <Animated.View style={[styles.ocrExpandedSheetTab, ocrExpandedSheetTabAnimatedStyle]}>
              {LiquidTabBarView ? (
                <LiquidTabBarView
                  onModeChange={(event) => {
                    const nextMode = event.nativeEvent?.mode;
                    if (nextMode === "ocr" || nextMode === "barcode" || nextMode === "photo" || nextMode === "dictation") {
                      switchClipMode(nextMode);
                    }
                  }}
                  selectedMode={mode}
                  style={styles.ocrExpandedSheetNativeTabBar}
                />
              ) : (
                <>
                  <View pointerEvents="none" style={styles.ocrExpandedSheetTabGlow} />
                  {clipModes.map((nextMode) => {
                    const selected = mode === nextMode;
                    return (
                      <Pressable
                        accessibilityLabel={`Switch to ${modeLabels[nextMode]}`}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        key={nextMode}
                        onPress={() => switchClipMode(nextMode)}
                        style={[styles.ocrModeNavItem, selected && styles.ocrModeNavItemSelected]}
                      >
                        <ModeIcon mode={nextMode} selected={selected} />
                        <Text numberOfLines={1} style={[styles.ocrModeNavLabel, selected && styles.ocrModeNavLabelSelected]}>
                          {modeLabels[nextMode]}
                        </Text>
                      </Pressable>
                    );
                  })}
                </>
              )}
            </Animated.View>
          </View>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Volt Clip</Text>
        <Text style={styles.title}>{mode ? modeTitles[mode] : "Capture unavailable"}</Text>
        <Text style={styles.status}>{statusText}</Text>
      </View>

      <View style={styles.captureSurface}>
        <View style={styles.focusFrame} />
        <Text style={styles.captureLabel}>
          {mode === "barcode"
            ? barcodeCandidate
              ? barcodeCandidate.value
              : "Center a barcode in front of the camera"
            : mode === "dictation"
              ? dictationTranscript || "Tap the mic and speak"
              : "Scan a fresh QR code from Chrome"}
        </Text>
        {mode === "barcode" && barcodeCandidate ? (
          <Text style={styles.captureMeta}>{barcodeCandidate.format}</Text>
        ) : null}
        {mode === "dictation" ? (
          <Pressable
            accessibilityRole="button"
            disabled={dictationState === "requesting" || sendState === "sent" || sendState === "sending"}
            onPress={toggleDictation}
            style={[
              styles.captureButton,
              dictationState === "recording" && styles.captureButtonActive,
              (dictationState === "requesting" || sendState === "sent" || sendState === "sending") &&
                styles.primaryButtonDisabled,
            ]}
          >
            <Text style={styles.captureButtonText}>
              {dictationState === "recording" ? "Stop" : dictationState === "requesting" ? "Starting" : "Record"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          disabled={!canSend}
          onPress={sendResult}
          style={[styles.primaryButton, !canSend && styles.primaryButtonDisabled]}
        >
          <Text style={styles.primaryButtonText}>
            {sendState === "sent"
              ? "Sent"
              : sendState === "sending"
                ? "Sending"
                : sendState === "error"
                  ? "Try Again"
                : mode === "barcode"
                  ? "Send Barcode"
                  : mode === "dictation"
                    ? "Send Transcript"
                  : "Send Test Result"}
          </Text>
        </Pressable>
        <Text style={styles.footerText}>{footerMessage}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ocrRoot: {
    flex: 1,
    minHeight: "100%",
    backgroundColor: "transparent",
    paddingTop: stableTopInset + 20,
  },
  ocrCameraSurface: {
    flex: 1,
    minHeight: 280,
    backgroundColor: "transparent",
  },
  ocrCameraTapLayer: {
    ...absoluteFillObject,
    zIndex: 0,
  },
  ocrFocusReticle: {
    position: "absolute",
    width: 68,
    height: 68,
    borderRadius: 20,
    ...continuousCorners,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.86)",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    zIndex: 8,
  },
  ocrBottomSheet: {
    position: "absolute",
    zIndex: 20,
    overflow: "hidden",
    paddingHorizontal: 18,
    paddingBottom: 16,
    ...continuousCorners,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.2,
    shadowRadius: 30,
  },
  ocrBottomSheetNativeGlass: {
    ...absoluteFillObject,
  },
  ocrBottomSheetTint: {
    ...absoluteFillObject,
    backgroundColor: "#ffffff",
  },
  ocrBottomSheetAdaptive: {
    backgroundColor: "rgba(22, 21, 20, 0.34)",
  },
  ocrBottomSheetBright: {
    backgroundColor: "rgba(246, 245, 242, 0.24)",
  },
  ocrBottomSheetDark: {
    backgroundColor: "rgba(8, 8, 8, 0.42)",
  },
  ocrFloatingShutter: {
    alignItems: "center",
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 14,
  },
  ocrFloatingHint: {
    alignItems: "center",
    left: 0,
    position: "absolute",
    right: 0,
    zIndex: 13,
  },
  ocrDrawerHandleHitArea: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    marginBottom: 2,
  },
  ocrDrawerHandle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.42)",
  },
  ocrCapturedSheet: {
    ...absoluteFillObject,
    overflow: "hidden",
  },
  ocrCapturedViewport: {
    ...absoluteFillObject,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  ocrCapturedScroll: {
    flex: 1,
  },
  ocrCapturedScrollContent: {
    alignItems: "center",
    justifyContent: "flex-start",
  },
  ocrCapturedImage: {
    backgroundColor: "#1c1917",
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
    backgroundColor: "rgba(255, 255, 255, 0.13)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
    shadowColor: "#ffffff",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
  },
  ocrCopyPromptText: {
    color: "#f5f5f4",
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 15,
  },
  ocrSentToast: {
    position: "absolute",
    left: 14,
    right: 14,
    top: 58,
    borderRadius: 22,
    ...continuousCorners,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    shadowColor: "#ffffff",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  ocrSentTitle: {
    color: "#f0fdf4",
    fontSize: 14,
    fontWeight: "900",
  },
  ocrSentText: {
    color: "#f5f5f4",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: 4,
  },
  ocrErrorToast: {
    position: "absolute",
    left: 14,
    right: 14,
    top: 58,
    borderRadius: 22,
    ...continuousCorners,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
    shadowColor: "#ffffff",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  ocrErrorText: {
    color: "#fee2e2",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 17,
  },
  ocrPreviewWarning: {
    position: "absolute",
    left: 18,
    right: 18,
    top: 18,
    minHeight: 42,
    borderRadius: 16,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(28, 25, 23, 0.82)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.18)",
    paddingHorizontal: 14,
  },
  ocrPreviewWarningText: {
    color: "#fafaf9",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  ocrUnavailablePanel: {
    flex: 1,
    borderRadius: 31,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    backgroundColor: "rgba(0, 0, 0, 0.22)",
  },
  ocrUnavailableText: {
    color: "#fafaf9",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  ocrDictationPanel: {
    ...absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingBottom: 180,
    backgroundColor: "#111111",
  },
  ocrDictationKicker: {
    color: "rgba(245, 245, 244, 0.55)",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    lineHeight: 16,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  ocrDictationTargetTitle: {
    color: "#ffffff",
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 31,
    textAlign: "center",
  },
  ocrDictationTargetMeta: {
    color: "rgba(245, 245, 244, 0.68)",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 17,
    marginTop: 8,
    textAlign: "center",
  },
  ocrDictationTargetCursor: {
    color: "#bbf7d0",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 18,
    marginTop: 14,
    textAlign: "center",
  },
  ocrDictationTranscriptBox: {
    borderRadius: 28,
    ...continuousCorners,
    marginTop: 28,
    maxWidth: "100%",
    minHeight: 104,
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 16,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
  },
  ocrDictationText: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 31,
    textAlign: "center",
  },
  ocrBarcodeGuide: {
    ...absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 170,
  },
  ocrDiscoveryGuide: {
    paddingBottom: 260,
  },
  ocrBarcodeGuideFrame: {
    width: "72%",
    aspectRatio: 1.35,
    borderRadius: 28,
    ...continuousCorners,
    borderWidth: 3,
    borderColor: "rgba(255, 255, 255, 0.82)",
    backgroundColor: "rgba(0, 0, 0, 0.08)",
  },
  ocrBarcodeGuideFrameActive: {
    borderColor: "#86efac",
    backgroundColor: "rgba(22, 163, 74, 0.12)",
  },
  ocrNativeBarcodeBounds: {
    position: "absolute",
    borderWidth: 3,
    borderRadius: 12,
    ...continuousCorners,
    borderColor: "#86efac",
    backgroundColor: "rgba(34, 197, 94, 0.14)",
    shadowColor: "#86efac",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 14,
  },
  ocrNativeBarcodeCornerDot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: "#bbf7d0",
    borderWidth: 2,
    borderColor: "#052e16",
  },
  ocrDiscoveryFrame: {
    width: "80%",
    height: "48%",
    borderRadius: 34,
    ...continuousCorners,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.62)",
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  ocrDiscoveryPulse: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: "#86efac",
    shadowColor: "#86efac",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 16,
  },
  ocrBarcodeGuideText: {
    marginTop: 14,
    maxWidth: "78%",
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 19,
    textAlign: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    ...continuousCorners,
    backgroundColor: "rgba(28, 25, 23, 0.7)",
    overflow: "hidden",
  },
  ocrBottomControls: {
    alignItems: "center",
    flex: 1,
    minHeight: 84,
    paddingTop: 0,
    paddingBottom: 18,
    position: "relative",
    width: "100%",
  },
  ocrCollapsedControls: {
    height: 126,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: "100%",
  },
  ocrSheetSummary: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 66,
    paddingHorizontal: 4,
    width: "100%",
  },
  ocrZoomWheel: {
    ...absoluteFillObject,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingHorizontal: 8,
    paddingTop: 6,
    top: 0,
  },
  ocrZoomWheelLabel: {
    color: "rgba(245, 245, 244, 0.62)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    lineHeight: 14,
    marginBottom: 7,
    textTransform: "uppercase",
  },
  ocrZoomWheelViewport: {
    alignItems: "center",
    height: 72,
    justifyContent: "center",
    overflow: "hidden",
    width: "100%",
  },
  ocrZoomWheelTrack: {
    alignItems: "center",
    flexDirection: "row",
    height: 72,
  },
  ocrZoomWheelTick: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderColor: "transparent",
    borderRadius: 999,
    borderWidth: 2,
    height: 62,
    justifyContent: "center",
    paddingBottom: 0,
    width: OCR_ZOOM_WHEEL_TICK_SPACING,
    ...continuousCorners,
  },
  ocrZoomWheelTickActive: {
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderColor: "rgba(255, 255, 255, 0.88)",
    shadowColor: "#ffffff",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
  },
  ocrZoomWheelTickMark: {
    backgroundColor: "rgba(255, 255, 255, 0.28)",
    borderRadius: 999,
    height: 14,
    marginBottom: 5,
    width: 2,
  },
  ocrZoomWheelTickMarkActive: {
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    height: 22,
  },
  ocrZoomWheelTickText: {
    color: "rgba(245, 245, 244, 0.52)",
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 14,
  },
  ocrZoomWheelTickTextActive: {
    color: "#ffffff",
    fontSize: 12,
  },
  ocrDictationDestinationCard: {
    ...absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  ocrDictationDestinationLabel: {
    color: "rgba(245, 245, 244, 0.55)",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    lineHeight: 14,
    marginBottom: 5,
    textTransform: "uppercase",
  },
  ocrDictationDestinationTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 20,
    maxWidth: "100%",
    textAlign: "center",
  },
  ocrDictationDestinationMeta: {
    color: "rgba(245, 245, 244, 0.64)",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 15,
    marginTop: 3,
    maxWidth: "100%",
    textAlign: "center",
  },
  ocrDictationDestinationCursor: {
    color: "#bbf7d0",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 15,
    marginTop: 5,
    maxWidth: "100%",
    textAlign: "center",
  },
  ocrCameraControls: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 8,
    marginBottom: 4,
    paddingHorizontal: 4,
    width: "100%",
  },
  ocrDictationButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    marginHorizontal: 4,
    marginBottom: 10,
    borderRadius: 999,
    ...continuousCorners,
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  ocrDictationButtonActive: {
    backgroundColor: "rgba(220, 38, 38, 0.82)",
    borderColor: "rgba(255, 255, 255, 0.28)",
  },
  ocrDictationButtonText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "900",
  },
  ocrModeOptions: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 4,
    paddingBottom: 10,
    width: "100%",
  },
  ocrModeOption: {
    alignItems: "center",
    borderRadius: 999,
    ...continuousCorners,
    flex: 1,
    minHeight: 38,
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  ocrModeOptionActive: {
    backgroundColor: "rgba(255, 255, 255, 0.36)",
    borderColor: "rgba(255, 255, 255, 0.34)",
  },
  ocrModeOptionText: {
    color: "rgba(245, 245, 244, 0.7)",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 15,
  },
  ocrModeOptionTextActive: {
    color: "#ffffff",
  },
  ocrCameraControlButton: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    borderColor: "rgba(255, 255, 255, 0.16)",
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 58,
    paddingHorizontal: 10,
    paddingVertical: 8,
    ...continuousCorners,
  },
  ocrCameraControlButtonActive: {
    backgroundColor: "rgba(255, 255, 255, 0.34)",
    borderColor: "rgba(255, 255, 255, 0.34)",
  },
  ocrCameraControlButtonDisabled: {
    opacity: 0.45,
  },
  ocrCameraControlButtonText: {
    color: "#f5f5f4",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 16,
  },
  ocrCameraControlButtonTextActive: {
    color: "#ffffff",
  },
  ocrCameraControlButtonMeta: {
    color: "rgba(245, 245, 244, 0.68)",
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 14,
    marginTop: 2,
  },
  ocrCameraControlReadout: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 58,
    paddingHorizontal: 10,
    paddingVertical: 8,
    ...continuousCorners,
  },
  ocrCameraControlReadoutLabel: {
    color: "rgba(245, 245, 244, 0.62)",
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 14,
    textTransform: "uppercase",
  },
  ocrCameraControlReadoutValue: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 22,
    marginTop: 2,
  },
  ocrSummaryPrimary: {
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
  },
  ocrSummaryTitle: {
    color: "#f5f5f4",
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 21,
  },
  ocrSummaryText: {
    color: "rgba(245, 245, 244, 0.72)",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16,
    marginTop: 3,
  },
  ocrSummaryBadges: {
    alignItems: "flex-end",
    gap: 6,
  },
  ocrSummaryBadge: {
    alignItems: "center",
    borderRadius: 999,
    ...continuousCorners,
    minHeight: 24,
    justifyContent: "center",
    paddingHorizontal: 10,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.16)",
  },
  ocrSummaryBadgeText: {
    color: "rgba(245, 245, 244, 0.86)",
    fontSize: 11,
    fontWeight: "900",
    lineHeight: 14,
  },
  ocrExpandedControls: {
    gap: 0,
    paddingBottom: 96,
    paddingTop: 0,
    width: "100%",
  },
  ocrExpandedSheetTab: {
    alignItems: "center",
    alignSelf: "center",
    bottom: 10,
    flexDirection: "row",
    gap: 4,
    height: 84,
    justifyContent: "center",
    position: "absolute",
    paddingHorizontal: 6,
    paddingVertical: 8,
    width: "100%",
  },
  ocrExpandedSheetTabGlow: {
    ...absoluteFillObject,
    borderRadius: 28,
    ...continuousCorners,
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.22)",
    shadowColor: "#ffffff",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
  },
  ocrExpandedSheetTabGlass: {
    ...absoluteFillObject,
    borderRadius: 28,
    ...continuousCorners,
    overflow: "hidden",
  },
  ocrExpandedSheetNativeTabBar: {
    ...absoluteFillObject,
    borderRadius: 28,
    ...continuousCorners,
    overflow: "visible",
  },
  ocrModeNavItem: {
    alignItems: "center",
    borderRadius: 22,
    ...continuousCorners,
    flex: 1,
    gap: 2,
    height: 54,
    justifyContent: "center",
  },
  ocrModeNavItemSelected: {
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    shadowColor: "#ffffff",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  ocrModeNavLabel: {
    color: "rgba(245, 245, 244, 0.68)",
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 12,
    maxWidth: "100%",
    textAlign: "center",
  },
  ocrModeNavLabelSelected: {
    color: "#ffffff",
  },
  ocrModeNavIconBox: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    position: "relative",
    width: 32,
  },
  ocrModeNavIconDefault: {
    borderColor: "rgba(245, 245, 244, 0.66)",
  },
  ocrModeNavIconSelected: {
    borderColor: "#ffffff",
  },
  ocrModeNavIconLineDefault: {
    backgroundColor: "rgba(245, 245, 244, 0.66)",
  },
  ocrModeNavIconLineSelected: {
    backgroundColor: "#ffffff",
  },
  ocrModeDocIcon: {
    borderRadius: 4,
    borderWidth: 1.8,
    height: 22,
    paddingLeft: 5,
    paddingTop: 8,
    width: 18,
  },
  ocrModeDocFold: {
    borderBottomColor: "rgba(245, 245, 244, 0.42)",
    borderBottomWidth: 1.5,
    borderLeftColor: "transparent",
    borderLeftWidth: 5,
    height: 7,
    position: "absolute",
    right: 0,
    top: 0,
    width: 7,
  },
  ocrModeDocFoldSelected: {
    borderBottomColor: "rgba(255, 255, 255, 0.78)",
  },
  ocrModeDocLine: {
    borderRadius: 999,
    height: 2,
    marginBottom: 3,
    width: 8,
  },
  ocrModeDocLineShort: {
    borderRadius: 999,
    height: 2,
    width: 6,
  },
  ocrModeViewfinderTopLeft: {
    borderLeftWidth: 2,
    borderTopWidth: 2,
    borderTopLeftRadius: 6,
    height: 8,
    left: 2,
    position: "absolute",
    top: 2,
    width: 8,
  },
  ocrModeViewfinderTopRight: {
    borderRightWidth: 2,
    borderTopWidth: 2,
    borderTopRightRadius: 6,
    height: 8,
    position: "absolute",
    right: 2,
    top: 2,
    width: 8,
  },
  ocrModeViewfinderBottomLeft: {
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    borderBottomLeftRadius: 6,
    bottom: 2,
    height: 8,
    left: 2,
    position: "absolute",
    width: 8,
  },
  ocrModeViewfinderBottomRight: {
    borderBottomWidth: 2,
    borderRightWidth: 2,
    borderBottomRightRadius: 6,
    bottom: 2,
    height: 8,
    position: "absolute",
    right: 2,
    width: 8,
  },
  ocrModeBarcodeBars: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
    height: 18,
    justifyContent: "center",
    width: 22,
  },
  ocrModeBarcodeBarsSelected: {
    opacity: 1,
  },
  ocrModeBarcodeBar: {
    borderRadius: 999,
    height: 18,
  },
  ocrModePhotoBack: {
    borderRadius: 5,
    borderWidth: 1.7,
    height: 18,
    left: 8,
    position: "absolute",
    top: 3,
    width: 19,
  },
  ocrModePhotoFront: {
    borderRadius: 5,
    borderWidth: 1.9,
    height: 19,
    overflow: "hidden",
    position: "absolute",
    right: 7,
    top: 7,
    width: 21,
  },
  ocrModePhotoFrontSelected: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  ocrModePhotoSun: {
    borderRadius: 999,
    height: 4,
    position: "absolute",
    right: 4,
    top: 4,
    width: 4,
  },
  ocrModePhotoMountain: {
    bottom: 4,
    height: 7,
    left: 4,
    position: "absolute",
    transform: [{ rotate: "45deg" }],
    width: 7,
  },
  ocrModeMicCapsule: {
    borderRadius: 999,
    borderWidth: 2,
    height: 18,
    width: 12,
  },
  ocrModeMicCapsuleSelected: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  ocrModeMicStem: {
    height: 7,
    marginTop: -1,
    width: 2,
  },
  ocrModeMicBase: {
    borderRadius: 999,
    height: 2,
    width: 14,
  },
  ocrModeMicArc: {
    borderBottomWidth: 2,
    borderColor: "rgba(245, 245, 244, 0.66)",
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderRadius: 10,
    bottom: 7,
    height: 10,
    position: "absolute",
    width: 20,
  },
  ocrModeMicArcDefault: {
    borderColor: "rgba(245, 245, 244, 0.66)",
  },
  ocrModeMicArcSelected: {
    borderColor: "#ffffff",
  },
  ocrExpandedSheetTabGrip: {
    width: 54,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255, 255, 255, 0.72)",
    shadowColor: "#ffffff",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.32,
    shadowRadius: 8,
  },
  ocrSettingBlock: {
    gap: 12,
    minHeight: 102,
    paddingHorizontal: 4,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.14)",
  },
  ocrSettingRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 64,
    paddingHorizontal: 4,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.14)",
    gap: 14,
  },
  ocrSettingCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 6,
  },
  ocrSettingSwitchSlot: {
    alignItems: "center",
    alignSelf: "center",
    justifyContent: "center",
    minHeight: 48,
    minWidth: 54,
  },
  ocrSettingTitle: {
    color: "#f5f5f4",
    fontSize: 14,
    fontWeight: "900",
    lineHeight: 18,
  },
  ocrSettingText: {
    color: "rgba(245, 245, 244, 0.68)",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
    marginTop: 2,
    maxWidth: 230,
  },
  ocrGlassOptions: {
    flexDirection: "row",
    gap: 6,
    width: "100%",
  },
  ocrGlassOption: {
    alignItems: "center",
    borderRadius: 999,
    ...continuousCorners,
    flex: 1,
    minHeight: 36,
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.1)",
  },
  ocrGlassOptionActive: {
    backgroundColor: "rgba(255, 255, 255, 0.34)",
    borderColor: "rgba(255, 255, 255, 0.34)",
  },
  ocrGlassOptionText: {
    color: "rgba(245, 245, 244, 0.68)",
    fontSize: 12,
    fontWeight: "900",
    lineHeight: 15,
  },
  ocrGlassOptionTextActive: {
    color: "#ffffff",
  },
  ocrSettingPill: {
    borderRadius: 999,
    ...continuousCorners,
    minWidth: 64,
    alignItems: "center",
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: "rgba(255, 255, 255, 0.32)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.26)",
  },
  ocrSettingPillText: {
    color: "#f5f5f4",
    fontSize: 12,
    fontWeight: "900",
  },
  ocrShutterButton: {
    alignItems: "center",
    justifyContent: "center",
    width: 90,
    height: 90,
    borderRadius: 45,
    ...continuousCorners,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.34)",
    shadowColor: "#ffffff",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
  },
  ocrShutterInner: {
    alignItems: "center",
    justifyContent: "center",
    width: 70,
    height: 70,
    borderRadius: 35,
    ...continuousCorners,
    backgroundColor: "rgba(250, 250, 249, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.75)",
  },
  ocrShutterButtonDisabled: {
    opacity: 0.7,
  },
  ocrShutterButtonActive: {
    backgroundColor: "rgba(34, 197, 94, 0.28)",
    borderColor: "rgba(187, 247, 208, 0.86)",
  },
  ocrShutterDot: {
    width: 52,
    height: 52,
    borderRadius: 26,
    ...continuousCorners,
    backgroundColor: "#1c1917",
  },
  ocrMicIcon: {
    alignItems: "center",
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  ocrBarcodeIcon: {
    alignItems: "center",
    flexDirection: "row",
    gap: 3,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  ocrBarcodeIconBar: {
    borderRadius: 999,
    height: 30,
    backgroundColor: "#1c1917",
  },
  ocrMicCapsule: {
    width: 18,
    height: 28,
    borderRadius: 10,
    ...continuousCorners,
    backgroundColor: "#1c1917",
  },
  ocrMicStem: {
    width: 4,
    height: 9,
    borderRadius: 2,
    backgroundColor: "#1c1917",
    marginTop: 2,
  },
  ocrMicBase: {
    width: 24,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#1c1917",
    marginTop: -1,
  },
  ocrUndoIcon: {
    alignItems: "center",
    justifyContent: "center",
  },
  ocrUndoIconText: {
    color: "#1c1917",
    fontSize: 45,
    fontWeight: "900",
    lineHeight: 50,
  },
  ocrRefreshIcon: {
    alignItems: "center",
    justifyContent: "center",
  },
  ocrRefreshIconText: {
    color: "#1c1917",
    fontSize: 39,
    fontWeight: "900",
    lineHeight: 44,
  },
  ocrShutterIcon: {
    color: "#1c1917",
    fontSize: 31,
    fontWeight: "900",
    lineHeight: 35,
  },
  ocrShutterLabel: {
    color: "#f5f5f4",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 17,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    ...continuousCorners,
    backgroundColor: "rgba(28, 25, 23, 0.72)",
    overflow: "hidden",
    textAlign: "center",
  },
  root: {
    flex: 1,
    backgroundColor: "#fafaf9",
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  header: {
    gap: 6,
    paddingTop: 16,
  },
  eyebrow: {
    color: "#16a34a",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    color: "#1c1917",
    fontSize: 30,
    fontWeight: "800",
  },
  status: {
    color: "#57534e",
    fontSize: 15,
    fontWeight: "600",
  },
  captureSurface: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  focusFrame: {
    width: "82%",
    aspectRatio: 1,
    borderColor: "#16a34a",
    borderRadius: 28,
    borderWidth: 4,
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  focusFrameCaptured: {
    width: "88%",
  },
  cameraPreview: {
    height: "100%",
    width: "100%",
  },
  capturedImageScroll: {
    height: "100%",
    width: "100%",
  },
  capturedImage: {
    height: "100%",
    width: "100%",
  },
  captureLabel: {
    color: "#1c1917",
    fontSize: 18,
    fontWeight: "800",
    marginTop: 18,
    maxWidth: "88%",
    textAlign: "center",
  },
  ocrTextInput: {
    backgroundColor: "#ffffff",
    borderColor: "#16a34a",
    borderRadius: 8,
    borderWidth: 2,
    color: "#1c1917",
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 23,
    marginTop: 18,
    maxHeight: 180,
    minHeight: 112,
    paddingHorizontal: 14,
    paddingVertical: 12,
    width: "88%",
  },
  captureMeta: {
    color: "#16a34a",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 6,
    textTransform: "uppercase",
  },
  captureButton: {
    alignItems: "center",
    backgroundColor: "#1c1917",
    borderRadius: 8,
    justifyContent: "center",
    marginTop: 22,
    minHeight: 48,
    minWidth: 132,
    paddingHorizontal: 18,
  },
  captureButtonActive: {
    backgroundColor: "#dc2626",
  },
  captureButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  footer: {
    minHeight: 128,
    gap: 12,
    justifyContent: "center",
  },
  primaryButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "#16a34a",
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 20,
    width: "100%",
  },
  primaryButtonDisabled: {
    backgroundColor: "#a8a29e",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "800",
  },
  footerText: {
    color: "#44403c",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
});
