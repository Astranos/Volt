export type SnapshotResult = {
  id: string;
  type: "text" | "barcode" | "photo" | "dictation";
  deliveryState: "available" | "deleted";
  value?: string;
  format?: string;
  photoObjectKey?: string;
  contentType?: string;
  byteCount: number;
  createdAt: string;
};
export type SnapshotDelivery = { targetDeviceId: string; state: "pending" | "delivered" | "failed"; attempts: number };
export type SnapshotBatch = {
  id: string;
  createdAt: string;
  updatedAt: string;
  deliveryState: "available" | "uploading" | "deleted";
  results: SnapshotResult[];
  deliveries: SnapshotDelivery[];
};
export type CompleteWorkspaceSnapshot = { workspaceId: string; revision: number; batches: SnapshotBatch[] };
export type SnapshotPageKind = "batches" | "results" | "deliveries";
export type SnapshotPageArgs = { kind: SnapshotPageKind; cursor: string | null };
type PageBoundary = { workspaceId: string; revision: number; continueCursor: string; isDone: boolean };
export type WorkspaceSnapshotPage = PageBoundary & (
  | { kind: "batches"; items: Omit<SnapshotBatch, "results" | "deliveries">[] }
  | { kind: "results"; items: (SnapshotResult & { batchId: string })[] }
  | { kind: "deliveries"; items: (SnapshotDelivery & { id: string; batchId: string })[] }
);
export const snapshotPageKinds: readonly SnapshotPageKind[] = ["batches", "results", "deliveries"];

/** Merge only complete page chains. Result tombstones are data, never filtered. */
export function mergeWorkspaceSnapshotPages(pages: readonly WorkspaceSnapshotPage[]): CompleteWorkspaceSnapshot {
  const first = pages[0];
  if (!first) throw new Error("A workspace snapshot needs page metadata");
  if (pages.some((page) => page.workspaceId !== first.workspaceId)) throw new Error("Workspace changed during pagination");
  const batches = new Map<string, SnapshotBatch>();
  const results = new Map<string, SnapshotResult & { batchId: string }>();
  const deliveries = new Map<string, SnapshotDelivery & { id: string; batchId: string }>();
  let revision = 0;
  for (const page of pages) {
    revision = Math.max(revision, page.revision);
    if (page.kind === "batches") {
      for (const batch of page.items) {
        batches.set(batch.id, { ...batch, results: [], deliveries: [] });
        revision = Math.max(revision, Date.parse(batch.updatedAt));
      }
    } else if (page.kind === "results") {
      for (const result of page.items) results.set(result.id, result);
    } else {
      for (const delivery of page.items) deliveries.set(delivery.id, delivery);
    }
  }
  for (const { batchId, ...result } of results.values()) batches.get(batchId)?.results.push(result);
  for (const { batchId, id: _id, ...delivery } of deliveries.values()) batches.get(batchId)?.deliveries.push(delivery);
  return { workspaceId: first.workspaceId, revision, batches: [...batches.values()] };
}

type SubscribePage = (
  args: SnapshotPageArgs,
  onValue: (page: WorkspaceSnapshotPage | null) => void,
  onError: (error: unknown) => void,
) => () => void;
type Slot = { cursor: string | null; value?: WorkspaceSnapshotPage | null; stop: () => void; active: boolean };

/** Each loaded page remains reactive. Changed boundaries replace the tail. */
export function subscribeWorkspaceSnapshot(options: {
  subscribe: SubscribePage;
  onSnapshot: (snapshot: CompleteWorkspaceSnapshot | null) => void;
  onError: (error: unknown) => void;
}): () => void {
  let active = true;
  const streams = new Map<SnapshotPageKind, Slot[]>();
  function trim(slots: Slot[], from: number) {
    for (const slot of slots.splice(from)) { slot.active = false; slot.stop(); }
  }
  function publish() {
    const pages: WorkspaceSnapshotPage[] = [];
    for (const kind of snapshotPageKinds) {
      const slots = streams.get(kind);
      if (!slots?.length || slots.some((slot) => slot.value === undefined)) return;
      if (slots[0].value === null) {
        if (snapshotPageKinds.every((key) => streams.get(key)?.[0]?.value === null)) options.onSnapshot(null);
        return;
      }
      if (!slots.at(-1)?.value?.isDone) return;
      for (const slot of slots) if (slot.value) pages.push(slot.value);
    }
    // During an account transition the three root subscriptions can update separately.
    if (pages.some((page) => page.workspaceId !== pages[0]?.workspaceId)) return;
    options.onSnapshot(mergeWorkspaceSnapshotPages(pages));
  }
  function add(kind: SnapshotPageKind, slots: Slot[], cursor: string | null) {
    const slot: Slot = { cursor, stop: () => {}, active: true };
    const index = slots.length;
    slots.push(slot);
    const stop = options.subscribe({ kind, cursor }, (page) => {
      if (!active || !slot.active) return;
      slot.value = page;
      const next = page && !page.isDone ? page.continueCursor : null;
      if (next === null) trim(slots, index + 1);
      else if (slots[index + 1]?.cursor !== next) {
        trim(slots, index + 1);
        if (slots.some((item) => item.cursor === next)) { options.onError(new Error("Snapshot cursor did not advance")); return; }
        add(kind, slots, next);
      }
      publish();
    }, (error) => {
      if (!active || !slot.active) return;
      slot.value = undefined;
      options.onError(error);
    });
    slot.stop = stop;
    if (!active || !slot.active) stop();
  }
  for (const kind of snapshotPageKinds) { const slots: Slot[] = []; streams.set(kind, slots); add(kind, slots, null); }
  return () => { active = false; for (const slots of streams.values()) trim(slots, 0); };
}

export async function fetchWorkspaceSnapshot(
  fetchPage: (args: SnapshotPageArgs) => Promise<WorkspaceSnapshotPage | null>,
): Promise<CompleteWorkspaceSnapshot | null> {
  const streams = await Promise.all(snapshotPageKinds.map(async (kind) => {
    const pages: WorkspaceSnapshotPage[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    while (true) {
      const page = await fetchPage({ kind, cursor });
      if (page === null) return null;
      pages.push(page);
      if (page.isDone) return pages;
      if (seen.has(page.continueCursor)) throw new Error("Snapshot cursor did not advance");
      seen.add(page.continueCursor);
      cursor = page.continueCursor;
    }
  }));
  if (streams.every((pages) => pages === null)) return null;
  if (streams.some((pages) => pages === null)) throw new Error("Workspace changed during pagination");
  return mergeWorkspaceSnapshotPages(streams.flatMap((pages) => pages ?? []));
}
