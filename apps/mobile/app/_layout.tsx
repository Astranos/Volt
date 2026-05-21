import "react-native-get-random-values";
import { Slot } from "expo-router";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: "#0b0f14" }}>
        <Slot />
      </View>
    </SafeAreaProvider>
  );
}
