import { afterEach, expect, test, vi } from "vitest";
import { createWorkspaceSync } from "./workspace-sync.ts";
import { clearMobileScannerResultsStore } from "../domain/mobile-scanner-results.ts";

vi.mock("../domain/mobile-scanner-results.ts", () => ({
  clearMobileScannerResultsStore: vi.fn(async () => {}),
  deleteMobileScannerResults: vi.fn(async () => {}),
  listMobileScannerResults: vi.fn(async () => []),
  saveMobileScannerPhoto: vi.fn(async () => {}),
  saveMobileScannerScan: vi.fn(async () => {}),
}));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const ownerKey = "volt.cloudScanner.activeClerkSubject.v1";

function setup(owner) {
  const storage = { [ownerKey]: owner, "volt.cloudScanner.activeWorkspace.v1": "old-workspace" };
  const chromeApi = {
    storage: { local: {
      get: async (key) => ({ [key]: storage[key] }),
      set: async (values) => Object.assign(storage, values),
      remove: async (key) => { delete storage[key]; },
    } },
    runtime: { sendMessage: vi.fn(async () => {}) },
  };
  vi.stubGlobal("chrome", chromeApi);
  return { storage, chromeApi, sync: createWorkspaceSync({ chromeApi, getPhotoDownload: async () => ({ url: "", headers: {} }) }) };
}

test.each([null, "bob"])("cold runtime clears persisted Alice history before a %s null snapshot", async subject => {
  const { storage, sync } = setup("alice");
  await sync.bindAccount(subject);
  await sync.applySnapshot(null, { subject });
  expect(clearMobileScannerResultsStore).toHaveBeenCalledOnce();
  expect(storage["volt.cloudScanner.activeWorkspace.v1"]).toBeUndefined();
});

test("same-account cold startup and null snapshot preserve legitimate cached history", async () => {
  const { storage, sync } = setup("alice");
  await sync.bindAccount("alice");
  await sync.applySnapshot(null, { subject: "alice" });
  expect(clearMobileScannerResultsStore).not.toHaveBeenCalled();
  expect(storage[ownerKey]).toBe("alice");
  expect(storage["volt.cloudScanner.activeWorkspace.v1"]).toBe("old-workspace");
});

test("invalidated binding cannot reset history or claim account ownership", async () => {
  const { storage, sync } = setup("alice");
  await sync.bindAccount("bob", { isCurrent: () => false });
  expect(clearMobileScannerResultsStore).not.toHaveBeenCalled();
  expect(storage[ownerKey]).toBe("alice");
});

test("offline same-account cache is readable without claiming a different account", async () => {
  const { storage, sync } = setup("alice");
  expect(await sync.checkAccountOwnership("alice")).toBe(true);
  expect(clearMobileScannerResultsStore).not.toHaveBeenCalled();
  expect(await sync.checkAccountOwnership("bob")).toBe(false);
  expect(clearMobileScannerResultsStore).toHaveBeenCalledOnce();
  expect(storage[ownerKey]).toBe("alice");
});

test("a stale writer in another context cannot reactivate the previous account", async () => {
  const { storage, chromeApi, sync: background } = setup("alice");
  const panel = createWorkspaceSync({ chromeApi, getPhotoDownload: async () => ({ url: "", headers: {} }) });
  await background.bindAccount("alice");
  await panel.bindAccount("bob");
  const before = structuredClone(storage);
  chromeApi.runtime.sendMessage.mockClear();
  expect(await background.applySnapshot({ workspaceId: "alice-workspace", revision: 1, batches: [] }, { subject: "alice" })).toBeNull();
  expect(storage).toEqual(before);
  expect(chromeApi.runtime.sendMessage).not.toHaveBeenCalled();
  expect(await panel.applySnapshot({ workspaceId: "bob-workspace", revision: 1, batches: [] }, { subject: "bob" })).not.toBeNull();
  expect(storage["volt.cloudScanner.activeWorkspace.v1"]).toBe("bob-workspace");
});
