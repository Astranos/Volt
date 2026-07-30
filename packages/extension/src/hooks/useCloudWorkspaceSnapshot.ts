import { useEffect, useState, useSyncExternalStore } from "react";
import { useConvex, useConvexAuth, useQuery_experimental, type ConvexReactClient } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { createWorkspaceSync } from "../cloud-scanner/workspace-sync";
import { useSidepanelSignedIn } from "../components/access/ExtensionAccess";
import { cloudWorkspaceErrorMessage } from "../domain/cloud-workspace-error";

export type CloudWorkspaceSnapshotState = {
  status: "loading" | "ready" | "error";
  error: string | null;
  version: number;
};

// Convex can hand the panel a token-refusal that never resolves into anything
// visible; give the handshake room to finish before calling it a failure.
const AUTH_GRACE_MS = 5000;

// One sync per document, and one record of what it already applied: React can
// mount this hook twice (strict mode) and re-render it many more times, and
// every extra apply re-downloads photos for nothing.
let workspaceSync: ReturnType<typeof createWorkspaceSync> | null = null;
let activeClient: ConvexReactClient | null = null;

// The apply bookkeeping lives outside React because MobileScanner unmounts
// whenever the panel switches tools. Component state would forget an in-flight
// apply on unmount while the "already applied" marker remembered it, and the
// remounted panel would then wait forever for a version bump that never comes:
// this document's own runtime.sendMessage broadcast is not delivered back to it.
const NOTHING_APPLIED = Symbol("volt.cloudWorkspace.nothingApplied");
let appliedSnapshot: unknown = NOTHING_APPLIED;
let hydratedFromCloud = false;
let applyState: { version: number; error: string | null } = { version: 0, error: null };
const applyListeners = new Set<() => void>();

function publishApplyState(next: { version: number; error: string | null }) {
  applyState = next;
  for (const listener of applyListeners) listener();
}

function subscribeToApplyState(listener: () => void) {
  applyListeners.add(listener);
  return () => {
    applyListeners.delete(listener);
  };
}

function readApplyState() {
  return applyState;
}

function sharedWorkspaceSync() {
  if (!workspaceSync) {
    workspaceSync = createWorkspaceSync({
      chromeApi: chrome,
      getPhotoDownload: async (batchId, resultId) => {
        if (!activeClient) throw new Error("Convex client is not ready.");
        const download = await activeClient.action(api.cloudWorkspace.createPhotoDownloadUrl, {
          batchId,
          resultId,
        });
        return {
          url: download.url,
          headers: Object.fromEntries(
            Object.entries(download.headers).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          ),
          expiresAt: download.expiresAt,
        };
      },
    });
  }
  return workspaceSync;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function applySnapshotOnce(value: unknown) {
  if (value === appliedSnapshot) return;
  appliedSnapshot = value;
  hydratedFromCloud = true;
  void sharedWorkspaceSync().applySnapshot(value).then(
    () => publishApplyState({ version: applyState.version + 1, error: null }),
    (error: unknown) => {
      // Forget the snapshot so an unchanged one still gets another attempt.
      appliedSnapshot = NOTHING_APPLIED;
      publishApplyState({ version: applyState.version, error: errorMessage(error) });
    },
  );
}

// Signing out has to drop the previous account's cloud results even when the
// offscreen document — which owns the other reset path — never started.
function clearAppliedWorkspace() {
  if (!hydratedFromCloud) return;
  hydratedFromCloud = false;
  appliedSnapshot = NOTHING_APPLIED;
  void sharedWorkspaceSync()
    .runExclusive(({ resetActiveHistory }) => resetActiveHistory())
    .then(
      () => publishApplyState({ version: applyState.version + 1, error: null }),
      (error: unknown) =>
        publishApplyState({ version: applyState.version, error: errorMessage(error) }),
    );
}

/**
 * Subscribes the sidepanel to the cloud workspace itself. The service worker
 * keeps its own subscription for when the panel is closed; both merge into the
 * same local history, so the panel no longer goes empty when the offscreen
 * document fails to start.
 */
export function useCloudWorkspaceSnapshot(): CloudWorkspaceSnapshotState {
  const convex = useConvex();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const clerkSignedIn = useSidepanelSignedIn();
  // The positional useQuery rethrows query errors during render, which would
  // take the panel down every time Convex rejects the read. The object form
  // hands the error back so the panel can name it instead.
  const snapshot = useQuery_experimental({
    query: api.cloudWorkspace.workspaceSnapshot,
    args: isAuthenticated ? {} : "skip",
  });
  const applied = useSyncExternalStore(subscribeToApplyState, readApplyState);
  const [authRefused, setAuthRefused] = useState(false);

  useEffect(() => {
    activeClient = convex;
  }, [convex]);

  const value = snapshot.status === "success" ? snapshot.data : undefined;
  useEffect(() => {
    if (value === undefined) return;
    applySnapshotOnce(value);
  }, [value]);

  useEffect(() => {
    if (clerkSignedIn === false) clearAppliedWorkspace();
  }, [clerkSignedIn]);

  // Clerk says signed in but Convex never accepted the token: the query stays
  // skipped and the timeline stays empty with nothing to explain it. That
  // silence is exactly the failure this subscription exists to remove.
  const handshakeStalled = clerkSignedIn === true && !isLoading && !isAuthenticated;
  useEffect(() => {
    if (!handshakeStalled) {
      setAuthRefused(false);
      return;
    }
    const timer = setTimeout(() => setAuthRefused(true), AUTH_GRACE_MS);
    return () => clearTimeout(timer);
  }, [handshakeStalled]);

  const rawError = snapshot.status === "error"
    ? snapshot.error
    : applied.error
      ?? (authRefused
        ? "you are signed in, but the cloud workspace refused this session. Sign out and back in."
        : null);
  const error = rawError ? cloudWorkspaceErrorMessage(rawError) : null;
  return {
    status: error ? "error" : applied.version > 0 ? "ready" : "loading",
    error,
    version: applied.version,
  };
}
