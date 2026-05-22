import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useScanner } from "../scanner-state";
import { Header, styles } from "./index";

export default function SettingsTab() {
  const { setSetting, setTorch, settings, statusLabel, torch } = useScanner();

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.scannerRoot}>
      <StatusBar style="light" backgroundColor="#1c1917" />
      <Header />
      <View style={styles.page}>
        <ScrollView style={localStyles.scroll} contentContainerStyle={localStyles.scrollContent}>
          <View style={localStyles.headerBlock}>
            <Ionicons name="settings-outline" size={30} color="#16a34a" />
            <View>
              <Text style={localStyles.emptyTitle}>Settings</Text>
              <Text style={localStyles.emptyText}>{statusLabel}</Text>
            </View>
          </View>

          <SettingRow
            icon={torch ? "flash" : "flash-outline"}
            title="Flash"
            description="Keep the camera torch on for OCR and scanner pages."
            value={torch}
            onValueChange={setTorch}
          />
          <SettingRow
            icon="barcode-outline"
            title="Auto-send scanner codes"
            description="Type a single detected scanner barcode into Chrome automatically."
            value={settings.autoSendSingleBarcode}
            onValueChange={(value) => setSetting("autoSendSingleBarcode", value)}
          />
          <SettingRow
            icon="copy-outline"
            title="Confirm multiple codes"
            description="Ask which barcode to type when more than one code is detected."
            value={settings.confirmMultipleBarcodes}
            onValueChange={(value) => setSetting("confirmMultipleBarcodes", value)}
          />
          <SettingRow
            icon="scan-outline"
            title="OCR capture reads codes"
            description="Also look for barcodes and QR codes when you tap capture on OCR."
            value={settings.detectCodesOnOcrCapture}
            onValueChange={(value) => setSetting("detectCodesOnOcrCapture", value)}
          />
          <SettingRow
            icon="mic-outline"
            title="Dictation punctuation"
            description="Add punctuation to spoken text before sending it to Chrome."
            value={settings.dictationPunctuation}
            onValueChange={(value) => setSetting("dictationPunctuation", value)}
          />
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function SettingRow({
  description,
  icon,
  onValueChange,
  title,
  value,
}: {
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  onValueChange: (value: boolean) => void;
  title: string;
  value: boolean;
}) {
  return (
    <View style={localStyles.settingRow}>
      <View style={localStyles.settingIcon}>
        <Ionicons name={icon} size={20} color="#166534" />
      </View>
      <View style={localStyles.settingCopy}>
        <Text style={localStyles.settingTitle}>{title}</Text>
        <Text style={localStyles.settingDescription}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: "#d6d3d1", true: "#bbf7d0" }}
        thumbColor={value ? "#16a34a" : "#fafaf9"}
      />
    </View>
  );
}

const localStyles = {
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 18,
    paddingBottom: 122,
    gap: 12,
  },
  headerBlock: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 18,
    borderRadius: 24,
    backgroundColor: "#fafaf9",
    borderWidth: 1,
    borderColor: "#e7e5e4",
  },
  emptyTitle: { color: "#1c1917", fontSize: 20, fontWeight: "800" as const },
  emptyText: { color: "#78716c", fontSize: 14, lineHeight: 20, marginTop: 2 },
  settingRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 12,
    padding: 16,
    borderRadius: 24,
    backgroundColor: "#fafaf9",
    borderWidth: 1,
    borderColor: "#e7e5e4",
  },
  settingIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    backgroundColor: "#f0fdf4",
  },
  settingCopy: {
    flex: 1,
  },
  settingTitle: { color: "#1c1917", fontSize: 15, fontWeight: "800" as const },
  settingDescription: { color: "#78716c", fontSize: 13, lineHeight: 18, marginTop: 3 },
};
