import { isScannerSessionId } from "../../../scanner-protocol/src";
import { createId } from "./mobile-scanner-ids";

export const MOBILE_SCANNER_IDENTITY_STORAGE_KEYS = {
  installId: "volt.mobileScanner.extensionInstallId",
  sessionLabel: "volt.mobileScanner.sessionLabel",
  pairings: "volt.mobileScanner.pairedBrowsers.v1",
} as const;

export type ExtensionIdentity = {
  installId: string;
  sessionLabel: string;
};

export type DurablePairingCredential = {
  pairingId: string;
  pairingSecret: string;
  browserSessionId: string;
  displayName: string;
  createdAt: string;
  lastConnectedAt: string;
};

export type WebPushSubscriptionRecord = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    auth: string;
    p256dh: string;
  };
};

function normalizeIdentityLabel(value: unknown) {
  const label = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return label.slice(0, 80);
}

function defaultSessionLabel() {
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    "";
  if (/mac/i.test(platform)) return "Chrome on Mac";
  if (/win/i.test(platform)) return "Chrome on Windows";
  if (/linux|cros/i.test(platform)) return "Chrome on Linux";
  return "Chrome session";
}

function storageLocalGet(keys: string[]) {
  const chromeApi = globalThis as typeof globalThis & { chrome?: typeof chrome };
  if (chromeApi.chrome?.storage?.local?.get) {
    return chromeApi.chrome.storage.local.get(keys) as Promise<Record<string, unknown>>;
  }
  const fallback: Record<string, unknown> = {};
  try {
    for (const key of keys) {
      const storedValue = globalThis.localStorage?.getItem(key);
      if (storedValue === null || typeof storedValue === "undefined") {
        fallback[key] = undefined;
        continue;
      }
      try {
        fallback[key] = JSON.parse(storedValue);
      } catch (_error) {
        fallback[key] = storedValue;
      }
    }
  } catch (_error) {}
  return Promise.resolve(fallback);
}

function storageLocalSet(values: Record<string, unknown>) {
  const chromeApi = globalThis as typeof globalThis & { chrome?: typeof chrome };
  if (chromeApi.chrome?.storage?.local?.set) {
    return chromeApi.chrome.storage.local.set(values) as Promise<void>;
  }
  try {
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "undefined") {
        globalThis.localStorage?.removeItem(key);
      } else if (typeof value === "string") {
        globalThis.localStorage?.setItem(key, value);
      } else {
        globalThis.localStorage?.setItem(key, JSON.stringify(value));
      }
    }
  } catch (_error) {}
  return Promise.resolve();
}

function normalizePairingCredential(value: unknown): DurablePairingCredential | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<DurablePairingCredential>;
  if (
    typeof record.pairingId !== "string" ||
    typeof record.pairingSecret !== "string" ||
    typeof record.browserSessionId !== "string" ||
    typeof record.displayName !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.lastConnectedAt !== "string"
  ) {
    return null;
  }
  return {
    pairingId: record.pairingId,
    pairingSecret: record.pairingSecret,
    browserSessionId: record.browserSessionId,
    displayName: record.displayName,
    createdAt: record.createdAt,
    lastConnectedAt: record.lastConnectedAt,
  };
}

export async function loadDurablePairings() {
  const key = MOBILE_SCANNER_IDENTITY_STORAGE_KEYS.pairings;
  const stored = await storageLocalGet([key]);
  const value = stored[key];
  if (!Array.isArray(value)) return [];
  return value.map(normalizePairingCredential).filter((item): item is DurablePairingCredential => !!item);
}

export async function saveDurablePairing(pairing: DurablePairingCredential) {
  const key = MOBILE_SCANNER_IDENTITY_STORAGE_KEYS.pairings;
  const pairings = await loadDurablePairings();
  const nextPairings = [
    pairing,
    ...pairings.filter((item) => item.pairingId !== pairing.pairingId && item.browserSessionId !== pairing.browserSessionId),
  ].slice(0, 12);
  await storageLocalSet({ [key]: nextPairings });
}

export async function getMobileScannerPushSubscription(): Promise<WebPushSubscriptionRecord | null> {
  const chromeApi = globalThis as typeof globalThis & { chrome?: typeof chrome };
  if (!chromeApi.chrome?.runtime?.sendMessage) return null;
  try {
    const response = await chromeApi.chrome.runtime.sendMessage({
      action: "scannerGetPushSubscription",
    });
    const subscription = response?.subscription;
    if (
      subscription &&
      typeof subscription.endpoint === "string" &&
      subscription.keys &&
      typeof subscription.keys.auth === "string" &&
      typeof subscription.keys.p256dh === "string"
    ) {
      return subscription;
    }
  } catch (_error) {}
  return null;
}

export async function getMobileScannerExtensionIdentity(): Promise<ExtensionIdentity> {
  const keys = MOBILE_SCANNER_IDENTITY_STORAGE_KEYS;
  const stored = await storageLocalGet([keys.installId, keys.sessionLabel]);
  const storedInstallId = stored[keys.installId];
  const installId = isScannerSessionId(storedInstallId) ? storedInstallId : createId("chrome-install");
  const sessionLabel = normalizeIdentityLabel(stored[keys.sessionLabel]) || defaultSessionLabel();

  if (installId !== storedInstallId || sessionLabel !== stored[keys.sessionLabel]) {
    await storageLocalSet({
      [keys.installId]: installId,
      [keys.sessionLabel]: sessionLabel,
    });
  }

  return { installId, sessionLabel };
}

export async function saveMobileScannerSessionLabel(label: string): Promise<ExtensionIdentity> {
  const sessionLabel = normalizeIdentityLabel(label) || defaultSessionLabel();
  const identity = await getMobileScannerExtensionIdentity();
  const nextIdentity = { ...identity, sessionLabel };
  await storageLocalSet({
    [MOBILE_SCANNER_IDENTITY_STORAGE_KEYS.installId]: nextIdentity.installId,
    [MOBILE_SCANNER_IDENTITY_STORAGE_KEYS.sessionLabel]: nextIdentity.sessionLabel,
  });
  return nextIdentity;
}
