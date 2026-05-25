import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import {
  Image,
  Linking,
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
  const isOcrMode = mode === "ocr";
  const canSend = Boolean(
    mode &&
      session &&
      sendState !== "sending" &&
      sendState !== "sent" &&
      (mode !== "ocr" || ocrText.trim()) &&
      (mode !== "barcode" || barcodeCandidate) &&
      (mode !== "dictation" || (dictationFinal && dictationTranscript.trim()))
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
    if (mode !== "ocr" || ocrImageUri || !hasVoltClipTextRecognizer) return;

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
    if (mode !== "ocr" || ocrImageUri || !hasVoltClipTextRecognizer) {
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
    setOcrPreviewState("idle");
    hideVoltClipTextPreview();

    try {
      const result = await captureAndRecognizeVoltClipText();
      setOcrText(result.text);
      setOcrImageUri(result.imageUri ?? null);
      setOcrState("ready");
    } catch (captureError) {
      setOcrState("error");
      setError(captureError instanceof Error ? captureError.message : "Unable to capture text");
    }
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

  if (isOcrMode) {
    return (
      <View style={styles.ocrRoot}>
        <View style={styles.ocrHeader}>
          <View style={styles.ocrHeaderBrand}>
            <Image source={require("../../assets/icon.png")} style={styles.ocrLogo} resizeMode="contain" />
            <Text style={styles.ocrTitle}>{modeTitles.ocr}</Text>
          </View>
          <Text numberOfLines={2} style={styles.ocrStatus}>
            {statusText}
          </Text>
        </View>

        <View style={styles.ocrViewfinderShell}>
          {ocrImageUri ? (
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
          ) : hasVoltClipTextRecognizer ? (
            <>
              <View pointerEvents="none" style={styles.ocrCamera} />
              <View pointerEvents="none" style={styles.ocrCameraOverlay} />
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
        <View style={styles.ocrBottomControls}>
          <Pressable
            accessibilityRole="button"
            disabled={ocrState === "capturing" || sendState === "sending"}
            onPress={() => {
              if (ocrImageUri) {
                setOcrImageUri(null);
                setOcrText("");
                setOcrState("ready");
                setOcrPreviewState("starting");
                setSendState("idle");
                setError(null);
                lastOcrClipboardRef.current = null;
                lastOcrClipboardChangeCountRef.current = null;
                return;
              }
              void captureText();
            }}
            style={[
              styles.ocrShutterButton,
              (ocrState === "capturing" || sendState === "sending") && styles.ocrShutterButtonDisabled,
            ]}
          >
            <Text style={styles.ocrShutterIcon}>
              {ocrImageUri ? "↻" : ocrState === "capturing" || sendState === "sending" ? "…" : "●"}
            </Text>
          </Pressable>
          <Text style={styles.ocrShutterLabel}>
            {ocrImageUri
              ? "Retake text capture"
              : ocrState === "capturing"
                ? "Reading text..."
                : "Tap shutter to capture text"}
          </Text>
        </View>
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
    backgroundColor: "rgba(5, 5, 5, 0.42)",
    paddingTop: stableTopInset,
  },
  ocrHeader: {
    minHeight: 70,
    paddingHorizontal: 18,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  ocrHeaderBrand: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    minHeight: 52,
  },
  ocrLogo: {
    height: 34,
    width: 34,
  },
  ocrTitle: {
    color: "#fafaf9",
    fontSize: 22,
    fontWeight: "900",
  },
  ocrStatus: {
    color: "#d6d3d1",
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 17,
    maxWidth: 170,
    textAlign: "right",
  },
  ocrViewfinderShell: {
    flex: 1,
    minHeight: 260,
    marginHorizontal: 18,
    borderRadius: 32,
    ...continuousCorners,
    overflow: "hidden",
    backgroundColor: "rgba(0, 0, 0, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.38)",
  },
  ocrCamera: {
    height: "100%",
    width: "100%",
    borderRadius: 31,
    ...continuousCorners,
    backgroundColor: "transparent",
  },
  ocrCameraOverlay: {
    ...absoluteFillObject,
    borderRadius: 31,
    ...continuousCorners,
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.42)",
    backgroundColor: "rgba(0, 0, 0, 0.08)",
  },
  ocrCapturedViewport: {
    ...absoluteFillObject,
    borderRadius: 31,
    ...continuousCorners,
    overflow: "hidden",
    backgroundColor: "#1c1917",
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
    backgroundColor: "rgba(28, 25, 23, 0.78)",
    borderWidth: 1,
    borderColor: "rgba(250, 250, 249, 0.14)",
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
    borderRadius: 18,
    ...continuousCorners,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(250, 250, 249, 0.94)",
    borderWidth: 1,
    borderColor: "rgba(22, 163, 74, 0.24)",
  },
  ocrSentTitle: {
    color: "#166534",
    fontSize: 14,
    fontWeight: "900",
  },
  ocrSentText: {
    color: "#292524",
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
    borderRadius: 18,
    ...continuousCorners,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(254, 242, 242, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(220, 38, 38, 0.22)",
  },
  ocrErrorText: {
    color: "#991b1b",
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
    gap: 10,
    minHeight: 132,
    paddingTop: 12,
    paddingBottom: 18,
  },
  ocrShutterButton: {
    alignItems: "center",
    justifyContent: "center",
    width: 78,
    height: 78,
    borderRadius: 39,
    ...continuousCorners,
    backgroundColor: "#fafaf9",
    borderWidth: 5,
    borderColor: "rgba(250, 250, 249, 0.38)",
  },
  ocrShutterButtonDisabled: {
    opacity: 0.7,
  },
  ocrShutterIcon: {
    color: "#1c1917",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 38,
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
