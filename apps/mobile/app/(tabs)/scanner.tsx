import { Ionicons } from "@expo/vector-icons";
import { CameraView, type BarcodeScanningResult } from "expo-camera";
import { Image, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRef, useState } from "react";
import { barcodeTypes, useScanner } from "../../lib/scanner-state";
import { Header, PairingPanel, styles } from "./index";

export default function ScannerTab() {
  const scanner = useScanner();
  const permission = scanner.permission;
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

  if (scanner.connected) {
    if (!permission || !permission.granted) {
      return (
        <SafeAreaView edges={["top", "left", "right"]} style={styles.scannerRoot}>
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
        </SafeAreaView>
      );
    }
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.scannerRoot}>
      <Header />
      <View style={[styles.page, !scanner.connected && styles.disconnectedPage]}>
        <View style={styles.content}>
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
                <CameraView
                  style={styles.camera}
                  facing="back"
                  enableTorch={scanner.torch}
                  barcodeScannerSettings={{ barcodeTypes: [...barcodeTypes] }}
                  onBarcodeScanned={scanner.onBarcodeScanned}
                />
                <View style={styles.scanFrame} pointerEvents="none" />
              </View>
              <View style={localStyles.hintPanel}>
                <Text style={localStyles.hintTitle}>Auto scanner</Text>
                <Text style={localStyles.hintText}>
                  Point at a barcode to type it into the active browser field. Multiple codes in view will ask first.
                </Text>
              </View>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const localStyles = {
  hintPanel: {
    marginHorizontal: 18,
    marginTop: 14,
    padding: 16,
    borderRadius: 22,
    backgroundColor: "#fafaf9",
    borderWidth: 1,
    borderColor: "#e7e5e4",
  },
  hintTitle: { color: "#1c1917", fontSize: 16, fontWeight: "800" as const },
  hintText: { color: "#78716c", fontSize: 14, lineHeight: 20, marginTop: 4 },
};
