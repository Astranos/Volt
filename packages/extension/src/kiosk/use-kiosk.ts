import { useCallback, useEffect, useRef, useState } from "react";
import { fetchKioskQueue, KIOSK_STORE_KEY, normalizeKioskStore, setKioskRequestStatus, type KioskRequest } from "./kiosk-requests";

const POLL_MS = 3_000;

/** The kiosk store chosen in settings (chrome.storage.sync), or null when the feature is off. */
export function useKioskStore(): [string | null, (store: string | null) => Promise<void>] {
  const [store, setStore] = useState<string | null>(null);
  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage) return;
    let active = true;
    void chrome.storage.sync.get(KIOSK_STORE_KEY).then((stored) => {
      if (active) setStore(normalizeKioskStore(String(stored[KIOSK_STORE_KEY] ?? "")));
    }).catch(() => undefined);
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === "sync" && changes[KIOSK_STORE_KEY]) setStore(normalizeKioskStore(String(changes[KIOSK_STORE_KEY].newValue ?? "")));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);
  const save = useCallback(async (next: string | null) => {
    setStore(next);
    if (next) await chrome.storage.sync.set({ [KIOSK_STORE_KEY]: next });
    else await chrome.storage.sync.remove(KIOSK_STORE_KEY);
  }, []);
  return [store, save];
}

export type KioskQueueState = {
  requests: KioskRequest[];
  /** Server clock minus this computer's, so waiting times match the kiosk. */
  clockOffset: number;
  error: string | null;
  update: (request: KioskRequest, status: "found" | "shown") => void;
};

type Pending = { status: "found" | "shown"; token: number };

/** The store's live request queue, polled like the staff page while this page is visible. */
export function useKioskQueue(store: string | null): KioskQueueState {
  const [requests, setRequests] = useState<KioskRequest[]>([]);
  const [clockOffset, setClockOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Bumped when the store changes, so late callbacks from the old store do nothing.
  const generation = useRef(0);
  // Status changes not yet confirmed, applied over every poll; the token lets
  // only the newest change for a request roll itself back or clear itself.
  const pending = useRef(new Map<string, Pending>());
  // Bumped on every change, so a poll that started before one is discarded.
  const changes = useRef(0);
  const nextToken = useRef(0);

  useEffect(() => {
    const run = ++generation.current;
    const current = () => run === generation.current;
    pending.current = new Map();
    setRequests([]);
    setError(null);
    if (!store) return;
    let timer: number | undefined;
    let polling = false;
    const poll = async () => {
      window.clearTimeout(timer);
      if (polling) return;
      if (document.visibilityState === "visible") {
        polling = true;
        const startedAt = changes.current;
        try {
          const queue = await fetchKioskQueue(store);
          // A Found/Shown made while this was in flight may not be in it yet.
          if (current() && startedAt === changes.current) {
            setClockOffset(queue.serverNow - Date.now());
            setRequests(queue.requests
              .filter((item) => pending.current.get(item.id)?.status !== "shown")
              .map((item) => pending.current.get(item.id)?.status === "found" ? { ...item, status: "found" } : item));
            setError(null);
          }
        } catch (cause) {
          if (current()) setError(cause instanceof Error ? cause.message : "Kiosk requests are unavailable.");
        } finally {
          polling = false;
        }
      }
      if (current()) timer = window.setTimeout(() => void poll(), POLL_MS);
    };
    const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      generation.current++;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [store]);

  const update = useCallback((request: KioskRequest, status: "found" | "shown") => {
    if (!store) return;
    const run = generation.current;
    const token = ++nextToken.current;
    changes.current++;
    pending.current.set(request.id, { status, token });
    setRequests((current) => status === "shown"
      ? current.filter((item) => item.id !== request.id)
      : current.map((item) => item.id === request.id ? { ...item, status } : item));
    const newest = () => run === generation.current && pending.current.get(request.id)?.token === token;
    void setKioskRequestStatus(store, request.id, status)
      .then(() => {
        if (newest()) pending.current.delete(request.id);
      })
      .catch((cause: unknown) => {
        // Only the newest change for this request, in this store, may undo itself.
        if (!newest()) return;
        pending.current.delete(request.id);
        setError(cause instanceof Error ? cause.message : "Could not update the request.");
        setRequests((current) => [...current.filter((item) => item.id !== request.id), request].sort((a, b) => a.createdAt - b.createdAt));
      })
      .finally(() => { changes.current++; });
  }, [store]);

  return { requests, clockOffset, error, update };
}
