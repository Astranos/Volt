import { Ionicons } from "@expo/vector-icons";
import { CameraView as ExpoCameraView, type BarcodeScanningResult } from "expo-camera";
import { Pressable, Text, View } from "react-native";
import { useRef, useState, type ComponentType } from "react";
import { useScanner } from "../../lib/scanner-state";
import { Header, PairingPanel, ScreenRoot, styles } from "./index";

const CameraView = ExpoCameraView as unknown as ComponentType<any>;

export default function DictationTab() {
  const scanner = useScanner();
  const {
    connected,
    dictating,
    dictationError,
    dictationTranscript,
    startDictation,
    stopDictation,
  } = scanner;
  const [pairScannerOpen, setPairScannerOpen] = useState(false);
  const [pairScannerLocked, setPairScannerLocked] = useState(false);
  const [pairScannerError, setPairScannerError] = useState<string | null>(null);
  const pairScannerLockedRef = useRef(false);

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
          <View style={localStyles.tabPanel}>
            <View style={localStyles.instructionBlock}>
              <Text style={localStyles.emptyTitle}>Browser dictation</Text>
              <Text style={localStyles.emptyText}>
                Put the cursor anywhere in the browser, then hold the button below to speak directly into that field.
              </Text>
              {dictationTranscript || dictationError ? (
                <Text style={localStyles.transcriptText}>{dictationTranscript || dictationError}</Text>
              ) : null}
            </View>
            <View style={localStyles.bottomSection}>
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
              <Text style={localStyles.holdLabel}>{dictating ? "Listening" : "Hold to speak"}</Text>
              <Text style={localStyles.holdHint}>
                {connected ? "Release to send." : "Pair with Chrome first."}
              </Text>
            </View>
          </View>
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
    margin: 18,
    marginBottom: 0,
    borderRadius: 28,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    padding: 22,
    backgroundColor: "#fafaf9",
    borderWidth: 1,
    borderColor: "#e7e5e4",
  },
  instructionBlock: {
    width: "100%" as const,
    alignItems: "center" as const,
    paddingTop: 12,
  },
  bottomSection: {
    width: "100%" as const,
    alignItems: "center" as const,
    paddingBottom: 18,
  },
  micButton: {
    width: 148,
    height: 148,
    borderRadius: 74,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "#16a34a",
    shadowColor: "#15803d",
    shadowOpacity: 0.26,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  micButtonActive: {
    backgroundColor: "#dc2626",
    transform: [{ scale: 1.04 }],
  },
  micButtonDisabled: {
    backgroundColor: "#a8a29e",
    shadowOpacity: 0.08,
  },
  emptyTitle: { color: "#1c1917", fontSize: 22, fontWeight: "800" as const, textAlign: "center" as const },
  emptyText: { color: "#78716c", fontSize: 15, lineHeight: 22, marginTop: 8, textAlign: "center" as const },
  transcriptText: {
    width: "100%" as const,
    marginTop: 18,
    padding: 14,
    borderRadius: 18,
    color: "#1c1917",
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center" as const,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e7e5e4",
  },
  holdLabel: { color: "#1c1917", fontSize: 19, fontWeight: "800" as const, marginTop: 14, textAlign: "center" as const },
  holdHint: { color: "#78716c", fontSize: 13, marginTop: 5, textAlign: "center" as const },
};
