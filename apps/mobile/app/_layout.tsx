import "react-native-get-random-values";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";
import { ScannerProvider } from "../lib/scanner-state";

export default function RootLayout() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ScannerProvider>
        <StatusBar style="light" />
        <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
          <Slot />
        </View>
      </ScannerProvider>
    </SafeAreaProvider>
  );
}
