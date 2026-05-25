import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useScanner } from "../lib/scanner-state";

type MobileCaptureMode = "ocr" | "barcode" | "dictation";

const modeRoutes: Record<MobileCaptureMode, "/(tabs)" | "/(tabs)/scanner" | "/(tabs)/dictation"> = {
  ocr: "/(tabs)",
  barcode: "/(tabs)/scanner",
  dictation: "/(tabs)/dictation",
};

function isMobileCaptureMode(value: unknown): value is MobileCaptureMode {
  return value === "ocr" || value === "barcode" || value === "dictation";
}

export default function PairRoute() {
  const router = useRouter();
  const scanner = useScanner();
  const params = useLocalSearchParams<{ session?: string; mode?: string }>();
  const session = typeof params.session === "string" ? params.session : null;
  const mode = isMobileCaptureMode(params.mode) ? params.mode : null;
  const destination = useMemo(() => (mode ? modeRoutes[mode] : "/(tabs)"), [mode]);

  useEffect(() => {
    let cancelled = false;

    async function pairAndOpen() {
      if (session) {
        const url = `volt://pair?session=${encodeURIComponent(session)}${
          mode ? `&mode=${encodeURIComponent(mode)}` : ""
        }`;
        await scanner.pairFromUrl(url);
      }

      if (!cancelled) router.replace(destination);
    }

    void pairAndOpen();
    return () => {
      cancelled = true;
    };
  }, [destination, mode, router, scanner, session]);

  return (
    <View style={styles.root}>
      <ActivityIndicator color="#16a34a" />
      <Text style={styles.text}>Opening Volt...</Text>
    </View>
  );
}

const styles = {
  root: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 12,
    backgroundColor: "#ffffff",
  },
  text: {
    color: "#57534e",
    fontSize: 14,
    fontWeight: "700" as const,
  },
};
