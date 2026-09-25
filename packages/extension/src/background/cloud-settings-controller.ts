import { isTrustedExtensionPageSender, type ExtensionMessageSender } from "../access/sender-policy";
import { DEFAULT_SETTINGS, structuredCloneSettings } from "../domain/settings";

export const CLOUD_SETTINGS_LOCAL_KEY = "volt.extensionSettings.cloud.v1";
const PENDING_SETTINGS_LOCAL_KEY = "volt.extensionSettings.pending.v1";
// Chrome counts the key and serialized value toward its 8 KiB per-item sync quota.
const MAX_SETTINGS_PAYLOAD_BYTES = 8192 - "cmdkSettings".length;

type CloudSettingsRecord = {
  subject: string;
  revision: number;
  updatedAt: number;
};
type PendingSettingsRecord = { subject: string; payload: string };

type SettingsEnvelope = {
  payload: string;
  revision: number;
  updatedAt: number;
  subject?: string;
};

type ControllerOptions = {
  chromeApi: typeof chrome;
  sendOffscreenMessage: (message: unknown) => Promise<unknown>;
  extensionId: string;
};

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validEnvelope(value: unknown): SettingsEnvelope | null {
  const record = recordFrom(value);
  if (!record || typeof record.payload !== "string"
    || typeof record.revision !== "number" || !Number.isInteger(record.revision)
    || typeof record.updatedAt !== "number") return null;
  return {
    payload: record.payload,
    revision: record.revision,
    updatedAt: record.updatedAt,
    ...(typeof record.subject === "string" ? { subject: record.subject } : {}),
  };
}

