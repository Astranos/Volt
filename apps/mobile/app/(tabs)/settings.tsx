import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useScanner } from "../scanner-state";
import { Header, styles } from "./index";

export default function SettingsTab() {
  const { setTorch, statusLabel, torch } = useScanner();

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.scannerRoot}>
      <StatusBar style="light" backgroundColor="#1c1917" />
      <Header />
      <View style={styles.page}>
        <View style={localStyles.tabPanel}>
          <Ionicons name="settings-outline" size={30} color="#16a34a" />
          <Text style={localStyles.emptyTitle}>Settings</Text>
          <Text style={localStyles.emptyText}>{statusLabel}</Text>
          <Pressable style={localStyles.settingsAction} onPress={() => setTorch((value) => !value)}>
            <Ionicons name={torch ? "flash" : "flash-outline"} size={18} color="#166534" />
            <Text style={localStyles.settingsActionText}>{torch ? "Flash on" : "Flash off"}</Text>
          </Pressable>
        </View>
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
  settingsAction: {
    minHeight: 42,
    marginTop: 16,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    flexDirection: "row" as const,
    gap: 8,
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  settingsActionText: { color: "#166534", fontWeight: "700" as const },
};
