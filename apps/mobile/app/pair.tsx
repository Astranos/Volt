import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import {
  buildPairUrl,
  normalizeFullCaptureMode,
  routeForCaptureMode,
} from "../lib/capture-modes";
import { useScanner } from "../lib/scanner-state";

export default function PairRoute() {
  const router = useRouter();
  const scanner = useScanner();
  const params = useLocalSearchParams<{ session?: string; mode?: string }>();
  const session = typeof params.session === "string" ? params.session : null;
  const mode = normalizeFullCaptureMode(params.mode);
  const destination = useMemo(() => routeForCaptureMode(mode), [mode]);

  useEffect(() => {
    let cancelled = false;

    async function pairAndOpen() {
      if (session) {
        await scanner.pairFromUrl(buildPairUrl(session, mode));
      }

      if (!cancelled) router.replace(destination as never);
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
