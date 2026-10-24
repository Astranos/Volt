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

/** The store's live request queue, polled like the staff page while this page is visible. */
export function useKioskQueue(store: string | null): KioskQueueState {
  const [requests, setRequests] = useState<KioskRequest[]>([]);
  const [clockOffset, setClockOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Status changes in flight, so a poll that started earlier can't undo them on screen.
  const pending = useRef(new Map<string, "found" | "shown">());

  useEffect(() => {
    setRequests([]);
    setError(null);
    if (!store) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "visible") {
        try {
          const queue = await fetchKioskQueue(store);
          if (cancelled) return;
          setClockOffset(queue.serverNow - Date.now());
          setRequests(queue.requests
            .filter((item) => pending.current.get(item.id) !== "shown")
            .map((item) => pending.current.get(item.id) === "found" ? { ...item, status: "found" } : item));
          setError(null);
        } catch (cause) {
          if (!cancelled) setError(cause instanceof Error ? cause.message : "Kiosk requests are unavailable.");
        }
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), POLL_MS);
    };
    const onVisible = () => { if (document.visibilityState === "visible") void poll(); };
    void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [store]);

  const update = useCallback((request: KioskRequest, status: "found" | "shown") => {
    if (!store) return;
    pending.current.set(request.id, status);
    setRequests((current) => status === "shown"
      ? current.filter((item) => item.id !== request.id)
      : current.map((item) => item.id === request.id ? { ...item, status } : item));
    void setKioskRequestStatus(store, request.id, status)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not update the request.");
        // Put it back as it was; the next poll confirms the real state.
        setRequests((current) => [...current.filter((item) => item.id !== request.id), request].sort((a, b) => a.createdAt - b.createdAt));
      })
      .finally(() => { pending.current.delete(request.id); });
  }, [store]);

  return { requests, clockOffset, error, update };
}
