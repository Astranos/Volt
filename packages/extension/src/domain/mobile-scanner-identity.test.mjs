import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mobileScannerIdentitySource = readFileSync(
  new URL("./mobile-scanner-identity.ts", import.meta.url),
  "utf8"
);
const mobileScannerSessionSource = readFileSync(
  new URL("./mobile-scanner-session.ts", import.meta.url),
  "utf8"
);

test("extension durable pairings use a canonical browser-session credential without dropping historical pairings", () => {
  assert.match(mobileScannerSessionSource, /private browserSessionPairings = new Map<string, DurablePairingCredential>\(\)/);
  assert.match(mobileScannerSessionSource, /const savedPairing = this\.browserSessionPairings\.get\(state\.sessionId\)/);
  assert.match(mobileScannerSessionSource, /savedPairing\s*\?\s*\{[\s\S]*\.\.\.savedPairing,[\s\S]*lastConnectedAt: now/);
  assert.match(mobileScannerSessionSource, /this\.browserSessionPairings\.set\(pairing\.browserSessionId, pairing\)/);
  assert.match(
    mobileScannerIdentitySource,
    /pairings\.filter\(\(item\) => item\.pairingId !== pairing\.pairingId\)/
  );
  assert.doesNotMatch(mobileScannerIdentitySource, /item\.browserSessionId !== pairing\.browserSessionId/);
});
