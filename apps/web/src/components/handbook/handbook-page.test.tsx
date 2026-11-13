import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { HandbookEntry } from "@volt/handbook";

import { AppLayout } from "../app-shell";
import { HandbookPage, type HandbookLocation } from "./handbook-page";

const state = vi.hoisted(() => ({ entries: [] as unknown[], authenticated: true }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: state.authenticated, isLoading: false }),
  useQuery_experimental: () => ({ status: "success", data: state.entries }),
  useQuery: () => [],
  useMutation: () => vi.fn(),
}));

function entry(fields: Partial<HandbookEntry> & Pick<HandbookEntry, "_id" | "kind" | "title" | "category">): HandbookEntry {
  return {
    comment: undefined, value: undefined, valueFormat: undefined, showInList: undefined, fields: undefined,
    username: undefined, body: undefined, variants: undefined, secretPreview: undefined,
    pinned: false, order: 0, updatedAt: 0, updatedByName: "Sam",
    ...fields,
  };
}

const id = (value: string) => value as HandbookEntry["_id"];
const phone = entry({ _id: id("phone"), kind: "value", title: "Store phone", category: "Store info", value: "313-555-0100", valueFormat: "phone", pinned: true, order: 0 });
const login = entry({ _id: id("psn"), kind: "secret", title: "PSN", category: "Logins", username: "store@example.com", secretPreview: "stor••• · ••••••", order: 1 });
const note = entry({ _id: id("open"), kind: "note", title: "Opening checklist", category: "Procedures", body: "## Before open\n- [x] Lights\n- [ ] Till", order: 2 });

const render = (location: HandbookLocation) => renderToStaticMarkup(<HandbookPage location={location} navigate={vi.fn()} />);
const list: HandbookLocation = { view: { kind: "list" }, filter: { kind: "all" } };

beforeEach(() => {
  state.entries = [phone, login, note];
  state.authenticated = true;
});

describe("web handbook", () => {
  test("lists entries by group, with categories and a copy button for single values", () => {
    const html = render(list);
    expect(html).toContain("Pinned");
    expect(html).toContain("Store phone");
    expect(html).toContain("Opening checklist");
    expect(html).toContain("Search 3 entries");
    expect(html).toMatch(/aria-label="Move Logins up"/);
    // The phone is copyable from the list; the login isn't (its password needs a reveal).
    expect(html.match(/>Copy</g)).toHaveLength(1);
    // A login's row shows its username; nothing in the list query carries a password.
    expect(html).toContain("store@example.com");
  });

  test("filters by category", () => {
    const html = render({ view: { kind: "list" }, filter: { kind: "category", category: "Logins" } });
    expect(html).toContain("PSN");
    expect(html).not.toContain(">Store phone<");
  });

  test("a login shows its username but never a password until revealed", () => {
    const html = render({ view: { kind: "article", id: "psn" }, filter: { kind: "all" } });
    expect(html).toContain("store@example.com");
    expect(html).toContain('aria-label="Reveal the PSN password"');
    expect(html).toContain("Delete PSN");
  });

  test("a note renders its formatting as elements, not raw markdown", () => {
    const html = render({ view: { kind: "article", id: "open" }, filter: { kind: "all" } });
    expect(html).toMatch(/<h3[^>]*><span>Before open<\/span><\/h3>/);
    expect(html).toContain('aria-label="Done"');
    expect(html).not.toContain("## Before open");
  });

  test("opens the editor for new and existing entries", () => {
    expect(render({ view: { kind: "new" }, filter: { kind: "all" } })).toContain("New entry</h2>");
    const edit = render({ view: { kind: "edit", id: "psn" }, filter: { kind: "all" } });
    expect(edit).toContain("Edit entry</h2>");
    expect(edit).toContain("Leave blank to keep the saved password.");
  });

  test("an empty handbook offers starter entries", () => {
    state.entries = [];
    const html = render(list);
    expect(html).toContain("Start your store handbook");
    expect(html).toContain("Add Store phone");
  });

  test("waits for Convex auth before loading", () => {
    state.authenticated = false;
    expect(render(list)).toContain("Loading the handbook");
  });

  test("the sidebar marks the handbook as the current page", () => {
    const html = renderToStaticMarkup(<AppLayout current="handbook"><p>Handbook content</p></AppLayout>);
    expect(html).toMatch(/href="\/handbook"[^>]*aria-current="page"/);
  });
});
