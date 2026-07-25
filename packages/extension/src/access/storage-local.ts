export const OFFSCREEN_STORAGE_ACTION = "workspaceOffscreenStorage";

export type StorageLocalArea = {
  get: (keys: string[]) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
  remove: (keys: string[]) => Promise<void>;
};

type ChromeGlobal = typeof globalThis & { chrome?: typeof chrome };

function chromeStorageLocal() {
  const scope = globalThis as ChromeGlobal;
  return scope.chrome?.storage?.local ?? null;
}

function runtimeMessaging() {
  const scope = globalThis as ChromeGlobal;
  return scope.chrome?.runtime?.sendMessage ? scope.chrome.runtime : null;
}

async function relayToServiceWorker(
  runtime: NonNullable<ReturnType<typeof runtimeMessaging>>,
  operation: "get" | "set" | "remove",
  payload: Record<string, unknown>,
) {
  const response: unknown = await runtime.sendMessage({
    action: OFFSCREEN_STORAGE_ACTION,
    operation,
    ...payload,
  });
  const record = response && typeof response === "object"
    ? (response as Record<string, unknown>)
    : null;
  if (record?.success !== true) {
    const detail = typeof record?.error === "string" ? record.error : "no_response";
    throw new Error(`Storage ${operation} failed: ${detail}`);
  }
  return record.value;
}

function localStorageGet(keys: string[]) {
  const values: Record<string, unknown> = {};
  try {
    for (const key of keys) {
      const stored = globalThis.localStorage?.getItem(key);
      if (stored === null || typeof stored === "undefined") continue;
      try {
        values[key] = JSON.parse(stored);
      } catch (_error) {
        values[key] = stored;
      }
    }
  } catch (_error) {}
  return values;
}

/**
 * chrome.storage.local, reachable from every Volt context.
 *
 * Offscreen documents get a cut-down extension API surface — the same reason
 * chrome.runtime.getManifest is missing there — and chrome.storage is absent
 * from it too. A document that quietly fell back to its own localStorage would
 * mint a second install id and register a second computer, so the phone would
 * deliver scans to a row nothing was listening on. Relaying to the service
 * worker keeps every context on one store. The localStorage fallback is only
 * for contexts with no extension APIs at all.
 */
export const storageLocal: StorageLocalArea = {
  get: async (keys) => {
    const area = chromeStorageLocal();
    if (area) return await area.get(keys) as Record<string, unknown>;
    const runtime = runtimeMessaging();
    if (runtime) {
      const value = await relayToServiceWorker(runtime, "get", { keys });
      return value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    }
    return localStorageGet(keys);
  },
  set: async (values) => {
    const area = chromeStorageLocal();
    if (area) return await area.set(values);
    const runtime = runtimeMessaging();
    if (runtime) {
      await relayToServiceWorker(runtime, "set", { values });
      return;
    }
    try {
      for (const [key, value] of Object.entries(values)) {
        if (typeof value === "undefined") {
          globalThis.localStorage?.removeItem(key);
        } else {
          globalThis.localStorage?.setItem(
            key,
            typeof value === "string" ? value : JSON.stringify(value),
          );
        }
      }
    } catch (_error) {}
  },
  remove: async (keys) => {
    const area = chromeStorageLocal();
    if (area) return await area.remove(keys);
    const runtime = runtimeMessaging();
    if (runtime) {
      await relayToServiceWorker(runtime, "remove", { keys });
      return;
    }
    try {
      for (const key of keys) globalThis.localStorage?.removeItem(key);
    } catch (_error) {}
  },
};
