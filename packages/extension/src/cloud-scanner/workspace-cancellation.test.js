import { afterEach, expect, test, vi } from "vitest";
import { createWorkspaceSync } from "./workspace-sync.ts";
import { createWorkspaceStore } from "./workspace-store.ts";
import { saveMobileScannerPhoto } from "../domain/mobile-scanner-results.ts";

vi.mock("../domain/mobile-scanner-results.ts", () => ({
  clearMobileScannerResultsStore: vi.fn(async () => {}),
  deleteMobileScannerResults: vi.fn(async () => {}),
  listMobileScannerResults: vi.fn(async () => []),
  saveMobileScannerPhoto: vi.fn(async () => {}),
  saveMobileScannerScan: vi.fn(async () => {}),
}));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test.each(["download URL", "photo blob"])("account switch during deferred %s suppresses hydration writes and broadcast", async (phase) => {
  const started = deferred();
  const delayed = deferred();
  const writes = [];
  const chromeApi = {
    storage: { local: {
      get: vi.fn(async () => ({ "volt.cloudScanner.activeClerkSubject.v1": "account-a" })),
      set: vi.fn(async (value) => { writes.push(value); }),
      remove: vi.fn(async () => {}),
    } },
    runtime: { sendMessage: vi.fn(async () => {}) },
  };
  vi.stubGlobal("chrome", chromeApi);
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    blob: async () => {
      if (phase === "photo blob") { started.resolve(); await delayed.promise; }
      return new Blob(["photo"], { type: "image/jpeg" });
    },
  })));
  const sync = createWorkspaceSync({
    chromeApi,
    getPhotoDownload: async () => {
      if (phase === "download URL") { started.resolve(); await delayed.promise; }
      return { url: "https://example.test/photo", headers: {} };
    },
  });
  let current = true;
  const applying = sync.applySnapshot({
    workspaceId: "account-a",
    revision: 1,
    batches: [{
      id: "batch-a", deliveryState: "ready",
      createdAt: "2026-07-12T12:00:00.000Z", updatedAt: "2026-07-12T12:00:00.000Z",
      results: [{ id: "photo-a", type: "photo", createdAt: "2026-07-12T12:00:00.000Z" }],
    }],
  }, { subject: "account-a", isCurrent: () => current });
  await started.promise;
  current = false;
  const writesAtSwitch = writes.length;
  delayed.resolve();
  expect(await applying).toBeNull();
  expect(saveMobileScannerPhoto).not.toHaveBeenCalled();
  expect(writes).toHaveLength(writesAtSwitch);
  expect(chromeApi.runtime.sendMessage).not.toHaveBeenCalled();
});

test("store does not persist a merge invalidated while reading", async () => {
  const reading = deferred();
  const storage = { get: () => reading.promise, set: vi.fn(async () => {}) };
  const store = createWorkspaceStore(storage);
  let current = true;
  const merging = store.mergePage({ workspaceId: "account-a", batches: [] }, () => current);
  current = false;
  reading.resolve(null);
  expect(await merging).toBeNull();
  expect(storage.set).not.toHaveBeenCalled();
});

test("photos hydrate a few at a time after scans, reporting progress before the snapshot finishes", async () => {
  const { saveMobileScannerScan } = await import("../domain/mobile-scanner-results.ts");
  const chromeApi = {
    storage: { local: {
      get: vi.fn(async () => ({ "volt.cloudScanner.activeClerkSubject.v1": "account-a" })),
      set: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    } },
    runtime: { sendMessage: vi.fn(async () => {}) },
  };
  vi.stubGlobal("chrome", chromeApi);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, blob: async () => new Blob(["photo"], { type: "image/jpeg" }) })));
  let inFlight = 0;
  let maxInFlight = 0;
  const onProgress = vi.fn();
  const sync = createWorkspaceSync({
    chromeApi,
    onProgress,
    getPhotoDownload: async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((done) => setTimeout(done, 5));
      inFlight -= 1;
      return { url: "https://example.test/photo", headers: {} };
    },
  });
  const createdAt = "2026-07-12T12:00:00.000Z";
  await sync.applySnapshot({
    workspaceId: "account-a",
    revision: 1,
    batches: [{
      id: "batch-a", deliveryState: "ready", createdAt, updatedAt: createdAt,
      results: [
        ...Array.from({ length: 10 }, (_, index) => ({ id: `photo-${index}`, type: "photo", createdAt })),
        { id: "text-a", type: "text", value: "hello", createdAt },
      ],
    }],
  }, { subject: "account-a" });
  expect(maxInFlight).toBeGreaterThan(1);
  expect(maxInFlight).toBeLessThanOrEqual(6);
  expect(saveMobileScannerPhoto).toHaveBeenCalledTimes(10);
  expect(vi.mocked(saveMobileScannerScan).mock.invocationCallOrder[0])
    .toBeLessThan(vi.mocked(saveMobileScannerPhoto).mock.invocationCallOrder[0]);
  expect(onProgress).toHaveBeenCalled();
  expect(onProgress.mock.invocationCallOrder[0])
    .toBeLessThan(vi.mocked(saveMobileScannerPhoto).mock.invocationCallOrder.at(-1));
});
