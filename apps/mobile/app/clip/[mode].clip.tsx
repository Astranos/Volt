import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  Animated,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import type { ViewProps } from "react-native";
import { initialWindowMetrics } from "react-native-safe-area-context";
import { SCANNER_SIGNAL_URL } from "@volt/scanner-protocol";
import { createBarcodeCandidateGuard } from "../../lib/barcode-candidate-guard";
import { makeClipRelayResult, messageForClipRelayStatus } from "../../lib/clip-result-relay";
import { parseCaptureInvocation, type CaptureInvocation } from "../../lib/capture-url";
import { LiveTextImageView } from "../../lib/live-text-image-view";
import {
  makeBarcodeMessage,
  makeDictationMessage,
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
  hideVoltClipTextPreview,
  hasVoltClipTextRecognizer,
  showVoltClipTextPreview,
  VoltClipTextCameraView,
} from "../../lib/volt-clip-text-recognizer";

const modeTitles = {
  ocr: "OCR Capture",
  barcode: "Barcode Scanner",
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

function makeTestMessage(mode: ScannerCaptureMode) {
  if (mode === "ocr") return makeOcrMessage("hello from Volt Clip");
  if (mode === "dictation") return makeDictationMessage("hello from Volt Clip", `clip-${Date.now()}`);
  return makeBarcodeMessage("hello-from-volt-clip", "qr");
}

export default function ClipInvocationScreen() {
  const [invocation, setInvocation] = useState<CaptureInvocation | null>(null);
  const mode = invocation?.mode ?? null;
  const session = invocation?.sessionId ?? "";
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [scannerState, setScannerState] = useState<"idle" | "starting" | "ready" | "unavailable" | "error">("idle");
  const [barcodeCandidate, setBarcodeCandidate] = useState<VoltClipBarcodeCandidate | null>(null);
  const [dictationState, setDictationState] = useState<"idle" | "requesting" | "ready" | "recording" | "unavailable" | "error">(
    "idle"
  );
  const [dictationTranscript, setDictationTranscript] = useState("");
  const [dictationFinal, setDictationFinal] = useState(false);
  const [ocrState, setOcrState] = useState<"idle" | "capturing" | "ready" | "unavailable" | "error">("idle");
  const [ocrPreviewState, setOcrPreviewState] = useState<"idle" | "starting" | "ready" | "failed">("idle");
  const [ocrText, setOcrText] = useState("");
  const [ocrImageUri, setOcrImageUri] = useState<string | null>(null);
  const windowDimensions = useWindowDimensions();
  const lastOcrClipboardRef = useRef<string | null>(null);
  const lastOcrClipboardChangeCountRef = useRef<number | null>(null);
  const ocrDrawerProgress = useRef(new Animated.Value(0)).current;
  const ocrDrawerProgressRef = useRef(0);
  const ocrDrawerDragStartRef = useRef(0);
  const isOcrMode = mode === "ocr";
  const resetOcrCapture = useCallback(() => {
    setOcrImageUri(null);
    setOcrText("");
    setOcrState("ready");
    setOcrPreviewState("ready");
    setSendState("idle");
    setError(null);
    lastOcrClipboardRef.current = null;
    lastOcrClipboardChangeCountRef.current = null;
  }, []);
  const canSend = Boolean(
    mode &&
      session &&
      sendState !== "sending" &&
      sendState !== "sent" &&
      (mode !== "ocr" || ocrText.trim()) &&
      (mode !== "barcode" || barcodeCandidate) &&
      (mode !== "dictation" || (dictationFinal && dictationTranscript.trim()))
  );
  const ocrDrawerCollapsedHeight = 148;
  const ocrDrawerExpandedHeight = Math.min(
    Math.max(windowDimensions.height * 0.58, 360),
    Math.max(windowDimensions.height - stableTopInset - 110, ocrDrawerCollapsedHeight)
  );
  const ocrDrawerCollapsedInset = 7;
  const ocrDrawerExpandedInset = 7;
  const ocrDrawerCollapsedRadius = 48;
  const ocrDrawerExpandedRadius = 48;
  const ocrDrawerCollapsedBottom = ocrDrawerCollapsedInset;
  const ocrDrawerExpandedBottom = ocrDrawerExpandedInset;
  const animateOcrDrawerTo = useCallback(
    (value: number) => {
      Animated.spring(ocrDrawerProgress, {
        toValue: Math.max(0, Math.min(1, value)),
        damping: 24,
        mass: 0.9,
        stiffness: 210,
        overshootClamping: false,
        restDisplacementThreshold: 0.4,
        restSpeedThreshold: 0.4,
        useNativeDriver: false,
      }).start();
    },
    [ocrDrawerProgress]
  );
  const ocrDrawerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dy) > 6,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          ocrDrawerDragStartRef.current = ocrDrawerProgressRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          const dragRange = Math.max(ocrDrawerExpandedHeight - ocrDrawerCollapsedHeight, 220);
          const nextValue = ocrDrawerDragStartRef.current - gestureState.dy / dragRange;
          ocrDrawerProgress.setValue(Math.max(0, Math.min(1, nextValue)));
        },
        onPanResponderRelease: (_, gestureState) => {
          const isTap = Math.abs(gestureState.dy) < 6 && Math.abs(gestureState.dx) < 6;
          if (isTap) {
            animateOcrDrawerTo(ocrDrawerProgressRef.current > 0.5 ? 0 : 1);
            return;
          }

          const shouldExpand = gestureState.vy < -0.35 || (gestureState.vy < 0.35 && ocrDrawerProgressRef.current > 0.42);
          animateOcrDrawerTo(shouldExpand ? 1 : 0);
        },
        onPanResponderTerminate: () => {
          animateOcrDrawerTo(ocrDrawerProgressRef.current > 0.5 ? 1 : 0);
        },
      }),
    [animateOcrDrawerTo, ocrDrawerCollapsedHeight, ocrDrawerExpandedHeight, ocrDrawerProgress]
  );
  const statusText = useMemo(() => {
    if (!session) return "Missing browser session";
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
    if (mode === "ocr" && ocrImageUri) return sendState === "sent" ? "Copied text sent" : "Select text and copy";
    if (mode === "ocr" && ocrText.trim()) return "Text ready";
    if (mode === "ocr" && ocrState === "unavailable") return "OCR unavailable";
    if (mode === "ocr" && ocrState === "error") return "OCR failed";
    if (mode === "dictation" && dictationState === "requesting") return "Requesting microphone";
    if (mode === "dictation" && dictationState === "recording") return "Listening";
    if (mode === "dictation" && dictationFinal) return "Transcript ready";
    if (mode === "dictation" && dictationState === "unavailable") return "Dictation unavailable";
    if (mode === "dictation" && dictationState === "error") return "Dictation failed";
    return "Browser session found";
  }, [dictationFinal, dictationState, mode, ocrImageUri, ocrPreviewState, ocrState, ocrText, scannerState, sendState, session]);
  const showMeasuredOcrPreview = useCallback(() => {
    if (mode !== "ocr" || !hasVoltClipTextRecognizer || ocrImageUri) return;

    setOcrPreviewState("starting");
    showVoltClipTextPreview({
      x: 0,
      y: 0,
      width: windowDimensions.width,
      height: windowDimensions.height,
    });
    setOcrPreviewState("ready");
  }, [mode, ocrImageUri, windowDimensions.height, windowDimensions.width]);

  useEffect(() => {
    if (mode !== "ocr" || !hasVoltClipTextRecognizer || ocrImageUri) {
      hideVoltClipTextPreview();
      return;
    }

    showMeasuredOcrPreview();
    const timer = setTimeout(showMeasuredOcrPreview, 150);
    return () => {
      clearTimeout(timer);
      hideVoltClipTextPreview();
    };
  }, [mode, ocrImageUri, showMeasuredOcrPreview]);

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
    if (mode !== "ocr") return;

    if (!hasVoltClipTextRecognizer) {
      setOcrState("unavailable");
      setError("OCR camera is unavailable in this App Clip build.");
      return;
    }

    setOcrState("ready");
  }, [mode]);

  useEffect(() => {
    if (mode !== "barcode") return;

    if (!hasVoltClipBarcodeScanner) {
      setScannerState("unavailable");
      return;
    }

    let isMounted = true;
    const shouldAcceptCandidate = createBarcodeCandidateGuard();
    const candidateSubscription = addVoltClipBarcodeCandidateListener((candidate) => {
      if (!shouldAcceptCandidate(candidate)) return;
      setBarcodeCandidate(candidate);
    });
    const errorSubscription = addVoltClipBarcodeErrorListener((message) => {
      setScannerState("error");
      setError(message);
    });

    setScannerState("starting");
    startVoltClipBarcodeScanner()
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
  }, [mode]);

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
  }, [mode]);

  async function toggleDictation() {
    if (mode !== "dictation" || sendState === "sending" || sendState === "sent") return;

    if (dictationState === "recording") {
      setDictationState("ready");
      await stopVoltClipDictation();
      return;
    }

    setError(null);
    setDictationFinal(false);
    setDictationState("requesting");

    try {
      const permissions = await requestVoltClipDictationPermissions();
      if (!permissions.granted) {
        setDictationState("error");
        setError("Microphone and speech recognition permissions are required.");
        return;
      }

      setDictationTranscript("");
      await startVoltClipDictation();
      setDictationState("recording");
    } catch (dictationError) {
      setDictationState("error");
      setError(dictationError instanceof Error ? dictationError.message : "Unable to start dictation");
    }
  }

  async function captureText() {
    if (mode !== "ocr" || sendState === "sending" || sendState === "sent") return;

    setError(null);
    setOcrState("capturing");

    try {
      const result = await captureAndRecognizeVoltClipText();
      setOcrText(result.text);
      setOcrImageUri(result.imageUri ?? null);
      hideVoltClipTextPreview();
      setOcrState("ready");
    } catch (captureError) {
      setOcrState("error");
      setError(captureError instanceof Error ? captureError.message : "Unable to capture text");
    }
  }

  function renderOcrShutter() {
    const isBusy = ocrState === "capturing" || sendState === "sending";
    return (
      <Pressable
        accessibilityLabel={ocrImageUri ? "Retake text capture" : "Capture text"}
        accessibilityRole="button"
        disabled={isBusy}
        onPress={() => {
          if (ocrImageUri) {
            resetOcrCapture();
            return;
          }
          void captureText();
        }}
        style={[styles.ocrShutterButton, isBusy && styles.ocrShutterButtonDisabled]}
      >
        <View style={styles.ocrShutterInner}>
          <Text style={styles.ocrShutterIcon}>
            {isBusy ? "…" : ""}
          </Text>
        </View>
      </Pressable>
    );
  }

  const sendOcrClipboardText = useCallback(
    async (text: string) => {
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
          body: JSON.stringify(makeClipRelayResult("ocr", makeOcrMessage(value))),
        });

        if (!response.ok) {
          throw new Error(messageForClipRelayStatus(response.status));
        }

        setSendState("sent");
      } catch (sendError) {
        setSendState("error");
        setError(
          sendError instanceof Error && sendError.name === "AbortError"
            ? "The browser session did not respond. Keep the QR overlay open and try again."
            : sendError instanceof Error
              ? sendError.message
              : "Unable to send copied text"
        );
      } finally {
        clearTimeout(timeoutId);
      }
    },
    [sendState, session]
  );

  useEffect(() => {
    if (mode !== "ocr" || !ocrImageUri || !hasVoltClipClipboard || sendState === "sent") return;

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
          await sendOcrClipboardText(value);
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
  }, [mode, ocrImageUri, sendOcrClipboardText, sendState]);

  useEffect(() => {
    const subscription = ocrDrawerProgress.addListener(({ value }) => {
      ocrDrawerProgressRef.current = value;
    });
    return () => {
      ocrDrawerProgress.removeListener(subscription);
    };
  }, [ocrDrawerProgress]);

  async function sendResult() {
    if (!mode || !session) return;

    setSendState("sending");
    setError(null);
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), RESULT_SEND_TIMEOUT_MS);

    try {
      const message =
        mode === "barcode" && barcodeCandidate
          ? makeBarcodeMessage(barcodeCandidate.value, barcodeCandidate.format)
          : mode === "ocr" && ocrText.trim()
            ? makeOcrMessage(ocrText.trim())
          : mode === "dictation" && dictationTranscript.trim()
            ? makeDictationMessage(dictationTranscript.trim(), `clip-${session}`)
          : makeTestMessage(mode);

      const response = await fetch(`${SCANNER_SIGNAL_URL}/${encodeURIComponent(session)}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify(makeClipRelayResult(mode, message)),
      });

      if (!response.ok) {
        throw new Error(messageForClipRelayStatus(response.status));
      }

      setSendState("sent");
      if (mode === "barcode") {
        void stopVoltClipBarcodeScanner();
      }
      if (mode === "dictation") {
        void stopVoltClipDictation();
      }
    } catch (sendError) {
      setSendState("error");
      setError(
        sendError instanceof Error && sendError.name === "AbortError"
          ? "The browser session did not respond. Keep the QR overlay open and try again."
          : sendError instanceof Error
            ? sendError.message
            : "Unable to send result"
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const footerMessage = (() => {
    if (!mode || !session) return "Scan a fresh QR code from the Volt Chrome extension.";
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
    }),
    right: ocrDrawerProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [ocrDrawerCollapsedInset, ocrDrawerExpandedInset],
    }),
    bottom: ocrDrawerProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [ocrDrawerCollapsedBottom, ocrDrawerExpandedBottom],
    }),
    height: ocrDrawerProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [ocrDrawerCollapsedHeight, ocrDrawerExpandedHeight],
    }),
    paddingTop: ocrDrawerProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [12, 14],
    }),
    borderRadius: ocrDrawerProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [ocrDrawerCollapsedRadius, ocrDrawerExpandedRadius],
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
    opacity: ocrDrawerProgress.interpolate({
      inputRange: [0, 0.35, 1],
      outputRange: [0, 0, 1],
      extrapolate: "clamp",
    }),
    transform: [
      {
        translateY: ocrDrawerProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0],
        }),
      },
    ],
  };
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

  if (isOcrMode) {
    return (
      <View style={styles.ocrRoot}>
        <View style={styles.ocrCameraSurface}>
            {ocrImageUri ? (
              <View style={styles.ocrCapturedSheet}>
                <View style={styles.ocrCapturedViewport}>
                  <ScrollView
                    automaticallyAdjustContentInsets={false}
                    bouncesZoom
                    maximumZoomScale={4}
                    minimumZoomScale={1}
                    pinchGestureEnabled
                    scrollEventThrottle={16}
                    showsHorizontalScrollIndicator={false}
                    showsVerticalScrollIndicator={false}
                    style={styles.ocrCapturedScroll}
                  >
                    <LiveTextImageView imageUri={ocrImageUri} style={styles.ocrCapturedImage} />
                  </ScrollView>
                  <View pointerEvents="none" style={styles.ocrCopyPrompt}>
                    <Text numberOfLines={1} style={styles.ocrCopyPromptText}>
                      Select text and tap Copy to send to browser
                    </Text>
                  </View>
                </View>
              </View>
          ) : hasVoltClipTextRecognizer ? (
            <>
              {ocrPreviewState === "failed" ? (
                <View pointerEvents="none" style={styles.ocrPreviewWarning}>
                  <Text style={styles.ocrPreviewWarningText}>Camera preview unavailable</Text>
                  </View>
                ) : null}
              </>
            ) : (
              <View style={styles.ocrUnavailablePanel}>
                <Text style={styles.ocrUnavailableText}>OCR camera unavailable</Text>
              </View>
            )}

            {sendState === "sent" && ocrText ? (
              <View pointerEvents="none" style={styles.ocrSentToast}>
                <Text style={styles.ocrSentTitle}>Copied and sent to browser</Text>
                <Text numberOfLines={2} style={styles.ocrSentText}>
                  {ocrText}
                </Text>
              </View>
            ) : null}

            {sendState === "error" && error ? (
              <View pointerEvents="none" style={styles.ocrErrorToast}>
                <Text numberOfLines={2} style={styles.ocrErrorText}>
                  {error}
                </Text>
              </View>
            ) : null}
        </View>
        <Animated.View style={[styles.ocrFloatingShutter, ocrFloatingShutterAnimatedStyle]}>
          {renderOcrShutter()}
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.ocrFloatingHint, ocrHintAnimatedStyle]}>
          <Text style={styles.ocrShutterLabel}>
            {ocrImageUri
              ? "Copy selected text to send"
              : ocrState === "capturing"
                ? "Reading text..."
                : "Tap shutter to capture text"}
          </Text>
        </Animated.View>
        <Animated.View {...ocrDrawerPanResponder.panHandlers} style={[styles.ocrBottomSheet, ocrBottomSheetAnimatedStyle]}>
          <View style={styles.ocrDrawerHandleHitArea}>
            <Animated.View pointerEvents="none" style={[styles.ocrDrawerHandle, ocrDrawerHandleAnimatedStyle]} />
          </View>
          <View style={styles.ocrBottomControls}>
            <View style={styles.ocrQuickControls}>
              <View style={styles.ocrQuickControl}>
                <Text style={styles.ocrQuickControlTitle}>Live Text</Text>
                <Text style={styles.ocrQuickControlValue}>{ocrImageUri ? "Ready" : "Standby"}</Text>
              </View>
              <View style={styles.ocrQuickControl}>
                <Text style={styles.ocrQuickControlTitle}>Browser</Text>
                <Text style={styles.ocrQuickControlValue}>{session ? "Linked" : "Missing"}</Text>
              </View>
            </View>
            <Animated.View style={[styles.ocrExpandedControls, ocrExpandedControlsAnimatedStyle]}>
              <Text style={styles.ocrExpandedTitle}>Capture Settings</Text>
              <View style={styles.ocrSettingRow}>
                <View>
                  <Text style={styles.ocrSettingTitle}>Auto-send copied text</Text>
                  <Text style={styles.ocrSettingText}>Copies from Live Text relay to Chrome.</Text>
                </View>
                <View style={styles.ocrSettingPill}>
                  <Text style={styles.ocrSettingPillText}>On</Text>
                </View>
              </View>
              <View style={styles.ocrSettingRow}>
                <View>
                  <Text style={styles.ocrSettingTitle}>Text extraction area</Text>
                  <Text style={styles.ocrSettingText}>Whole captured frame is selectable.</Text>
                </View>
                <View style={styles.ocrSettingPill}>
                  <Text style={styles.ocrSettingPillText}>Full</Text>
                </View>
              </View>
              <View style={styles.ocrSettingRow}>
                <View>
                  <Text style={styles.ocrSettingTitle}>Camera background</Text>
                  <Text style={styles.ocrSettingText}>Live preview resumes on retake.</Text>
                </View>
                <View style={styles.ocrSettingPill}>
                  <Text style={styles.ocrSettingPillText}>Live</Text>
                </View>
              </View>
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
        <View style={[styles.focusFrame, ocrImageUri && styles.focusFrameCaptured]}>
          {mode === "ocr" && ocrImageUri ? (
            <ScrollView
              bouncesZoom
              maximumZoomScale={4}
              minimumZoomScale={1}
              pinchGestureEnabled
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              style={styles.capturedImageScroll}
            >
              <LiveTextImageView imageUri={ocrImageUri} style={styles.capturedImage} />
            </ScrollView>
          ) : mode === "ocr" && TextCameraView ? (
            <TextCameraView style={styles.cameraPreview} />
          ) : null}
        </View>
        {mode === "ocr" && ocrText && !ocrImageUri ? (
          <TextInput
            accessibilityLabel="Detected text"
            editable={sendState !== "sending" && sendState !== "sent"}
            multiline
            onChangeText={setOcrText}
            returnKeyType="default"
            scrollEnabled
            style={styles.ocrTextInput}
            textAlignVertical="top"
            value={ocrText}
          />
        ) : (
          <Text style={styles.captureLabel}>
            {mode === "barcode"
              ? barcodeCandidate
                ? barcodeCandidate.value
                : "Center a barcode in front of the camera"
              : mode === "ocr"
                ? "Point the camera at text"
              : mode === "dictation"
                ? dictationTranscript || "Tap the mic and speak"
              : "Scan a fresh QR code from Chrome"}
          </Text>
        )}
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
        {mode === "ocr" ? (
          <Pressable
            accessibilityRole="button"
            disabled={ocrState === "capturing" || sendState === "sent" || sendState === "sending"}
            onPress={captureText}
            style={[
              styles.captureButton,
              (ocrState === "capturing" || sendState === "sent" || sendState === "sending") &&
                styles.primaryButtonDisabled,
            ]}
          >
            <Text style={styles.captureButtonText}>{ocrState === "capturing" ? "Capturing" : "Capture Text"}</Text>
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
                : mode === "ocr"
                  ? "Send Text"
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
  ocrBottomSheet: {
    position: "absolute",
    overflow: "hidden",
    paddingHorizontal: 18,
    paddingBottom: 16,
    ...continuousCorners,
    backgroundColor: "rgba(250, 250, 249, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.36)",
    shadowColor: "#ffffff",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 28,
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
    height: 34,
    justifyContent: "center",
    marginBottom: 4,
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
  ocrCapturedImage: {
    minHeight: "100%",
    width: "100%",
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
  ocrBottomControls: {
    alignItems: "center",
    minHeight: 84,
    paddingTop: 0,
    paddingBottom: 0,
    width: "100%",
  },
  ocrQuickControls: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  ocrQuickControl: {
    flex: 1,
    minHeight: 58,
    borderRadius: 24,
    ...continuousCorners,
    justifyContent: "center",
    paddingHorizontal: 14,
    backgroundColor: "rgba(250, 250, 249, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.28)",
  },
  ocrQuickControlTitle: {
    color: "#f5f5f4",
    fontSize: 13,
    fontWeight: "900",
    lineHeight: 16,
  },
  ocrQuickControlValue: {
    color: "rgba(245, 245, 244, 0.72)",
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 15,
    marginTop: 2,
  },
  ocrExpandedControls: {
    gap: 10,
    paddingTop: 18,
    width: "100%",
  },
  ocrExpandedTitle: {
    color: "#f5f5f4",
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 22,
    paddingHorizontal: 4,
  },
  ocrSettingRow: {
    alignItems: "center",
    borderRadius: 24,
    ...continuousCorners,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(250, 250, 249, 0.16)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.22)",
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
  ocrSettingPill: {
    borderRadius: 999,
    ...continuousCorners,
    paddingHorizontal: 11,
    paddingVertical: 6,
    backgroundColor: "rgba(250, 250, 249, 0.84)",
  },
  ocrSettingPillText: {
    color: "#1c1917",
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
