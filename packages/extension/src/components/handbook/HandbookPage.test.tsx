import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { HandbookEntry } from "../../domain/handbook";
import HandbookPage from "./HandbookPage";
import { draftFor, HandbookEditor } from "./HandbookEditor";

const state = vi.hoisted(() => ({ entries: [] as HandbookEntry[] }));
vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("../../hooks/useHandbookEntries", () => ({
  useHandbookEntries: () => ({ status: "ready", data: state.entries }),
  useHandbookCategoryOrder: () => [],
}));
vi.mock("../access/ExtensionAccess", () => ({
  useSidepanelSignedIn: () => true,
  useSidepanelSignIn: () => ({ signInOpen: false, openSignIn: vi.fn() }),
  ExtensionAccountControl: () => null,
  SidepanelSignInCard: () => null,
}));
vi.mock("./NoteEditor", () => ({ NoteEditor: () => null }));

function entry(title: string, category: string, order: number, pinned = true): HandbookEntry {
  return {
    _id: title as HandbookEntry["_id"], kind: "value", title, category, order, pinned,
    comment: undefined, value: "Example", valueFormat: undefined, showInList: undefined,
    fields: undefined, username: undefined, body: undefined, variants: undefined,
    secretPreview: undefined, updatedAt: 0, updatedByName: "Sam",
  };
}

beforeEach(() => { state.entries = []; });

test("pinned arrows only allow adjacent entries in the same category", () => {
  state.entries = [entry("Phone", "Store info", 0), entry("Address", "Store info", 1), entry("Login", "Logins", 2)];
  const html = renderToStaticMarkup(<HandbookPage />);
  expect(html).toMatch(/aria-label="Move Phone up" disabled=""/);
  expect(html).not.toMatch(/aria-label="Move Phone down" disabled=""/);
  expect(html).not.toMatch(/aria-label="Move Address up" disabled=""/);
  expect(html).toMatch(/aria-label="Move Address down" disabled=""/);
  expect(html).toMatch(/aria-label="Move Login up" disabled=""/);
  expect(html).toMatch(/aria-label="Move Login down" disabled=""/);
});

test("category groups keep their reorder arrows", () => {
  state.entries = [entry("Phone", "Store info", 0, false), entry("Address", "Store info", 1, false)];
  const html = renderToStaticMarkup(<HandbookPage />);
  expect(html).not.toMatch(/aria-label="Move Phone down" disabled=""/);
  expect(html).not.toMatch(/aria-label="Move Address up" disabled=""/);
});

test("comments keep newlines in a growing textarea and leave Older text alone", () => {
  const existing = { ...entry("Phone", "Store info", 0), comment: "First line\nSecond line", body: "Older text" };
  const html = renderToStaticMarkup(<HandbookEditor entry={existing} initial={draftFor(existing)} categories={["Store info"]} onSaved={vi.fn()} onCancel={vi.fn()} />);
  expect(html).toContain('<textarea class="handbook-comment-input" rows="1">First line\nSecond line</textarea>');
  expect(html).toContain('<textarea rows="3">Older text</textarea>');
  expect(html).toContain("Shown under the title");
});
