import { beforeEach, expect, test, vi } from "vitest";
import { loadDurablePairings, saveDurablePairing, MOBILE_SCANNER_IDENTITY_STORAGE_KEYS, type DurablePairingCredential } from "./mobile-scanner-identity";

const stored = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../access/storage-local", () => ({
  storageLocal: {
    get: async (keys: string[]) => Object.fromEntries(keys.map((key) => [key, stored.get(key)])),
    set: async (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) stored.set(key, value);
    },
  },
}));

function pairing(pairingId: string, browserSessionId = "browser-1"): DurablePairingCredential {
  return { pairingId, browserSessionId, pairingSecret: `secret-${pairingId}`, displayName: "Browser", createdAt: "2026-09-21T12:00:00Z", lastConnectedAt: "2026-09-21T12:00:00Z" };
}

beforeEach(() => stored.clear());

test("retains historical credentials for the same browser session", async () => {
  const old = pairing("old");
  const current = pairing("current");
  await saveDurablePairing(old);
  await saveDurablePairing(current);
  expect(await loadDurablePairings()).toEqual([current, old]);
});

test("reconnecting updates the existing credential without duplicating it", async () => {
  const original = pairing("same");
  await saveDurablePairing(original);
  const reconnected = { ...original, lastConnectedAt: "2026-09-22T12:00:00Z" };
  await saveDurablePairing(reconnected);
  expect(await loadDurablePairings()).toEqual([reconnected]);
});

test("keeps the twelve most recently saved pairings", async () => {
  for (let index = 0; index < 14; index++) await saveDurablePairing(pairing(String(index)));
  expect((await loadDurablePairings()).map((item) => item.pairingId)).toEqual(Array.from({ length: 12 }, (_, index) => String(13 - index)));
});

test("ignores malformed persisted credentials", async () => {
  const valid = pairing("valid");
  stored.set(MOBILE_SCANNER_IDENTITY_STORAGE_KEYS.pairings, [null, {}, { ...valid, pairingSecret: 42 }, valid]);
  expect(await loadDurablePairings()).toEqual([valid]);
});
