import { AppRegistry, StatusBar, View } from "react-native";
import "react-native/Libraries/Renderer/shims/ReactFabric";
import "react-native/Libraries/Renderer/shims/ReactNative";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";

import ClipInvocationScreen from "./app/clip/[mode].clip";

function VoltClipApp() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics} style={{ flex: 1 }}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: "transparent" }}>
        <ClipInvocationScreen />
      </View>
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent("main", () => VoltClipApp);