function validSettingsPayload(payload: string) {
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function createCloudSettingsController({
  chromeApi,
  sendOffscreenMessage,
  extensionId,
}: ControllerOptions) {
  let activeSubject: string | null = null;
  let activeRevision: number | null = null;
  let applyingCloud = false;
  let initialized = false;
  let syncQueue = Promise.resolve();
  let operationGeneration = 0;
  let pendingSettings: unknown = undefined;
  let pendingSubject: string | null = null;
  let pendingLoad: Promise<void> | null = null;
  async function localSettings() {
    const [settings, metadata] = await Promise.all([
      chromeApi.storage.sync.get("cmdkSettings"),
      chromeApi.storage.local.get(CLOUD_SETTINGS_LOCAL_KEY),
    ]);
    const local = recordFrom(metadata[CLOUD_SETTINGS_LOCAL_KEY]);
    return {
      settings: settings.cmdkSettings,
      metadata: local && typeof local.subject === "string"
        && typeof local.revision === "number" ? local as CloudSettingsRecord : null,
    };
  }

  async function loadPending() {
    if (pendingLoad) return pendingLoad;
    pendingLoad = chromeApi.storage.local.get(PENDING_SETTINGS_LOCAL_KEY).then((stored) => {
      const value = recordFrom(stored[PENDING_SETTINGS_LOCAL_KEY]);
      if (typeof value?.subject === "string" && typeof value.payload === "string") {
        pendingSubject = value.subject;
        pendingSettings = JSON.parse(value.payload);
      }
    }).catch(() => undefined);
    return pendingLoad;
  }

  async function persistPending(subject: string, settings: unknown) {
    pendingSubject = subject;
    pendingSettings = settings;
    await chromeApi.storage.local.set({
      [PENDING_SETTINGS_LOCAL_KEY]: { subject, payload: JSON.stringify(settings) } satisfies PendingSettingsRecord,
    });
  }

  async function clearPending() {
    pendingSubject = null;
    pendingSettings = undefined;
    await chromeApi.storage.local.remove(PENDING_SETTINGS_LOCAL_KEY);
  }

  async function rememberCloud(subject: string, envelope: SettingsEnvelope) {
    const parsed = validSettingsPayload(envelope.payload);
    if (!parsed) throw new Error("Cloud settings payload was invalid.");
    if (new TextEncoder().encode(envelope.payload).byteLength > MAX_SETTINGS_PAYLOAD_BYTES) {
      throw new Error("Cloud settings exceed Chrome sync storage quota.");
    }
    applyingCloud = true;
    try {
      await chromeApi.storage.sync.set({ cmdkSettings: parsed });
    } finally {
      applyingCloud = false;
    }
    await chromeApi.storage.local.set({
      [CLOUD_SETTINGS_LOCAL_KEY]: {
        subject,
        revision: envelope.revision,
        updatedAt: envelope.updatedAt,
      } satisfies CloudSettingsRecord,
    });
    activeSubject = subject;
    activeRevision = envelope.revision;
    return parsed;
  }

  async function pull() {
    await loadPending();
    const generation = ++operationGeneration;
    const local = await localSettings();
    const response = await sendOffscreenMessage({ action: "extensionSettingsOffscreenGet" });
    if (generation !== operationGeneration) return { settings: local.settings, revision: local.metadata?.revision ?? null, source: "local" as const };
    const record = recordFrom(response);
    if (record?.success !== true) {
      return { settings: local.settings, revision: local.metadata?.revision ?? null, source: "local" as const };
    }
    const envelope = validEnvelope(record.value);
    const valueRecord = recordFrom(record.value);
    const subject = envelope?.subject ?? (typeof valueRecord?.subject === "string" ? valueRecord.subject : undefined);
    if (!subject) {
      if (valueRecord && valueRecord.subject === null) {
        if (activeSubject === null && !local.metadata) {
          initialized = false;
          return { settings: local.settings, revision: null, source: "local" as const };
        }
        applyingCloud = true;
        try {
          await chromeApi.storage.sync.set({ cmdkSettings: structuredCloneSettings(DEFAULT_SETTINGS) });
        } finally {
          applyingCloud = false;
        }
        await chromeApi.storage.local.remove(CLOUD_SETTINGS_LOCAL_KEY);
        activeSubject = null;
        activeRevision = null;
        initialized = false;
        return { settings: structuredCloneSettings(DEFAULT_SETTINGS), revision: null, source: "cloud" as const };
      }
      return { settings: local.settings, revision: local.metadata?.revision ?? null, source: "local" as const };
    }
    if (pendingSubject && pendingSubject !== subject) await clearPending();
    if (!envelope) {
      // A new account must not inherit another account's local settings. The
      // caller can use defaults and the next save creates the cloud record.
      const switchingAccount = activeSubject !== null && activeSubject !== subject;
      if (switchingAccount) {
        await clearPending();
        applyingCloud = true;
        try {
          await chromeApi.storage.sync.set({ cmdkSettings: structuredCloneSettings(DEFAULT_SETTINGS) });
        } finally {
          applyingCloud = false;
        }
        await chromeApi.storage.local.remove(CLOUD_SETTINGS_LOCAL_KEY);
        activeSubject = subject;
        activeRevision = null;
        initialized = true;
        return { settings: null, revision: null, source: "cloud" as const };
      }
      if (local.metadata?.subject !== subject) {
        if (local.metadata?.subject) {
          pendingSettings = undefined;
          pendingSubject = null;
          await chromeApi.storage.local.remove(PENDING_SETTINGS_LOCAL_KEY);
          applyingCloud = true;
          try {
            await chromeApi.storage.sync.set({ cmdkSettings: structuredCloneSettings(DEFAULT_SETTINGS) });
          } finally {
            applyingCloud = false;
          }
          await chromeApi.storage.local.remove(CLOUD_SETTINGS_LOCAL_KEY);
          activeSubject = subject;
          activeRevision = null;
          initialized = true;
          return { settings: null, revision: null, source: "cloud" as const };
        }
        activeSubject = subject;
        activeRevision = null;
        initialized = true;
        if (pendingSubject !== subject) {
          pendingSettings = undefined;
        }
        const settingsToMigrate = pendingSubject === subject && pendingSettings !== undefined
          ? pendingSettings
          : local.settings;
        if (settingsToMigrate !== undefined) {
          try {
            await push(settingsToMigrate, subject);
            return { settings: settingsToMigrate, revision: activeRevision, source: "local" as const };
          } catch {
            // The local value remains usable when the first cloud migration is offline.
          }
        }
        return { settings: local.settings, revision: null, source: "local" as const };
      }
      activeSubject = subject;
      activeRevision = null;
      initialized = true;
      return { settings: local.settings, revision: local.metadata?.revision ?? null, source: "local" as const };
    }
    if (pendingSubject === subject && pendingSettings !== undefined) {
      activeSubject = subject;
      activeRevision = envelope.revision;
      try {
        await push(pendingSettings);
        return { settings: pendingSettings, revision: activeRevision, source: "local" as const };
      } catch (error) {
        if (error instanceof Error && error.message.includes("SETTINGS_CONFLICT")) {
          await clearPending();
        } else {
          return { settings: local.settings, revision: local.metadata?.revision ?? null, source: "local" as const };
        }
      }
    }
    const settings = await rememberCloud(subject, envelope);
    initialized = true;
    return {
      settings,
      revision: envelope.revision,
      source: "cloud" as const,
    };
  }

  async function push(settings: unknown, expectedSubject = activeSubject) {
    if (!expectedSubject || expectedSubject !== activeSubject) {
      throw new Error("stale_extension_settings_subject");
    }
    const generation = operationGeneration;
    const payload = JSON.stringify(settings);
    if (typeof payload !== "string" || new TextEncoder().encode(payload).byteLength > MAX_SETTINGS_PAYLOAD_BYTES || !validSettingsPayload(payload)) {
      throw new Error("Invalid or oversized extension settings payload.");
    }
    const local = await localSettings();
    const response = await sendOffscreenMessage({
      action: "extensionSettingsOffscreenSave",
      payload,
      expectedRevision: activeSubject === expectedSubject
        ? activeRevision ?? (local.metadata?.subject === expectedSubject ? local.metadata.revision : null)
        : null,
      expectedSubject,
    });
    if (generation !== operationGeneration) throw new Error("stale_extension_settings_operation");
    const record = recordFrom(response);
    if (record?.success !== true) {
      throw new Error(typeof record?.error === "string" ? record.error : "Cloud settings save failed.");
    }
    const envelope = validEnvelope(record.value);
    if (!envelope?.subject || envelope.subject !== expectedSubject) {
      throw new Error("Cloud settings response was invalid.");
    }
    await rememberCloud(envelope.subject, envelope);
    if (pendingSubject === envelope.subject && JSON.stringify(pendingSettings) === payload) {
      await clearPending();
    }
    return { revision: envelope.revision };
  }

  function start() {
    const listener: Parameters<typeof chromeApi.storage.onChanged.addListener>[0] =
      (changes, areaName) => {
        if (areaName !== "sync" || applyingCloud || !initialized || !activeSubject) return;
        const next = changes.cmdkSettings?.newValue;
        if (next === undefined) return;
        const owner = activeSubject;
        if (!owner) return;
        syncQueue = syncQueue.then(async () => {
          if (!owner || owner !== activeSubject) return;
          await persistPending(owner, next);
          try {
            if (owner !== activeSubject) return;
            await push(next, owner);
          } catch (error) {
            // A stale revision means another computer won. Pulling here makes
            // the cloud value authoritative and prevents an overwrite loop.
            if (error instanceof Error && error.message.includes("SETTINGS_CONFLICT")) {
              await clearPending();
              await pull();
            }
          }
        });
      };
    chromeApi.storage.onChanged.addListener(listener);
    return () => chromeApi.storage.onChanged.removeListener(listener);
  }

  function handleMessage(
    rawMessage: unknown,
    sender: ExtensionMessageSender,
    sendResponse: (response?: unknown) => void,
  ) {
    const message = recordFrom(rawMessage);
    if (message?.action !== "extensionSettingsPull" && message?.action !== "extensionSettingsPush") return false;
    if (!isTrustedExtensionPageSender(sender, extensionId, ["/options.html", "/sidepanel.html", "/newtab.html"])) {
      sendResponse({ success: false, error: "unauthorized_extension_sender" });
      return true;
    }
    const operation = message.action === "extensionSettingsPull"
      ? pull()
      : push(message.settings);
    void operation.then((value) => sendResponse({ success: true, value }))
      .catch((error: unknown) => sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    return true;
  }

  return { handleMessage, pull, push, start };
}
