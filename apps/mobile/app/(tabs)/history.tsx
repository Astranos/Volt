import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useScanner } from "../scanner-state";
import { Header, styles } from "./index";

export default function HistoryTab() {
  const { scans } = useScanner();

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.scannerRoot}>
      <StatusBar style="light" backgroundColor="#1c1917" />
      <Header />
      <View style={localStyles.page}>
        <ScrollView style={localStyles.history} contentContainerStyle={localStyles.historyContent}>
          {scans.length ? scans.map((scan) => (
            <View key={scan.id} style={localStyles.scanRow}>
              <View style={localStyles.scanTextBlock}>
                <Text numberOfLines={1} style={localStyles.scanValue}>{scan.barcode}</Text>
                <Text style={localStyles.scanMeta}>{scan.kind} • {scan.format}</Text>
              </View>
              <Ionicons name="checkmark-circle" size={20} color="#22c55e" />
            </View>
          )) : (
            <View style={localStyles.emptyState}>
              <Ionicons name="time-outline" size={28} color="#16a34a" />
              <Text style={localStyles.emptyTitle}>No scans yet</Text>
              <Text style={localStyles.emptyText}>Scanned barcodes and captured text will appear here.</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const localStyles = {
  page: { ...styles.page, borderTopLeftRadius: 36, borderTopRightRadius: 36 },
  history: { flex: 1, marginTop: 12 },
  historyContent: { paddingHorizontal: 18, paddingBottom: 132, gap: 8 },
  scanRow: {
    minHeight: 54,
    borderRadius: 27,
    paddingHorizontal: 12,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    backgroundColor: "#fafaf9",
    borderWidth: 1,
    borderColor: "#e7e5e4",
  },
  scanTextBlock: { flex: 1, paddingRight: 12 },
  scanValue: { color: "#1c1917", fontSize: 15, fontWeight: "700" as const },
  scanMeta: { color: "#78716c", fontSize: 12, marginTop: 2, textTransform: "uppercase" as const },
  emptyState: { minHeight: 220, alignItems: "center" as const, justifyContent: "center" as const, padding: 24 },
  emptyTitle: { color: "#1c1917", fontSize: 18, fontWeight: "800" as const, marginTop: 10, textAlign: "center" as const },
  emptyText: { color: "#78716c", fontSize: 14, lineHeight: 20, marginTop: 6, textAlign: "center" as const },
};
