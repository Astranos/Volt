import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BottomControls, Header, styles } from "./index";

export default function DictationTab() {
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.scannerRoot}>
      <StatusBar style="light" backgroundColor="#1c1917" />
      <Header />
      <View style={styles.page}>
        <View style={localStyles.tabPanel}>
          <Ionicons name="mic-outline" size={30} color="#16a34a" />
          <Text style={localStyles.emptyTitle}>Dictation</Text>
          <Text style={localStyles.emptyText}>Use the text controls below to send model, serial, IMEI, or asset tag notes.</Text>
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
  emptyTitle: { color: "#1c1917", fontSize: 18, fontWeight: "800" as const, marginTop: 10, textAlign: "center" as const },
  emptyText: { color: "#78716c", fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: "center" as const },
};
