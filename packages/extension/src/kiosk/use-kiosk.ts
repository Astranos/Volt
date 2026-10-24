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
  /** Requests with a Found/Shown still being saved; their buttons wait. */
  busy: ReadonlySet<string>;
  update: (request: KioskRequest, status: "found" | "shown") => void;
};

type Pending = { status: "found" | "shown"; token: number };

const byCreated = (a: KioskRequest, b: KioskRequest) => a.createdAt - b.createdAt;

/** The store's live request queue, polled like the staff page while this page is visible. */
export function useKioskQueue(store: string | null): KioskQueueState {
  const [requests, setRequests] = useState<KioskRequest[]>([]);
  const [clockOffset, setClockOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  // Bumped when the store changes or the page unmounts, so late callbacks do nothing.
  const generation = useRef(0);
  // Found/Shown not yet confirmed, applied over every poll. The token lets only
  // the newest change for a request roll itself back or clear itself.
  const pending = useRef(new Map<string, Pending>());
  // When each request was last changed here (start and settlement of each
  // Found/Shown), on a sequence shared with polls: a poll keeps what's on screen
  // for requests changed while it was in flight and takes everything else.
  const sequence = useRef(0);
  const lastChange = useRef(new Map<string, number>());
  const nextToken = useRef(0);

  useEffect(() => {
    const run = ++generation.current;
    const current = () => run === generation.current;
    pending.current = new Map();
    lastChange.current = new Map();
    setBusy(new Set());
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
        const startedAt = sequence.current;
        try {
          const queue = await fetchKioskQueue(store);
          if (current()) {
            const changedSince = (id: string) => (lastChange.current.get(id) ?? -1) > startedAt;
            const polled = new Set(queue.requests.map((item) => item.id));
            setClockOffset(queue.serverNow - Date.now());
            setRequests((shown) => {
              const onScreen = new Map(shown.map((item) => [item.id, item]));
              const merged: KioskRequest[] = [];
              for (const item of queue.requests) {
                if (changedSince(item.id)) {
                  const mine = onScreen.get(item.id);
                  if (mine) merged.push(mine);
                  continue;
                }
                const override = pending.current.get(item.id)?.status;
                if (override === "shown") continue;
                merged.push(override === "found" ? { ...item, status: "found" } : item);
              }
              // A row this page put back (a failed Shown) that the poll predates.
              for (const item of shown) if (!polled.has(item.id) && changedSince(item.id)) merged.push(item);
              return merged.sort(byCreated);
            });
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
    // One change per request at a time, so a rollback always returns to a state
    // the server confirmed rather than another unconfirmed click.
    if (!store || pending.current.has(request.id)) return;
    const run = generation.current;
    const token = ++nextToken.current;
    pending.current.set(request.id, { status, token });
    lastChange.current.set(request.id, ++sequence.current);
    setBusy((current) => new Set(current).add(request.id));
    setRequests((shown) => status === "shown"
      ? shown.filter((item) => item.id !== request.id)
      : shown.map((item) => item.id === request.id ? { ...item, status } : item));
    // Settles in one step: clear the override and mark the change together, so
    // no poll can land in between. Only the newest change, in this store, counts.
    const settle = (failed: unknown) => {
      if (run !== generation.current || pending.current.get(request.id)?.token !== token) return;
      pending.current.delete(request.id);
      lastChange.current.set(request.id, ++sequence.current);
      setBusy((current) => {
        const next = new Set(current);
        next.delete(request.id);
        return next;
      });
      if (failed === undefined) return;
      setError(failed instanceof Error ? failed.message : "Could not update the request.");
      setRequests((shown) => [...shown.filter((item) => item.id !== request.id), request].sort(byCreated));
    };
    void setKioskRequestStatus(store, request.id, status).then(() => settle(undefined), (cause: unknown) => settle(cause ?? new Error("Could not update the request.")));
  }, [store]);

  return { requests, clockOffset, error, busy, update };
}
