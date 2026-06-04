import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
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
  const [pairingError, setPairingError] = useState<string | null>(null);
  const params = useLocalSearchParams<{ join?: string; joinToken?: string; mode?: string; session?: string; token?: string }>();
  const joinToken =
    typeof params.joinToken === "string"
      ? params.joinToken
      : typeof params.join === "string"
        ? params.join
        : typeof params.token === "string"
          ? params.token
          : null;
  const session =
    typeof params.session === "string"
      ? params.session
      : joinToken;
  const mode = normalizeFullCaptureMode(params.mode);
  const destination = useMemo(() => routeForCaptureMode(mode), [mode]);

  useEffect(() => {
    let cancelled = false;

    async function pairAndOpen() {
      if (session) {
        const paired = await scanner.pairFromUrl(buildPairUrl(session, mode, joinToken));
        if (!paired) {
          if (!cancelled) setPairingError("This Chrome pairing code expired. Open a fresh QR in the Volt extension and scan it again.");
          return;
        }
      }
      if (mode) scanner.setActiveMode(mode);

      if (!cancelled) router.replace(destination as never);
    }

    void pairAndOpen();
    return () => {
      cancelled = true;
    };
  }, [destination, mode, router, scanner, session]);

  return (
    <View style={styles.root}>
      {pairingError ? null : <ActivityIndicator color="#16a34a" />}
      <Text style={styles.text}>{pairingError ?? "Opening Volt..."}</Text>
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
