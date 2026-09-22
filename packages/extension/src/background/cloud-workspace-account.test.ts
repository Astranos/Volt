import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { createCloudWorkspaceController } from "./cloud-workspace-controller";

const sync = vi.hoisted(() => ({ applySnapshot: vi.fn(async () => null), bindAccount: vi.fn(async () => {}), reset: vi.fn(async () => {}) }));
vi.mock("../cloud-scanner/workspace-sync.ts", () => ({
  createWorkspaceSync: () => ({ ...sync, runExclusive: async (operation: (value: { resetActiveHistory: () => Promise<void> }) => Promise<void>) => operation({ resetActiveHistory: sync.reset }) }),
}));
const id = "test-extension";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("chrome", { runtime: { id }, storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } } });
});
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  let epoch = "";
  const cursors = vi.fn(async () => {});
  const dictation = vi.fn(async () => {});
  const controller = createCloudWorkspaceController({ chromeApi: chrome, ensureOffscreenDocument: async () => true, handleCursorDeliveries: cursors, handleLiveDictationDrafts: dictation, sendOffscreenMessage: async (message) => {
    if (message && typeof message === "object" && "accountEpoch" in message && typeof message.accountEpoch === "string") epoch = message.accountEpoch;
    return { success: true };
  } });
  const send = (message: unknown) => new Promise(resolve => controller.handleMessage(message, { id, url: `chrome-extension://${id}/offscreen.html` }, resolve));
  await controller.handleAlarm();
  return { controller, send, epoch: () => epoch, cursors, dictation };
}

test("invalidating the account rejects late snapshots, cursor deliveries and dictation", async () => {
  const { controller, send, epoch, cursors, dictation } = await setup();
  const oldEpoch = epoch();
  await send({ action: "workspaceOffscreenAccountChanged", subject: "alice", accountEpoch: oldEpoch });
  await controller.handleAccountSessionChanged();
  for (const action of ["workspaceOffscreenSnapshotChanged", "workspaceOffscreenCursorDeliveriesChanged", "workspaceOffscreenDictationDraftsChanged"]) {
    await send({ action, subject: "alice", accountEpoch: oldEpoch, snapshot: { workspaceId: "alice" }, deliveries: [], drafts: [] });
  }
  expect(sync.applySnapshot).not.toHaveBeenCalled();
  expect(cursors).not.toHaveBeenCalled();
  expect(dictation).not.toHaveBeenCalled();
});

test("stale account confirmation cannot reopen admission before the current handshake", async () => {
  const { controller, send, epoch } = await setup();
  const oldEpoch = epoch();
  await send({ action: "workspaceOffscreenAccountChanged", subject: "alice", accountEpoch: oldEpoch });
  await controller.handleAccountSessionChanged();
  expect(await send({ action: "workspaceOffscreenAccountChanged", subject: "alice", accountEpoch: oldEpoch })).toMatchObject({ success: false });
  await send({ action: "workspaceOffscreenSnapshotChanged", subject: "alice", accountEpoch: epoch(), snapshot: {} });
  expect(sync.applySnapshot).not.toHaveBeenCalled();
  await send({ action: "workspaceOffscreenAccountChanged", subject: "bob", accountEpoch: epoch() });
  await send({ action: "workspaceOffscreenSnapshotChanged", subject: "bob", accountEpoch: epoch(), snapshot: { workspaceId: "bob" } });
  expect(sync.applySnapshot).toHaveBeenCalledOnce();
});
