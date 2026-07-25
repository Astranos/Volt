import { useCallback, useEffect, useRef, useState } from "react";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";

import { api } from "../../../../convex/_generated/api";
import type { TimelineResult, WorkspaceSnapshot } from "./workspace";

export type WorkspaceState = {
  snapshot: WorkspaceSnapshot | null;
  /** True until the first server response arrives. */
  isLoading: boolean;
  /** A signed-in account that has never captured anything has no workspace. */
  isEmpty: boolean;
};

/**
 * `workspaceSnapshot` is the one workspace read that tolerates an account with
 * no workspace yet, so the dashboard subscribes to it and creates the
 * workspace lazily in the background.
 */
export function useWorkspace(): WorkspaceState {
  const { isAuthenticated } = useConvexAuth();
  const snapshot = useQuery(
    api.cloudWorkspace.workspaceSnapshot,
    isAuthenticated ? {} : "skip",
  );
  const ensureWorkspace = useMutation(api.cloudWorkspace.ensureWorkspace);
  const ensured = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || snapshot !== null || ensured.current) return;
    ensured.current = true;
    void ensureWorkspace({}).catch(() => {
      // A failed create just means the empty state stays up; the next render
      // of the dashboard retries on a fresh mount.
      ensured.current = false;
    });
  }, [ensureWorkspace, isAuthenticated, snapshot]);

  return {
    snapshot: snapshot ?? null,
    isLoading: !isAuthenticated || snapshot === undefined,
    isEmpty: snapshot === null || snapshot?.batches.length === 0,
  };
}

type PresignedPhoto = { url: string; expiresAt: number };

/**
 * Presigned R2 URLs live for five minutes. Caching them per result keeps a
 * scrolling grid from re-signing the same photo on every render, and the
 * expiry check keeps a long-lived tab from showing broken images.
 */
export function usePhotoUrls() {
  const createPhotoDownloadUrl = useAction(
    api.cloudWorkspace.createPhotoDownloadUrl,
  );
  const cache = useRef(new Map<string, PresignedPhoto>());
  const inFlight = useRef(new Map<string, Promise<string>>());

  return useCallback(
    (batchId: string, resultId: string, force = false): Promise<string> => {
      const key = `${batchId}/${resultId}`;
      if (force) cache.current.delete(key);
      const cached = cache.current.get(key);
      // Re-sign a little early so an image that starts loading right now is
      // not racing the expiry.
      if (cached && cached.expiresAt - Date.now() > 30_000) {
        return Promise.resolve(cached.url);
      }
      const pending = inFlight.current.get(key);
      if (pending) return pending;

      const request = createPhotoDownloadUrl({ batchId, resultId })
        .then((presigned) => {
          cache.current.set(key, {
            url: presigned.url,
            expiresAt: presigned.expiresAt,
          });
          return presigned.url;
        })
        .finally(() => {
          inFlight.current.delete(key);
        });
      inFlight.current.set(key, request);
      return request;
    },
    [createPhotoDownloadUrl],
  );
}

export type PhotoState = (
  | { status: "loading"; url: null }
  | { status: "ready"; url: string }
  | { status: "error"; url: null }
) & {
  /** Re-signs the photo. Used when a tab outlives the five-minute URL. */
  retry: () => void;
};

type PhotoResult = Omit<PhotoState, "retry">;

/** Resolves one photo's presigned URL, cancelling cleanly on unmount. */
export function usePhotoUrl(
  resolve: ReturnType<typeof usePhotoUrls>,
  batchId: string | null,
  resultId: string | null,
): PhotoState {
  const [result, setResult] = useState<PhotoResult>({
    status: "loading",
    url: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!batchId || !resultId) return;
    let active = true;
    setResult({ status: "loading", url: null });
    resolve(batchId, resultId, attempt > 0)
      .then((url) => {
        if (active) setResult({ status: "ready", url });
      })
      .catch(() => {
        if (active) setResult({ status: "error", url: null });
      });
    return () => {
      active = false;
    };
  }, [attempt, batchId, resolve, resultId]);

  // Only a URL that already worked is worth re-signing. Refusing to retry from
  // the error state is what stops a genuinely broken object from looping.
  const status = useRef(result.status);
  status.current = result.status;
  const retry = useCallback(() => {
    if (status.current === "ready") setAttempt((current) => current + 1);
  }, []);

  return { ...result, retry } as PhotoState;
}

/**
 * Deletes are soft on the server, so the dashboard offers restore rather than
 * a confirmation dialog. Both calls are capped at 500 ids per request.
 */
export function useResultActions() {
  const deleteResults = useMutation(api.cloudWorkspace.deleteWorkspaceResults);
  const restoreResults = useMutation(
    api.cloudWorkspace.restoreWorkspaceResults,
  );

  const remove = useCallback(
    (results: Pick<TimelineResult, "id">[]) =>
      deleteResults({ resultIds: results.map((result) => result.id) }),
    [deleteResults],
  );

  const restore = useCallback(
    (results: Pick<TimelineResult, "id">[]) =>
      restoreResults({ resultIds: results.map((result) => result.id) }),
    [restoreResults],
  );

  return { remove, restore };
}

/** Copies text and reports success long enough to show a confirmation. */
export function useCopy(resetAfterMs = 1600) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (copiedKey === null) return;
    const timer = setTimeout(() => setCopiedKey(null), resetAfterMs);
    return () => clearTimeout(timer);
  }, [copiedKey, resetAfterMs]);

  const copy = useCallback(async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
    } catch {
      setCopiedKey(null);
    }
  }, []);

  return { copiedKey, copy };
}
