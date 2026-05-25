import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";

export default function ClipRootLayout() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="dark" />
      <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
        <Slot />
      </View>
    </SafeAreaProvider>
  );
}
