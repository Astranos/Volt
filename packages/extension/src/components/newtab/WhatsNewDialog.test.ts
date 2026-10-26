import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useWhatsNew, WhatsNewDialog } from "./WhatsNewDialog";
import { RELEASE_NOTES_ID, RELEASE_NOTES_VERSION, WHATS_NEW_SEEN_NOTES_KEY, WHATS_NEW_SEEN_VERSION_KEY } from "./release-notes";

type State = string | boolean | null;
const harness = vi.hoisted(() => ({
  cells: [] as { value: State }[],
  cursor: 0,
  collectEffects: true,
  cleanups: [] as (() => void)[],
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: State | (() => State)) => {
    const index = harness.cursor++;
    const cell = harness.cells[index] ?? { value: typeof initial === "function" ? initial() : initial };
    harness.cells[index] = cell;
    return [cell.value, (next: State | ((previous: State) => State)) => {
      cell.value = typeof next === "function" ? next(cell.value) : next;
    }];
  },
  useEffect: (effect: () => void | (() => void)) => {
    if (!harness.collectEffects) return;
    const cleanup = effect();
    if (cleanup) harness.cleanups.push(cleanup);
  },
}));

type StorageListener = Parameters<typeof chrome.storage.onChanged.addListener>[0];
type KeyListener = (event: Pick<KeyboardEvent, "key" | "defaultPrevented">) => void;
const storageListeners: StorageListener[] = [];
const keyListeners: KeyListener[] = [];
const get = vi.fn<() => Promise<Record<string, unknown>>>(async () => ({}));
const set = vi.fn(async () => {});
const removeStorageListener = vi.fn();
const removeKeyListener = vi.fn();

class FocusTarget {
  isContentEditable = false;
  closest = vi.fn<() => FocusTarget | null>(() => null);
}
const fakeDocument = {
  activeElement: null as FocusTarget | null,
  querySelector: vi.fn<() => FocusTarget | null>(() => null),
};

function renderHook() {
  harness.cursor = 0;
  const result = useWhatsNew();
  harness.collectEffects = false;
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.cells = [];
  harness.cursor = 0;
  harness.collectEffects = true;
  harness.cleanups = [];
  storageListeners.length = 0;
  keyListeners.length = 0;
  get.mockResolvedValue({});
  fakeDocument.activeElement = null;
  fakeDocument.querySelector.mockReturnValue(null);
  vi.stubGlobal("HTMLElement", FocusTarget);
  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("window", {
    addEventListener: (_type: string, listener: KeyListener) => keyListeners.push(listener),
    removeEventListener: removeKeyListener,
  });
  vi.stubGlobal("chrome", {
    runtime: { getManifest: () => ({ version: RELEASE_NOTES_VERSION }) },
    storage: {
      local: { get, set },
      onChanged: { addListener: (listener: StorageListener) => storageListeners.push(listener), removeListener: removeStorageListener },
    },
  });
});

afterEach(() => {
  for (const cleanup of harness.cleanups) cleanup();
  vi.unstubAllGlobals();
});

const seen = {
  [WHATS_NEW_SEEN_VERSION_KEY]: { newValue: RELEASE_NOTES_VERSION },
  [WHATS_NEW_SEEN_NOTES_KEY]: { newValue: RELEASE_NOTES_ID },
};

test("another tab dismissing the notes clears the unread dot and auto-opened card", async () => {
  renderHook();
  await Promise.resolve();
  expect(renderHook()).toMatchObject({ open: true, unread: true });
  storageListeners[0](seen, "sync");
  expect(renderHook()).toMatchObject({ open: true, unread: true });
  storageListeners[0](seen, "local");
  expect(renderHook()).toMatchObject({ open: false, unread: false });
  storageListeners[0]({ [WHATS_NEW_SEEN_NOTES_KEY]: { newValue: "older notes" } }, "local");
  expect(renderHook().unread).toBe(true);
});

test("storage updates leave a manually opened card open", async () => {
  renderHook();
  await Promise.resolve();
  renderHook().show();
  storageListeners[0](seen, "local");
  expect(renderHook()).toMatchObject({ open: true, unread: false });
});

test("a stale initial read cannot undo a dismissal received from another tab", async () => {
  let resolveRead: (stored: Record<string, unknown>) => void = () => {};
  get.mockReturnValueOnce(new Promise((resolve) => { resolveRead = resolve; }));
  renderHook();
  storageListeners[0](seen, "local");
  resolveRead({});
  await Promise.resolve();
  expect(renderHook()).toMatchObject({ open: false, unread: false });
});

test("unmount removes the storage listener and ignores a pending read", async () => {
  renderHook();
  harness.cleanups[0]();
  expect(removeStorageListener).toHaveBeenCalledWith(storageListeners[0]);
  await Promise.resolve();
  expect(renderHook()).toMatchObject({ open: false, unread: false });
});

test("Escape closes the card and its key listener is removed on unmount", () => {
  const onClose = vi.fn();
  WhatsNewDialog({ version: RELEASE_NOTES_VERSION, onClose });
  keyListeners[0]({ key: "Enter", defaultPrevented: false });
  expect(onClose).not.toHaveBeenCalled();
  keyListeners[0]({ key: "Escape", defaultPrevented: false });
  expect(onClose).toHaveBeenCalledOnce();
  harness.cleanups[0]();
  expect(removeKeyListener).toHaveBeenCalledWith("keydown", keyListeners[0]);
});

test.each(["prevented", "input", "textarea", "contenteditable", "palette"])("Escape respects %s", (guard) => {
  const onClose = vi.fn();
  WhatsNewDialog({ version: RELEASE_NOTES_VERSION, onClose });
  if (guard === "input" || guard === "textarea" || guard === "contenteditable") {
    fakeDocument.activeElement = new FocusTarget();
    if (guard === "contenteditable") fakeDocument.activeElement.isContentEditable = true;
    else fakeDocument.activeElement.closest.mockReturnValue(fakeDocument.activeElement);
  }
  if (guard === "palette") fakeDocument.querySelector.mockReturnValue(new FocusTarget());
  keyListeners[0]({ key: "Escape", defaultPrevented: guard === "prevented" });
  expect(onClose).not.toHaveBeenCalled();
  expect(fakeDocument.querySelector).toHaveBeenCalledTimes(guard === "prevented" ? 0 : 1);
});
