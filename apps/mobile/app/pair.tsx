import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { buildScannerJoinUrl, SCANNER_APP_PAIR_URL } from "@volt/scanner-protocol";
import {
  normalizeFullCaptureMode,
  routeForCaptureMode,
} from "../lib/capture-modes";
import { useScanner } from "../lib/scanner-state";

export default function PairRoute() {
  const router = useRouter();
  const scanner = useScanner();
  const [pairingError, setPairingError] = useState<string | null>(null);
  const params = useLocalSearchParams<{ answerUrl?: string; joinAttemptId?: string; mode?: string; offer?: string; sessionId?: string; token?: string }>();
  const token = typeof params.token === "string" ? params.token : null;
  const offer = typeof params.offer === "string" ? params.offer : null;
  const sessionId = typeof params.sessionId === "string" ? params.sessionId : undefined;
  const mode = normalizeFullCaptureMode(params.mode);
  const destination = useMemo(() => routeForCaptureMode(mode), [mode]);

  useEffect(() => {
    let cancelled = false;

    async function pairAndOpen() {
      if (token || offer) {
        let pairUrl: string;
        if (token) {
          try {
            pairUrl = buildScannerJoinUrl({
              baseUrl: SCANNER_APP_PAIR_URL,
              token,
              sessionId,
              joinAttemptId: typeof params.joinAttemptId === "string" ? params.joinAttemptId : undefined,
            });
          } catch {
            if (!cancelled) setPairingError("This Chrome pairing code is invalid. Open a fresh QR in the Volt extension and scan it again.");
            return;
          }
        } else {
          const searchParams = new URLSearchParams({ offer: offer! });
          if (sessionId) searchParams.set("sessionId", sessionId);
          if (typeof params.answerUrl === "string") searchParams.set("answerUrl", params.answerUrl);
          pairUrl = `${SCANNER_APP_PAIR_URL}?${searchParams.toString()}`;
        }
        const paired = await scanner.pairFromUrl(pairUrl);
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
  }, [destination, mode, offer, params.answerUrl, params.joinAttemptId, router, scanner, sessionId, token]);

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
