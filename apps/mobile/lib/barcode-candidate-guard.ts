import type { VoltClipBarcodeCandidate } from "./volt-clip-barcode-scanner";

export function barcodeCandidateKey(candidate: VoltClipBarcodeCandidate) {
  return `${candidate.format.trim().toLowerCase()}:${candidate.value.trim().toLowerCase()}`;
}

export function createBarcodeCandidateGuard(windowMs = 1500, now = () => Date.now()) {
  const recentCandidates = new Map<string, number>();

  return (candidate: VoltClipBarcodeCandidate) => {
    const timestamp = now();
    const key = barcodeCandidateKey(candidate);
    const lastSeenAt = recentCandidates.get(key);

    for (const [recentKey, seenAt] of recentCandidates) {
      if (timestamp - seenAt > windowMs) {
        recentCandidates.delete(recentKey);
      }
    }

    if (lastSeenAt !== undefined && timestamp - lastSeenAt < windowMs) {
      return false;
    }

    recentCandidates.set(key, timestamp);
    return true;
  };
}
