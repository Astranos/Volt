import { chromeLocalKeyValueStorage, createWorkspaceStore } from "./workspace-store.ts";
import { hydrateWorkspaceReplica, resetWorkspaceHydration } from "./workspace-hydration.ts";
import { normalizeWorkspaceSnapshot } from "./workspace-snapshot.ts";

export const ACTIVE_WORKSPACE_KEY = "volt.cloudScanner.activeWorkspace.v1";
const ACTIVE_CLERK_SUBJECT_KEY = "volt.cloudScanner.activeClerkSubject.v1";

const WORKSPACE_SYNC_LOCK = "volt.cloudScanner.workspaceSync";

export type WorkspacePhotoDownload = {
  url: string;
  headers: Record<string, string>;
  expiresAt?: number;
};

export type WorkspaceSyncOptions = {
  chromeApi: typeof chrome;
  getPhotoDownload: (batchId: string, resultId: string) => Promise<WorkspacePhotoDownload>;
};

let fallbackQueue = Promise.resolve();

// The sidepanel and the service worker both apply snapshots, and applying one is
// a read-modify-write over chrome.storage — interleaving two of them drops
// results. Web Locks are shared across every context of the chrome-extension://
// origin, which is the only primitive both sides can agree on.
async function withWorkspaceSyncLock<T>(operation: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return await navigator.locks.request(WORKSPACE_SYNC_LOCK, operation);
  }
  const result = fallbackQueue.then(operation);
  fallbackQueue = result.then(() => undefined, () => undefined);
  return await result;
}

export function createWorkspaceSync(options: WorkspaceSyncOptions) {
  const store = createWorkspaceStore(chromeLocalKeyValueStorage(options.chromeApi));

  async function resetActiveHistoryNow(isCurrent: () => boolean = () => true) {
    if (!isCurrent()) return;
    await resetWorkspaceHydration(isCurrent);
    if (!isCurrent()) return;
    await options.chromeApi.storage.local.remove(ACTIVE_WORKSPACE_KEY);
    if (!isCurrent()) return;
    void options.chromeApi.runtime.sendMessage({ action: "workspaceReplicaChanged" }).catch(() => undefined);
  }

  async function activateWorkspace(workspaceId: string, isCurrent: () => boolean) {
    const stored = await options.chromeApi.storage.local.get(ACTIVE_WORKSPACE_KEY);
    if (!isCurrent()) return;
    const activeWorkspaceId = stored[ACTIVE_WORKSPACE_KEY];
    if (typeof activeWorkspaceId === "string" && activeWorkspaceId !== workspaceId) {
      await resetActiveHistoryNow(isCurrent);
    }
    if (!isCurrent()) return;
    await options.chromeApi.storage.local.set({ [ACTIVE_WORKSPACE_KEY]: workspaceId });
  }

  async function applySnapshotNow(payload: unknown, isCurrent: () => boolean) {
    // An account with no workspace yet reads as null rather than as a failure.
    // There is nothing to merge, and nothing to clear either: the account has
    // never held cloud results for this replica to have gone stale against.
    if (payload === null || !isCurrent()) return null;
    const page = normalizeWorkspaceSnapshot(payload);
    if (!page) throw new Error("Workspace snapshot was invalid.");
    await activateWorkspace(page.workspaceId, isCurrent);
    if (!isCurrent()) return null;
    const replica = await store.mergePage(page, isCurrent);
    if (!replica || !isCurrent()) return null;
    // A hydration failure must not be silent — the panel names it — but the rows
    // that did land still belong in the timeline, so the broadcast happens
    // either way and the error is raised after it.
    let hydrationError: Error | null = null;
    try {
      await hydrateWorkspaceReplica(replica, { getPhotoDownload: options.getPhotoDownload, isCurrent });
    } catch (error) {
      hydrationError = error instanceof Error ? error : new Error(String(error));
    }
    if (!isCurrent()) return null;
    void options.chromeApi.runtime.sendMessage({
      action: "workspaceReplicaChanged",
      workspaceId: replica.workspaceId,
    }).catch(() => undefined);
    if (hydrationError) throw hydrationError;
    return replica;
  }

  return {
    checkAccountOwnership: (subject: string, { isCurrent = () => true }: { isCurrent?: () => boolean } = {}) =>
      withWorkspaceSyncLock(async () => {
        if (!isCurrent()) return false;
        const stored = await options.chromeApi.storage.local.get(ACTIVE_CLERK_SUBJECT_KEY);
        if (!isCurrent()) return false;
        if (stored[ACTIVE_CLERK_SUBJECT_KEY] === subject) return true;
        await resetActiveHistoryNow(isCurrent);
        return false;
      }),
    bindAccount: (subject: string | null, { isCurrent = () => true }: { isCurrent?: () => boolean } = {}) =>
      withWorkspaceSyncLock(async () => {
        if (!isCurrent()) return;
        const stored = await options.chromeApi.storage.local.get(ACTIVE_CLERK_SUBJECT_KEY);
        if (!isCurrent()) return;
        if (typeof stored[ACTIVE_CLERK_SUBJECT_KEY] !== "string" || stored[ACTIVE_CLERK_SUBJECT_KEY] !== subject) {
          await resetActiveHistoryNow(isCurrent);
        }
        if (!isCurrent()) return;
        if (subject === null) await options.chromeApi.storage.local.remove(ACTIVE_CLERK_SUBJECT_KEY);
        else await options.chromeApi.storage.local.set({ [ACTIVE_CLERK_SUBJECT_KEY]: subject });
      }),
    applySnapshot: (payload: unknown, { subject, isCurrent = () => true }: { subject: string | null; isCurrent?: () => boolean }) =>
      withWorkspaceSyncLock(async () => {
        if (!subject || !isCurrent()) return null;
        const stored = await options.chromeApi.storage.local.get(ACTIVE_CLERK_SUBJECT_KEY);
        if (!isCurrent() || stored[ACTIVE_CLERK_SUBJECT_KEY] !== subject) return null;
        return applySnapshotNow(payload, isCurrent);
      }),
    // Account switches must not interleave with an in-flight apply either, so
    // they run under the same lock and are handed the reset from inside it —
    // the lock is not reentrant, so they cannot take it a second time.
    runExclusive: <T>(
      operation: (sync: { resetActiveHistory: () => Promise<void> }) => Promise<T>,
    ) => withWorkspaceSyncLock(() => operation({ resetActiveHistory: resetActiveHistoryNow })),
  };
}
