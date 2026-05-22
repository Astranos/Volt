import "react-native-get-random-values";
import { Slot } from "expo-router";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ScannerProvider } from "./scanner-state";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ScannerProvider>
        <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
          <Slot />
        </View>
      </ScannerProvider>
    </SafeAreaProvider>
  );
}
