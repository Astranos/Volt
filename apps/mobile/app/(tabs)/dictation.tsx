import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useScanner } from "../scanner-state";
import { BottomControls, Header, styles } from "./index";

export default function DictationTab() {
  const {
    connected,
    dictating,
    dictationError,
    dictationTranscript,
    startDictation,
    stopDictation,
  } = useScanner();

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.scannerRoot}>
      <StatusBar style="light" backgroundColor="#1c1917" />
      <Header />
      <View style={styles.page}>
        <View style={localStyles.tabPanel}>
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
            <Ionicons name={dictating ? "mic" : "mic-outline"} size={42} color="#f0fdf4" />
          </Pressable>
          <Text style={localStyles.emptyTitle}>{dictating ? "Listening" : "Hold to speak"}</Text>
          <Text style={localStyles.emptyText}>
            {dictationTranscript || dictationError || (connected ? "Release to place speech at the browser cursor." : "Pair with Chrome to dictate into the browser.")}
          </Text>
        </View>
        <BottomControls />
      </View>
    </SafeAreaView>
  );
}

const localStyles = {
  tabPanel: {
    flex: 1,
    margin: 18,
    borderRadius: 28,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    padding: 24,
    backgroundColor: "#fafaf9",
    borderWidth: 1,
    borderColor: "#e7e5e4",
  },
  micButton: {
    width: 112,
    height: 112,
    borderRadius: 56,
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
  emptyTitle: { color: "#1c1917", fontSize: 18, fontWeight: "800" as const, marginTop: 10, textAlign: "center" as const },
  emptyText: { color: "#78716c", fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: "center" as const },
};
