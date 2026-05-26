import { Ionicons } from "@expo/vector-icons";
import { CameraView as ExpoCameraView, type BarcodeScanningResult } from "../../lib/expo-camera";
import { Animated, Pressable, Text, View } from "react-native";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { useScanner } from "../../lib/scanner-state";
import { Header, PairingPanel, ScreenRoot, ViewfinderSurface, styles } from "./index";

const CameraView = ExpoCameraView as unknown as ComponentType<any>;

export default function DictationTab() {
  const scanner = useScanner();
  const {
    connected,
    dictating,
    dictationError,
    dictationTranscript,
    prepareDictation,
    startDictation,
    stopDictation,
  } = scanner;
  const [pairScannerOpen, setPairScannerOpen] = useState(false);
  const [pairScannerLocked, setPairScannerLocked] = useState(false);
  const [pairScannerError, setPairScannerError] = useState<string | null>(null);
  const pairScannerLockedRef = useRef(false);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (connected) void prepareDictation();
  }, [connected, prepareDictation]);

  useEffect(() => {
    pulse.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: dictating ? 560 : 1100,
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: dictating ? 560 : 1100,
          toValue: 0,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [dictating, pulse]);

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

  return (
    <ScreenRoot>
      <Header />
      <View style={[styles.page, !connected ? styles.disconnectedPage : localStyles.dictationPage]}>
        {!connected ? (
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
        ) : (
          <ViewfinderSurface>
            <View style={localStyles.dictationBackdrop}>
              <Animated.View
                pointerEvents="none"
                style={[
                  localStyles.micPulse,
                  {
                    opacity: pulse.interpolate({
                      inputRange: [0, 1],
                      outputRange: dictating ? [0.28, 0.66] : [0.1, 0.22],
                    }),
                    transform: [
                      {
                        scale: pulse.interpolate({
                          inputRange: [0, 1],
                          outputRange: dictating ? [0.92, 1.18] : [0.98, 1.06],
                        }),
                      },
                    ],
                  },
                ]}
              />
              <View style={localStyles.dictationTopCopy}>
                <Text style={localStyles.emptyTitle}>Browser dictation</Text>
                <Text style={localStyles.emptyText}>
                  Hold to stream speech into the active browser field.
                </Text>
              </View>
              <Pressable
                accessibilityLabel="Hold to speak"
                disabled={!connected}
                onPressIn={startDictation}
                onPressOut={stopDictation}
                style={[
                  localStyles.micButton,
                  dictating && localStyles.micButtonActive,
                  !connected && localStyles.micButtonDisabled,
                ]}
              >
                <Ionicons name={dictating ? "mic" : "mic-outline"} size={54} color="#f0fdf4" />
              </Pressable>
              <View style={localStyles.dictationStatus}>
                <View style={[localStyles.statusDot, dictating && localStyles.statusDotActive, dictationError && localStyles.statusDotError]} />
                <Text numberOfLines={1} style={localStyles.holdLabel}>
                  {dictationError ? "Dictation unavailable" : dictating ? "Listening" : "Hold to speak"}
                </Text>
              </View>
              {dictationTranscript || dictationError ? (
                <Text numberOfLines={4} style={[localStyles.transcriptText, dictationError && localStyles.transcriptError]}>
                  {dictationTranscript || dictationError}
                </Text>
              ) : (
                <Text style={localStyles.holdHint}>
                  Put the cursor in Chrome, then press and hold.
                </Text>
              )}
            </View>
          </ViewfinderSurface>
        )}
      </View>
    </ScreenRoot>
  );
}

const localStyles = {
  dictationPage: {
    paddingBottom: 104,
  },
  tabPanel: {
    flex: 1,
  },
  dictationBackdrop: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    overflow: "hidden" as const,
    padding: 26,
    backgroundColor: "#0c1912",
  },
  micPulse: {
    position: "absolute" as const,
    width: 310,
    height: 310,
    borderRadius: 155,
    backgroundColor: "#22c55e",
  },
  dictationTopCopy: {
    position: "absolute" as const,
    top: 34,
    left: 24,
    right: 24,
    alignItems: "center" as const,
  },
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
  micButtonActive: {
    backgroundColor: "#dc2626",
    transform: [{ scale: 1.04 }],
  },
  micButtonDisabled: {
    backgroundColor: "#a8a29e",
  },
  emptyTitle: { color: "#f0fdf4", fontSize: 22, fontWeight: "800" as const, textAlign: "center" as const },
  emptyText: { color: "#bbf7d0", fontSize: 15, lineHeight: 22, marginTop: 8, textAlign: "center" as const },
  transcriptText: {
    width: "100%" as const,
    marginTop: 16,
    minHeight: 74,
    padding: 16,
    borderRadius: 18,
    color: "#f0fdf4",
    fontSize: 18,
    lineHeight: 25,
    textAlign: "center" as const,
    backgroundColor: "rgba(0, 0, 0, 0.28)",
    borderWidth: 1,
    borderColor: "rgba(187, 247, 208, 0.2)",
  },
  transcriptError: {
    color: "#fecaca",
    borderColor: "rgba(248, 113, 113, 0.32)",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#a8a29e",
  },
  statusDotActive: {
    backgroundColor: "#22c55e",
  },
  statusDotError: {
    backgroundColor: "#ef4444",
  },
  holdLabel: { color: "#f0fdf4", fontSize: 15, fontWeight: "800" as const, textAlign: "center" as const },
  holdHint: { color: "#bbf7d0", fontSize: 14, marginTop: 16, textAlign: "center" as const },
};
