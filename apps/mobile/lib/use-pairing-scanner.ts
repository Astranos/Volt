import { useCallback, useRef, useState } from "react";
import type { BarcodeScanningResult } from "./expo-camera";
import { useScanner } from "./scanner-state";

export function usePairingScanner() {
  const scanner = useScanner();
  const [pairScannerOpen, setPairScannerOpen] = useState(false);
  const [pairScannerLocked, setPairScannerLocked] = useState(false);
  const [pairScannerError, setPairScannerError] = useState<string | null>(null);
  const pairScannerLockedRef = useRef(false);

  const openPairScanner = useCallback(async () => {
    if (!scanner.permission?.granted) {
      const nextPermission = await scanner.requestPermission();
      if (!nextPermission.granted) {
        setPairScannerError("Camera permission is required to scan the extension QR.");
        return;
      }
    }

    setPairScannerError(null);
    setPairScannerLocked(false);
    pairScannerLockedRef.current = false;
    setPairScannerOpen(true);
  }, [scanner]);

  const onPairingQrScanned = useCallback(async ({ data }: BarcodeScanningResult) => {
    if (pairScannerLockedRef.current) return;

    pairScannerLockedRef.current = true;
    setPairScannerLocked(true);
    const accepted = await scanner.pairFromUrl(data.trim());

    if (accepted) {
      setPairScannerOpen(false);
      setPairScannerError(null);
      return;
    }

    setPairScannerError("That QR code is not a Volt pairing code.");
    setTimeout(() => {
      pairScannerLockedRef.current = false;
      setPairScannerLocked(false);
    }, 1200);
  }, [scanner]);

  const resetPairingScanner = useCallback(() => {
    setPairScannerOpen(false);
    setPairScannerLocked(false);
    setPairScannerError(null);
    pairScannerLockedRef.current = false;
  }, []);

  return {
    openPairScanner,
    onPairingQrScanned,
    pairScannerError,
    pairScannerLocked,
    pairScannerOpen,
    resetPairingScanner,
  };
}
