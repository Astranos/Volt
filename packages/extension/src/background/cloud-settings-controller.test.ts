import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createCloudSettingsController } from "./cloud-settings-controller";

const extensionId = "settings-test-extension";

function chromeStub(initialSettings: unknown) {
  const syncState: Record<string, unknown> = { cmdkSettings: initialSettings };
  const localState: Record<string, unknown> = {};
  type Change = { oldValue?: unknown; newValue?: unknown };
  const listeners: Array<(changes: Record<string, Change>, area: string) => void> = [];
  const chromeApi = {
    runtime: { id: extensionId },
    storage: {
      sync: {
        get: vi.fn(async (key: string) => ({ [key]: syncState[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          const changes: Record<string, Change> = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = { oldValue: syncState[key], newValue: value };
            syncState[key] = value;
          }
          for (const listener of listeners) listener(changes, "sync");
        }),
      },
      onChanged: { addListener: (listener: typeof listeners[number]) => listeners.push(listener), removeListener: vi.fn() },
      local: {
        get: vi.fn(async (key: string) => ({ [key]: localState[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(localState, values)),
        remove: vi.fn(async (key: string) => { delete localState[key]; }),
      },
    },
  } as unknown as typeof chrome;
  return { chromeApi, syncState, localState };
}

const sender = { id: extensionId, url: `chrome-extension://${extensionId}/options.html` };

describe("cloud settings transport", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  test("preserves anonymous settings when startup is signed out with no cloud binding", async () => {
    const localSettings = { contextMenu: { enabled: false } };
    const { chromeApi, syncState } = chromeStub(localSettings);
    const controller = createCloudSettingsController({
      chromeApi,
      extensionId,
      sendOffscreenMessage: async () => ({ success: true, value: { value: null, subject: null } }),
    });
    controller.start();
    await controller.pull();
    expect(syncState.cmdkSettings).toEqual(localSettings);
  });

  test("retries an offline local edit before a periodic cloud pull can replace it", async () => {
    const initial = { contextMenu: { enabled: true } };
    const edited = { contextMenu: { enabled: false } };
    const { chromeApi, syncState } = chromeStub(initial);
    let online = false;
    let saveAttempts = 0;
    const controller = createCloudSettingsController({
      chromeApi,
      extensionId,
      sendOffscreenMessage: async (message) => {
        if (!online) throw new Error("offline");
        if ((message as { action?: string }).action === "extensionSettingsOffscreenGet") {
          return { success: true, value: { payload: JSON.stringify(initial), revision: 1, updatedAt: 1, subject: "alice" } };
        }
        saveAttempts += 1;
        return { success: true, value: { payload: JSON.stringify(edited), revision: 2, updatedAt: 2, subject: "alice" } };
      },
    });
    controller.start();
    online = true;
    await controller.pull();
    online = false;
    await chromeApi.storage.sync.set({ cmdkSettings: edited });
    await Promise.resolve();
    online = true;
    await controller.pull();
    expect(saveAttempts).toBeGreaterThan(0);
    expect(syncState.cmdkSettings).toEqual(edited);
  });

  test("does not migrate account A cache into account B after a worker restart", async () => {
    const aSettings = { contextMenu: { enabled: false } };
    const { chromeApi, syncState } = chromeStub(aSettings);
    let subject = "alice";
    const send = async (message: unknown) => {
      const action = (message as { action?: string }).action;
      if (action === "extensionSettingsOffscreenGet") {
        return {
          success: true,
          value: subject === "alice"
            ? { payload: JSON.stringify(aSettings), revision: 7, updatedAt: 7, subject }
            : { value: null, subject },
        };
      }
      throw new Error("unexpected save");
    };
    const first = createCloudSettingsController({ chromeApi, extensionId, sendOffscreenMessage: send });
    await first.pull();
    subject = "bob";
    const restarted = createCloudSettingsController({ chromeApi, extensionId, sendOffscreenMessage: send });
    await restarted.pull();
    expect(syncState.cmdkSettings).not.toEqual(aSettings);
  });

  test("does not send an A edit as a B save during an account switch", async () => {
    const initial = { contextMenu: { enabled: true } };
    const edited = { contextMenu: { enabled: false } };
    const { chromeApi } = chromeStub(initial);
    let subject = "alice";
    const saves: Array<{ expectedSubject: string; payload: string }> = [];
    const controller = createCloudSettingsController({
      chromeApi,
      extensionId,
      sendOffscreenMessage: async (message) => {
        const request = message as { action: string; expectedSubject?: string; payload?: string };
        if (request.action === "extensionSettingsOffscreenGet") {
          return { success: true, value: subject === "alice"
            ? { payload: JSON.stringify(initial), revision: 1, updatedAt: 1, subject }
            : { value: null, subject } };
        }
        saves.push({ expectedSubject: request.expectedSubject ?? "", payload: request.payload ?? "" });
        return { success: false, error: "stale_extension_settings_subject" };
      },
    });
    controller.start();
    await controller.pull();
    await chromeApi.storage.sync.set({ cmdkSettings: edited });
    subject = "bob";
    await controller.pull();
    await Promise.resolve();
    expect(saves.every((save) => save.expectedSubject !== "bob" || save.payload !== JSON.stringify(edited))).toBe(true);
  });
});
