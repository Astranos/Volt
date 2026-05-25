import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { normalizeCaptureMode } from "../../lib/capture-url";
import { useScanner } from "../../lib/scanner-state";

const modeRoutes: Record<"ocr" | "barcode" | "dictation" | "photo", "/(tabs)" | "/(tabs)/scanner" | "/(tabs)/dictation" | "/(tabs)/photos"> = {
  ocr: "/(tabs)",
  barcode: "/(tabs)/scanner",
  dictation: "/(tabs)/dictation",
  photo: "/(tabs)/photos",
};

export default function AppClipInvocationRoute() {
  const router = useRouter();
  const scanner = useScanner();
  const params = useLocalSearchParams<{ mode?: string; session?: string }>();
  const mode = normalizeCaptureMode(params.mode);
  const session = typeof params.session === "string" ? params.session : null;

  const destination = useMemo(() => (mode ? modeRoutes[mode] : "/(tabs)"), [mode]);

  useEffect(() => {
    let cancelled = false;

    async function openMode() {
      if (mode && session) {
        await scanner.pairFromUrl(
          `https://scanner-signal.vercel.app/clip/${mode}?session=${encodeURIComponent(session)}`
        );
      }

      if (!cancelled) router.replace(destination);
    }

    void openMode();
    return () => {
      cancelled = true;
    };
  }, [destination, mode, router, scanner, session]);

  return (
    <View style={styles.root}>
      <ActivityIndicator color="#16a34a" />
      <Text style={styles.text}>Opening Volt capture...</Text>
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
