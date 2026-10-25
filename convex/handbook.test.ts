import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// Obviously fake credentials; real logins never belong in code or fixtures.
const LOGIN = { username: "tester@example.com", secret: "not-a-real-password-123" };

function asUser(t: ReturnType<typeof convexTest>, name: string) {
  return t.withIdentity({ subject: name, tokenIdentifier: `clerk|${name}`, name: `${name} Example` });
}

const valueEntry = {
  kind: "value" as const,
  title: "Store phone",
  category: "Store info",
  value: "555-0100",
  pinned: false,
};
const secretEntry = { kind: "secret" as const, title: "Console login", category: "Logins", pinned: false };

describe("handbook", () => {
  beforeEach(() => {
    vi.stubEnv("SHOPIFY_TOKEN_ENCRYPTION_KEY", "cd".repeat(32));
  });

  test("requires sign-in for every function", async () => {
    const t = convexTest(schema, modules);
    const id = await asUser(t, "alice").mutation(api.handbook.create, valueEntry);
    await expect(t.query(api.handbook.list, {})).rejects.toThrow("AUTHENTICATION_REQUIRED");
    await expect(t.mutation(api.handbook.create, valueEntry)).rejects.toThrow("AUTHENTICATION_REQUIRED");
    await expect(t.mutation(api.handbook.revealSecret, { id })).rejects.toThrow("AUTHENTICATION_REQUIRED");
    await expect(t.mutation(api.handbook.remove, { id })).rejects.toThrow("AUTHENTICATION_REQUIRED");
    await expect(t.mutation(api.handbook.addStarterEntries, {})).rejects.toThrow("AUTHENTICATION_REQUIRED");
  });

  test("lists show a login's username but never its password", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    expect(await alice.query(api.handbook.list, {})).toEqual([]);
    const id = await alice.mutation(api.handbook.create, { ...secretEntry, credentials: LOGIN });

    const [entry] = await alice.query(api.handbook.list, {});
    expect(entry).toMatchObject({ _id: id, kind: "secret", title: "Console login", updatedByName: "alice Example" });
    expect(entry.secretPreview).toBe("test••• · ••••••");
    expect(entry.username).toBe(LOGIN.username);
    expect(JSON.stringify(entry)).not.toContain(LOGIN.secret);

    expect(await alice.mutation(api.handbook.revealSecret, { id })).toEqual(LOGIN);
  });

  test("denies cross-account reads and writes", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const bob = asUser(t, "bob");
    const id = await alice.mutation(api.handbook.create, { ...secretEntry, credentials: LOGIN });
    await bob.mutation(api.handbook.create, valueEntry);

    expect((await bob.query(api.handbook.list, {})).map((entry) => entry.title)).toEqual(["Store phone"]);
    await expect(bob.mutation(api.handbook.revealSecret, { id })).rejects.toThrow("HANDBOOK_ENTRY_NOT_FOUND");
    await expect(bob.mutation(api.handbook.update, { id, ...valueEntry })).rejects.toThrow("HANDBOOK_ENTRY_NOT_FOUND");
    await expect(bob.mutation(api.handbook.setPinned, { id, pinned: true })).rejects.toThrow("HANDBOOK_ENTRY_NOT_FOUND");
    await expect(bob.mutation(api.handbook.reorder, { ids: [id] })).rejects.toThrow("HANDBOOK_ENTRY_NOT_FOUND");
    await expect(bob.mutation(api.handbook.remove, { id })).rejects.toThrow("HANDBOOK_ENTRY_NOT_FOUND");

    expect(await alice.mutation(api.handbook.revealSecret, { id })).toEqual(LOGIN);
    expect((await alice.query(api.handbook.list, {}))[0].pinned).toBe(false);
  });

  test("validates content for each kind", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    await expect(alice.mutation(api.handbook.create, { ...valueEntry, title: "  " })).rejects.toThrow("HANDBOOK_TITLE_REQUIRED");
    await expect(alice.mutation(api.handbook.create, { ...valueEntry, value: undefined })).rejects.toThrow("HANDBOOK_VALUE_REQUIRED");
    await expect(alice.mutation(api.handbook.create, secretEntry)).rejects.toThrow("HANDBOOK_SECRET_REQUIRED");
    await expect(alice.mutation(api.handbook.create, { kind: "guide", title: "Guide", category: "Setup", pinned: false, variants: [] }))
      .rejects.toThrow("HANDBOOK_STEPS_REQUIRED");
    // Only a value entry stores a copyable value.
    const id = await alice.mutation(api.handbook.create, { ...secretEntry, value: "ignored", credentials: LOGIN });
    expect((await alice.query(api.handbook.list, {})).find((entry) => entry._id === id)?.value).toBeUndefined();
  });

  test("updates keep or replace a login and drop it when the kind changes", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const id = await alice.mutation(api.handbook.create, { ...secretEntry, credentials: LOGIN });

    await alice.mutation(api.handbook.update, { id, ...secretEntry, title: "Renamed login" });
    expect(await alice.mutation(api.handbook.revealSecret, { id })).toEqual(LOGIN);

    // Changing only the password keeps the saved username, and vice versa.
    await alice.mutation(api.handbook.update, { id, ...secretEntry, credentials: { secret: "another-fake-value" } });
    expect(await alice.mutation(api.handbook.revealSecret, { id })).toEqual({ username: LOGIN.username, secret: "another-fake-value" });
    await alice.mutation(api.handbook.update, { id, ...secretEntry, credentials: { username: "other@example.com", secret: "" } });
    expect(await alice.mutation(api.handbook.revealSecret, { id })).toEqual({ username: "other@example.com", secret: "another-fake-value" });
    expect((await alice.query(api.handbook.list, {}))[0].secretPreview).toBe("othe••• · ••••••");

    await alice.mutation(api.handbook.update, { id, ...valueEntry });
    await expect(alice.mutation(api.handbook.revealSecret, { id })).rejects.toThrow("HANDBOOK_SECRET_NOT_FOUND");
    expect(await t.run((ctx) => ctx.db.query("handbookSecrets").collect())).toEqual([]);
  });

  test("stores passwords exactly as typed and encrypted at rest", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const login = { username: "tester@example.com", secret: "  fake pass  " };
    const id = await alice.mutation(api.handbook.create, { ...secretEntry, credentials: login });
    expect(await alice.mutation(api.handbook.revealSecret, { id })).toEqual(login);
    await expect(alice.mutation(api.handbook.create, { ...secretEntry, credentials: { secret: "   " } }))
      .rejects.toThrow("HANDBOOK_SECRET_REQUIRED");
    const [row] = await t.run((ctx) => ctx.db.query("handbookSecrets").collect());
    expect(JSON.stringify(row)).not.toContain("fake pass");
    expect(JSON.stringify(row)).not.toContain("tester@example.com");
  });

  test("rejects entries too large for the list to return", async () => {
    const t = convexTest(schema, modules);
    const step = { text: "x".repeat(1_000), command: "y".repeat(1_000), tip: "z".repeat(500) };
    await expect(asUser(t, "alice").mutation(api.handbook.create, {
      kind: "guide",
      title: "Huge guide",
      category: "Setup guides",
      pinned: false,
      variants: [{ label: "", steps: Array.from({ length: 10 }, () => step) }],
    })).rejects.toThrow("HANDBOOK_ENTRY_TOO_LARGE");
  });

  test("pages are listed only for clients that ask for them", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const page = { kind: "page" as const, title: "Opening checklist", category: "Procedures", pinned: false };
    await expect(alice.mutation(api.handbook.create, page)).rejects.toThrow("HANDBOOK_PAGE_REQUIRED");
    await alice.mutation(api.handbook.create, { ...page, body: "## Before opening\n- [ ] Count the drawer" });
    await alice.mutation(api.handbook.create, valueEntry);
    // Extensions released before pages existed call list with no arguments.
    expect((await alice.query(api.handbook.list, {})).map((entry) => entry.kind)).toEqual(["value"]);
    expect((await alice.query(api.handbook.list, { includePages: true })).map((entry) => entry.kind)).toEqual(["page", "value"]);
  });

  test("value entries can hold several labeled values", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const store = {
      kind: "value" as const,
      title: "Store",
      category: "Store info",
      pinned: false,
      fields: [
        { label: "Phone", value: "313-555-0100", format: "phone" as const },
        { label: "Address", value: "1234 Main St, Springfield, MI 48180", format: "address" as const },
        { label: "Email", value: "store@example.com" },
      ],
    };
    const id = await alice.mutation(api.handbook.create, store);
    const [saved] = await alice.query(api.handbook.list, {});
    expect(saved.fields?.map((field) => field.label)).toEqual(["Phone", "Address", "Email"]);
    // The first value is mirrored for extensions released before fields existed.
    expect(saved).toMatchObject({ value: "313-555-0100", valueFormat: "phone" });

    // Such an extension edits only `value`: the other fields survive, the first one changes.
    await alice.mutation(api.handbook.update, { id, kind: "value", title: "Store", category: "Store info", pinned: false, value: "313-555-0111" });
    const [edited] = await alice.query(api.handbook.list, {});
    expect(edited.fields?.map((field) => field.value)).toEqual(["313-555-0111", "1234 Main St, Springfield, MI 48180", "store@example.com"]);
    expect(edited.valueFormat).toBe("phone");

    // A single unlabeled value keeps the original shape.
    await alice.mutation(api.handbook.update, { id, ...store, fields: [{ value: "555-0100", format: "phone" }] });
    const [single] = await alice.query(api.handbook.list, {});
    expect(single.fields).toBeUndefined();
    expect(single.value).toBe("555-0100");

    await expect(alice.mutation(api.handbook.create, { ...store, fields: [{ label: "Phone", value: " " }] })).rejects.toThrow("HANDBOOK_VALUE_REQUIRED");
    await expect(alice.mutation(api.handbook.create, { ...store, fields: Array.from({ length: 9 }, () => ({ value: "x" })) }))
      .rejects.toThrow("HANDBOOK_FIELDS_TOO_MANY");
  });

  test("notes on quick values and logins become the short note", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    // An older extension still sends notes; they're folded into the short note.
    await alice.mutation(api.handbook.create, { ...valueEntry, note: "Front desk", body: "Ask for Juan\nAfter 5 PM" });
    const [entry] = await alice.query(api.handbook.list, {});
    expect(entry.note).toBe("Front desk · Ask for Juan · After 5 PM");
    expect(entry.body).toBeUndefined();

    // Entries saved before this change are moved by the one-time migration; guides keep their intro.
    const workspaceId = await t.run(async (ctx) => (await ctx.db.query("handbookEntries").first())!.workspaceId);
    await t.run(async (ctx) => {
      const base = { workspaceId, category: "Store info", pinned: false, order: 9, createdAt: 1, updatedAt: 1, updatedByName: "x" };
      await ctx.db.insert("handbookEntries", { ...base, kind: "value", title: "Old", value: "1", body: "Right off Wick" });
      await ctx.db.insert("handbookEntries", { ...base, kind: "guide", title: "Guide", body: "Intro", variants: [{ label: "", steps: [{ text: "Do it" }] }] });
    });
    expect(await t.mutation(internal.handbook.moveNotesIntoShortNotes, {})).toBe(1);
    const entries = await alice.query(api.handbook.list, {});
    expect(entries.find((item) => item.title === "Old")).toMatchObject({ note: "Right off Wick" });
    expect(entries.find((item) => item.title === "Old")?.body).toBeUndefined();
    expect(entries.find((item) => item.title === "Guide")?.body).toBe("Intro");
  });

  test("saves the category order per account", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    expect(await alice.query(api.handbook.categoryOrder, {})).toEqual([]);
    await alice.mutation(api.handbook.setCategoryOrder, { categories: ["Store info", "Logins", "Setup guides"] });
    await alice.mutation(api.handbook.setCategoryOrder, { categories: ["Logins", "Store info"] });
    expect(await alice.query(api.handbook.categoryOrder, {})).toEqual(["Logins", "Store info"]);
    expect(await asUser(t, "bob").query(api.handbook.categoryOrder, {})).toEqual([]);
    await expect(alice.mutation(api.handbook.setCategoryOrder, { categories: ["A", "A"] })).rejects.toThrow("HANDBOOK_INVALID_ORDER");
    await expect(t.query(api.handbook.categoryOrder, {})).rejects.toThrow("AUTHENTICATION_REQUIRED");
  });

  test("keeps the show-in-list option only on pages", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const page = { kind: "page" as const, title: "Returns", category: "Policies", body: "30 days with receipt.", pinned: false };
    const id = await alice.mutation(api.handbook.create, { ...page, showInList: true });
    expect((await alice.query(api.handbook.list, { includePages: true }))[0].showInList).toBe(true);
    await alice.mutation(api.handbook.update, { id, ...page, showInList: false });
    expect((await alice.query(api.handbook.list, { includePages: true }))[0].showInList).toBeUndefined();
    await alice.mutation(api.handbook.update, { id, ...valueEntry, showInList: true });
    expect((await alice.query(api.handbook.list, {}))[0].showInList).toBeUndefined();
  });

  test("keeps a value's format only on value entries", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const id = await alice.mutation(api.handbook.create, { ...valueEntry, valueFormat: "phone" });
    expect((await alice.query(api.handbook.list, {}))[0].valueFormat).toBe("phone");
    // An older extension's edit (no valueFormat) keeps the saved format.
    await alice.mutation(api.handbook.update, { id, ...valueEntry, note: "Front desk" });
    expect((await alice.query(api.handbook.list, {}))[0].valueFormat).toBe("phone");
    // An explicit Text choice is kept, so it overrides inference from the title.
    await alice.mutation(api.handbook.update, { id, ...valueEntry, valueFormat: "text" });
    expect((await alice.query(api.handbook.list, {}))[0].valueFormat).toBe("text");
    await alice.mutation(api.handbook.update, {
      id, kind: "page", title: "Phone tips", category: "Store info", body: "Call **first**.", pinned: false, valueFormat: "phone",
    });
    const [page] = await alice.query(api.handbook.list, { includePages: true });
    expect(page.kind).toBe("page");
    expect(page.valueFormat).toBeUndefined();
    expect(page.value).toBeUndefined();
  });

  test("orders, pins and removes entries", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const first = await alice.mutation(api.handbook.create, { ...valueEntry, title: "First" });
    const second = await alice.mutation(api.handbook.create, { ...valueEntry, title: "Second" });
    const login = await alice.mutation(api.handbook.create, { ...secretEntry, credentials: LOGIN });

    await alice.mutation(api.handbook.reorder, { ids: [second, first] });
    await alice.mutation(api.handbook.setPinned, { id: first, pinned: true });
    const listed = await alice.query(api.handbook.list, {});
    expect(listed.map((entry) => entry.title)).toEqual(["Second", "First", "Console login"]);
    expect(listed[1].pinned).toBe(true);

    await alice.mutation(api.handbook.remove, { id: login });
    expect(await alice.query(api.handbook.list, {})).toHaveLength(2);
    expect(await t.run((ctx) => ctx.db.query("handbookSecrets").collect())).toEqual([]);
  });

  test("adds starter entries once and never seeds a secret", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    expect(await alice.mutation(api.handbook.addStarterEntries, {})).toBe(1);
    expect(await alice.mutation(api.handbook.addStarterEntries, {})).toBe(0);
    const entries = await alice.query(api.handbook.list, {});
    expect(entries.map((entry) => entry.kind)).toEqual(["guide"]);
    const guide = entries.find((entry) => entry.kind === "guide");
    expect(guide?.variants?.map((variant) => variant.label)).toEqual(["New method (24H2+)", "Older builds"]);
    expect(guide?.variants?.[0].steps[2].command).toBe("start ms-cxh:localonly");
    expect(await t.run((ctx) => ctx.db.query("handbookSecrets").collect())).toEqual([]);
    expect(await asUser(t, "bob").query(api.handbook.list, {})).toEqual([]);
  });
});
