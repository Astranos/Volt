import { Ionicons } from "@expo/vector-icons";
import { CameraView } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { Image, Keyboard, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useEffect, useState } from "react";
import { barcodeTypes, useScanner } from "../scanner-state";

const baseFloatingBottom = Platform.select({ ios: 94, default: 86 });
const keyboardFloatingGap = 10;
const continuousCorners = Platform.select({ ios: { borderCurve: "continuous" as const }, default: null });

export default function ScannerTab() {
  const scanner = useScanner();

  if (!scanner.permission) return <View style={styles.root} />;

  if (!scanner.permission.granted) {
    return (
      <SafeAreaView edges={["top", "left", "right"]} style={styles.root}>
        <StatusBar style="light" />
        <View style={styles.permissionPanel}>
          <Image source={require("../../assets/volt-logo.png")} style={styles.permissionLogo} resizeMode="contain" />
          <Text style={styles.bodyText}>
            Camera access is needed to scan UPC, EAN, QR, Code 128, model labels, and serial labels.
          </Text>
          <Pressable style={styles.primaryButton} onPress={scanner.requestPermission}>
            <Text style={styles.primaryButtonText}>Allow Camera</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.scannerRoot}>
      <StatusBar style="light" backgroundColor="#1c1917" />
      <Header />
      <View style={styles.page}>
        <View style={styles.content}>
          <View style={styles.cameraShell}>
            <CameraView
              ref={scanner.cameraRef}
              style={styles.camera}
              facing="back"
              enableTorch={scanner.torch}
              barcodeScannerSettings={{ barcodeTypes: [...barcodeTypes] }}
              onBarcodeScanned={scanner.connected ? scanner.onBarcodeScanned : undefined}
            />
            <View style={styles.scanFrame} pointerEvents="none" />
          </View>
        </View>
        <BottomControls />
      </View>
    </SafeAreaView>
  );
}

export function Header() {
  const { setTorch, statusLabel, torch } = useScanner();

  return (
    <View style={styles.header}>
      <View style={styles.headerBrand}>
        <Image source={require("../../assets/volt-logo.png")} style={styles.headerLogo} resizeMode="contain" />
        <Text style={styles.status}>{statusLabel}</Text>
      </View>
      <Pressable style={styles.iconButton} onPress={() => setTorch((value) => !value)}>
        <Ionicons name={torch ? "flash" : "flash-outline"} size={20} color="#fafaf9" />
      </Pressable>
    </View>
  );
}

export function BottomControls() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const {
    answerCode,
    captureText,
    copyAnswer,
    hasManualText,
    manualText,
    recognizingText,
    sendManualText,
    setManualText,
    status,
  } = useScanner();

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(Math.max(0, event.endCoordinates.height));
    });
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const floatingBottom = keyboardHeight ? keyboardHeight + keyboardFloatingGap : baseFloatingBottom;

  return (
    <View style={[styles.bottomControls, { bottom: floatingBottom }]}>
      {answerCode && status !== "connected" ? (
        <Pressable style={styles.answerPanel} onPress={copyAnswer}>
          <Text style={styles.answerTitle}>Answer code ready</Text>
          <Text numberOfLines={2} style={styles.answerText}>{answerCode}</Text>
          <Text style={styles.answerHint}>Tap to copy</Text>
        </Pressable>
      ) : null}

      <View style={styles.controls}>
        <TextInput
          value={manualText}
          onChangeText={setManualText}
          placeholder="Model, serial, IMEI, asset tag..."
          placeholderTextColor="#78716c"
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.input}
          returnKeyType="send"
          onSubmitEditing={sendManualText}
        />
        <Pressable
          accessibilityLabel={hasManualText ? "Send text" : "Capture text"}
          style={[styles.actionButton, recognizingText && !hasManualText && styles.disabled]}
          onPress={hasManualText ? sendManualText : captureText}
          disabled={!hasManualText && recognizingText}
        >
          <Ionicons name={hasManualText ? "send" : "camera"} size={hasManualText ? 18 : 21} color="#f0fdf4" />
        </Pressable>
      </View>
    </View>
  );
}

export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  scannerRoot: { flex: 1, backgroundColor: "#1c1917" },
  header: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#1c1917",
  },
  status: { color: "#d6d3d1", marginTop: 2, fontSize: 13 },
  headerBrand: { gap: 3 },
  headerLogo: { width: 32, height: 32 },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#292524",
    borderWidth: 1,
    borderColor: "#44403c",
  },
  page: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    ...continuousCorners,
    overflow: "hidden",
  },
  content: { flex: 1, paddingTop: 18 },
  cameraShell: {
    marginHorizontal: 18,
    aspectRatio: 1,
    borderRadius: 32,
    ...continuousCorners,
    overflow: "hidden",
    backgroundColor: "#1c1917",
    borderWidth: 1,
    borderColor: "#292524",
  },
  camera: { flex: 1 },
  scanFrame: {
    position: "absolute",
    left: "13%",
    top: "13%",
    width: "74%",
    height: "74%",
    borderWidth: 2,
    borderColor: "#22c55e",
    borderRadius: 999,
  },
  controls: { flexDirection: "row", gap: 10 },
  input: {
    flex: 1,
    height: 58,
    borderRadius: 999,
    ...continuousCorners,
    paddingHorizontal: 22,
    color: "#1c1917",
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d6d3d1",
    fontSize: 18,
    shadowColor: "#1c1917",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  actionButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16a34a",
    shadowColor: "#15803d",
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  disabled: { opacity: 0.45 },
  bottomControls: {
    position: "absolute",
    left: 18,
    right: 18,
    zIndex: 10,
    gap: 10,
    backgroundColor: "transparent",
  },
  answerPanel: {
    padding: 12,
    borderRadius: 24,
    ...continuousCorners,
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  answerTitle: { color: "#166534", fontWeight: "700", marginBottom: 4 },
  answerText: { color: "#14532d", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 11 },
  answerHint: { color: "#16a34a", marginTop: 6, fontSize: 12 },
  permissionPanel: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 14 },
  permissionLogo: { width: 72, height: 72, marginBottom: 2 },
  bodyText: { color: "#57534e", textAlign: "center", lineHeight: 20 },
  primaryButton: {
    minHeight: 46,
    paddingHorizontal: 18,
    borderRadius: 999,
    ...continuousCorners,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16a34a",
  },
  primaryButtonText: { color: "#f0fdf4", fontWeight: "800" },
});
