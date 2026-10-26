import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
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
    await expect(t.query(api.handbook.entries, {})).rejects.toThrow("AUTHENTICATION_REQUIRED");
    await expect(t.mutation(api.handbook.create, valueEntry)).rejects.toThrow("AUTHENTICATION_REQUIRED");
    await expect(t.mutation(api.handbook.revealSecret, { id })).rejects.toThrow("AUTHENTICATION_REQUIRED");
    await expect(t.mutation(api.handbook.remove, { id })).rejects.toThrow("AUTHENTICATION_REQUIRED");
    await expect(t.mutation(api.handbook.addStarterEntries, {})).rejects.toThrow("AUTHENTICATION_REQUIRED");
  });

  test("accepts normalized content up to 16,003 bytes", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const content = { kind: "note" as const, title: "Note", category: "Procedures", pinned: false, body: "b".repeat(15_000), comment: "n".repeat(911) };
    expect(new TextEncoder().encode(JSON.stringify(content))).toHaveLength(16_003);
    const id = await alice.mutation(api.handbook.create, content);
    expect((await alice.query(api.handbook.entries, {})).find((entry) => entry._id === id)?.comment).toHaveLength(911);
    await alice.mutation(api.handbook.update, { id, ...content });
    await expect(alice.mutation(api.handbook.create, { ...content, comment: `${content.comment}n` }))
      .rejects.toThrow("HANDBOOK_ENTRY_TOO_LARGE");
  });

  test("rejects removed input shapes during argument validation", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const id = await alice.mutation(api.handbook.create, valueEntry);
    // A signed-out, untyped RPC caller proves argument validation runs before authentication.
    for (const name of ["handbook:create", "handbook:update"]) {
      const mutation = makeFunctionReference<"mutation", Record<string, unknown>, unknown>(name);
      const args = name === "handbook:update" ? { id, ...valueEntry } : valueEntry;
      await expect(t.mutation(mutation, { ...args, kind: "page", body: "Text" }))
        .rejects.toThrow("Validator error: Expected one of");
      await expect(t.mutation(mutation, { ...args, note: "Removed field" }))
        .rejects.toThrow("Validator error: Unexpected field `note`");
    }
    expect(await alice.query(api.handbook.entries, {})).toMatchObject([{ _id: id, kind: "value" }]);
  });

  test("lists show a login's username but never its password", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    expect(await alice.query(api.handbook.entries, {})).toEqual([]);
    const id = await alice.mutation(api.handbook.create, { ...secretEntry, credentials: LOGIN });

    const [entry] = await alice.query(api.handbook.entries, {});
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

    expect((await bob.query(api.handbook.entries, {})).map((entry) => entry.title)).toEqual(["Store phone"]);
    await expect(bob.mutation(api.handbook.revealSecret, { id })).rejects.toThrow("HANDBOOK_ENTRY_NOT_FOUND");
    await expect(bob.mutation(api.handbook.update, { id, ...valueEntry })).rejects.toThrow("HANDBOOK_ENTRY_NOT_FOUND");
    await expect(bob.mutation(api.handbook.setPinned, { id, pinned: true })).rejects.toThrow("HANDBOOK_ENTRY_NOT_FOUND");
    await expect(bob.mutation(api.handbook.reorder, { ids: [id] })).rejects.toThrow("HANDBOOK_ENTRY_NOT_FOUND");
    await expect(bob.mutation(api.handbook.remove, { id })).rejects.toThrow("HANDBOOK_ENTRY_NOT_FOUND");

    expect(await alice.mutation(api.handbook.revealSecret, { id })).toEqual(LOGIN);
    expect((await alice.query(api.handbook.entries, {}))[0].pinned).toBe(false);
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
    expect((await alice.query(api.handbook.entries, {})).find((entry) => entry._id === id)?.value).toBeUndefined();
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
    expect((await alice.query(api.handbook.entries, {}))[0].secretPreview).toBe("othe••• · ••••••");

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

  test("entries return notes and comments", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const note = { kind: "note" as const, title: "Opening checklist", category: "Procedures", pinned: false };
    await expect(alice.mutation(api.handbook.create, note)).rejects.toThrow("HANDBOOK_PAGE_REQUIRED");
    await expect(alice.mutation(api.handbook.create, { ...note, body: "x".repeat(15_001) }))
      .rejects.toThrow("HANDBOOK_PAGE_TOO_LONG");
    await expect(alice.mutation(api.handbook.create, { ...valueEntry, comment: "x".repeat(12_001) }))
      .rejects.toThrow("HANDBOOK_NOTE_TOO_LONG");
    await alice.mutation(api.handbook.create, {
      ...note, comment: "Before 9 AM", body: "## Before opening\n- [ ] Count the drawer",
    });
    await alice.mutation(api.handbook.create, { ...valueEntry, comment: "Front desk" });

    const current = await alice.query(api.handbook.entries, {});
    expect(current.map((entry) => [entry.kind, entry.comment])).toEqual([["note", "Before 9 AM"], ["value", "Front desk"]]);
    expect(current.every((entry) => !("note" in entry))).toBe(true);
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
    const [saved] = await alice.query(api.handbook.entries, {});
    expect(saved.fields?.map((field) => field.label)).toEqual(["Phone", "Address", "Email"]);
    // The first value is mirrored in the single-value fields.
    expect(saved).toMatchObject({ value: "313-555-0100", valueFormat: "phone" });

    // An edit with only `value` changes the first field and preserves the others.
    await alice.mutation(api.handbook.update, { id, kind: "value", title: "Store", category: "Store info", pinned: false, value: "313-555-0111" });
    const [edited] = await alice.query(api.handbook.entries, {});
    expect(edited.fields?.map((field) => field.value)).toEqual(["313-555-0111", "1234 Main St, Springfield, MI 48180", "store@example.com"]);
    expect(edited.valueFormat).toBe("phone");

    // A single unlabeled value keeps the original shape.
    await alice.mutation(api.handbook.update, { id, ...store, fields: [{ value: "555-0100", format: "phone" }] });
    const [single] = await alice.query(api.handbook.entries, {});
    expect(single.fields).toBeUndefined();
    expect(single.value).toBe("555-0100");

    await expect(alice.mutation(api.handbook.create, { ...store, fields: [{ label: "Phone", value: " " }] })).rejects.toThrow("HANDBOOK_VALUE_REQUIRED");
    await expect(alice.mutation(api.handbook.create, { ...store, fields: Array.from({ length: 9 }, () => ({ value: "x" })) }))
      .rejects.toThrow("HANDBOOK_FIELDS_TOO_MANY");
  });

  test.each(["value", "secret"] as const)("body text on a %s becomes the comment", async (kind) => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const input = kind === "value" ? valueEntry : { ...secretEntry, credentials: LOGIN };
    const id = await alice.mutation(api.handbook.create, { ...input, comment: "Front desk", body: "Ask for Juan\nAfter 5 PM" });
    const [entry] = await alice.query(api.handbook.entries, {});
    expect(entry.comment).toBe("Front desk\nAsk for Juan\nAfter 5 PM");
    expect(entry.body).toBeUndefined();

    await alice.mutation(api.handbook.update, { id, ...input, comment: "Updated", body: "More context" });
    expect((await alice.query(api.handbook.entries, {}))[0]).toMatchObject({ comment: "Updated\nMore context" });
    expect((await alice.query(api.handbook.entries, {}))[0].body).toBeUndefined();
  });

  test("folds long body text and keeps it separate when the comment cannot fit", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const longest = { ...valueEntry, comment: "n".repeat(200), body: `${"b".repeat(4_999)}\n${"c".repeat(5_000)}` };
    const id = await alice.mutation(api.handbook.create, longest);
    const [folded] = await alice.query(api.handbook.entries, {});
    expect(folded.comment).toBe(`${longest.comment}\n${longest.body}`);
    expect(folded.body).toBeUndefined();
    await alice.mutation(api.handbook.update, { id, ...longest });
    // A comment that cannot take the body keeps it separate instead of failing.
    await alice.mutation(api.handbook.update, { id, ...valueEntry, comment: "n".repeat(11_995), body: "kept as notes" });
    const [kept] = await alice.query(api.handbook.entries, {});
    expect(kept.body).toBe("kept as notes");
    expect(kept.comment).toHaveLength(11_995);
  });

  test("a long folded comment stays editable", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const id = await alice.mutation(api.handbook.create, { ...valueEntry, body: "x".repeat(250) });
    // A normal save afterwards (no notes) keeps working with the longer comment.
    await alice.mutation(api.handbook.update, { id, ...valueEntry, comment: "y".repeat(250), title: "Renamed" });
    expect((await alice.query(api.handbook.entries, {}))[0].title).toBe("Renamed");
  });

  test("edits without fields keep every value and the first value's format", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const base = { kind: "value" as const, title: "Store address", category: "Store info", pinned: false };
    // Title-based format inference does not override a field without a saved format.
    const fields = [{ label: "Email", value: "store@example.com" }, { label: "Phone", value: "313-555-0100", format: "phone" as const }];
    const id = await alice.mutation(api.handbook.create, { ...base, fields });
    await alice.mutation(api.handbook.update, { id, ...base, value: "store@example.com", valueFormat: "address" });
    const [kept] = await alice.query(api.handbook.entries, {});
    expect(kept.fields?.[0]).toEqual({ label: "Email", value: "store@example.com" });
    // A different format overrides an explicitly saved format.
    await alice.mutation(api.handbook.update, { id, ...base, fields: [{ ...fields[0], format: "text" }, fields[1]] });
    await alice.mutation(api.handbook.update, { id, ...base, value: "store@example.com", valueFormat: "phone" });
    expect((await alice.query(api.handbook.entries, {}))[0].fields?.[0].format).toBe("phone");
    await alice.mutation(api.handbook.update, { id, ...base, fields });
    // Conversion without fields preserves the remaining values as lines in the note.
    await alice.mutation(api.handbook.update, { id, kind: "note", title: "Store", category: "Store info", pinned: false, body: "store@example.com" });
    const [note] = await alice.query(api.handbook.entries, {});
    expect(note).toMatchObject({ kind: "note", body: "store@example.com\n\nPhone: 313-555-0100" });
  });

  test("the current editor's own note conversion isn't padded with old values", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const id = await alice.mutation(api.handbook.create, {
      kind: "value", title: "Store", category: "Store info", pinned: false,
      fields: [{ label: "Email", value: "old@example.com" }, { label: "Phone", value: "313-555-0100" }],
    });
    // The editor already moved (and the user edited) the values; it sends `fields: []`.
    await alice.mutation(api.handbook.update, {
      id, kind: "note", title: "Store", category: "Store info", pinned: false, fields: [], body: "Email: new@example.com",
    });
    expect((await alice.query(api.handbook.entries, {}))[0].body).toBe("Email: new@example.com");
  });

  test("a login that can't be read hides its username instead of failing the list", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const id = await alice.mutation(api.handbook.create, { ...secretEntry, credentials: LOGIN });
    await alice.mutation(api.handbook.create, valueEntry);
    await t.run(async (ctx) => {
      const row = await ctx.db.query("handbookSecrets").withIndex("by_entryId", (q) => q.eq("entryId", id)).unique();
      await ctx.db.patch(row!._id, { username: "00.ff" });
    });
    const entries = await alice.query(api.handbook.entries, {});
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry._id === id)?.username).toBeUndefined();
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
    // More than 50 categories can still be ordered.
    await alice.mutation(api.handbook.setCategoryOrder, { categories: Array.from({ length: 60 }, (_, i) => `Category ${i}`) });
    expect(await alice.query(api.handbook.categoryOrder, {})).toHaveLength(60);
    await expect(t.query(api.handbook.categoryOrder, {})).rejects.toThrow("AUTHENTICATION_REQUIRED");
  });

  test("keeps the show-in-list option only on notes", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const note = { kind: "note" as const, title: "Returns", category: "Policies", body: "30 days with receipt.", pinned: false };
    const id = await alice.mutation(api.handbook.create, { ...note, showInList: true });
    expect((await alice.query(api.handbook.entries, {}))[0].showInList).toBe(true);
    await alice.mutation(api.handbook.update, { id, ...note, showInList: false });
    expect((await alice.query(api.handbook.entries, {}))[0].showInList).toBeUndefined();
    await alice.mutation(api.handbook.update, { id, ...valueEntry, showInList: true });
    expect((await alice.query(api.handbook.entries, {}))[0].showInList).toBeUndefined();
  });

  test("keeps a value's format only on value entries", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const id = await alice.mutation(api.handbook.create, { ...valueEntry, valueFormat: "phone" });
    expect((await alice.query(api.handbook.entries, {}))[0].valueFormat).toBe("phone");
    // An edit without valueFormat keeps the saved format.
    await alice.mutation(api.handbook.update, { id, ...valueEntry, comment: "Front desk" });
    expect((await alice.query(api.handbook.entries, {}))[0].valueFormat).toBe("phone");
    // An explicit Text choice is kept, so it overrides inference from the title.
    await alice.mutation(api.handbook.update, { id, ...valueEntry, valueFormat: "text" });
    expect((await alice.query(api.handbook.entries, {}))[0].valueFormat).toBe("text");
    await alice.mutation(api.handbook.update, {
      id, kind: "note", title: "Phone tips", category: "Store info", body: "Call **first**.", pinned: false, valueFormat: "phone",
    });
    const [note] = await alice.query(api.handbook.entries, {});
    expect(note.kind).toBe("note");
    expect(note.valueFormat).toBeUndefined();
    expect(note.value).toBeUndefined();
  });

  test("orders, pins and removes entries", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const first = await alice.mutation(api.handbook.create, { ...valueEntry, title: "First" });
    const second = await alice.mutation(api.handbook.create, { ...valueEntry, title: "Second" });
    const login = await alice.mutation(api.handbook.create, { ...secretEntry, credentials: LOGIN });

    await alice.mutation(api.handbook.reorder, { ids: [second, first] });
    await alice.mutation(api.handbook.setPinned, { id: first, pinned: true });
    const listed = await alice.query(api.handbook.entries, {});
    expect(listed.map((entry) => entry.title)).toEqual(["Second", "First", "Console login"]);
    expect(listed[1].pinned).toBe(true);

    await alice.mutation(api.handbook.remove, { id: login });
    expect(await alice.query(api.handbook.entries, {})).toHaveLength(2);
    expect(await t.run((ctx) => ctx.db.query("handbookSecrets").collect())).toEqual([]);
  });

  test("adds starter entries once and never seeds a secret", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    expect(await alice.mutation(api.handbook.addStarterEntries, {})).toBe(1);
    expect(await alice.mutation(api.handbook.addStarterEntries, {})).toBe(0);
    const entries = await alice.query(api.handbook.entries, {});
    expect(entries.map((entry) => entry.kind)).toEqual(["guide"]);
    const guide = entries.find((entry) => entry.kind === "guide");
    expect(guide?.variants?.map((variant) => variant.label)).toEqual(["New method (24H2+)", "Older builds"]);
    expect(guide?.variants?.[0].steps[2].command).toBe("start ms-cxh:localonly");
    expect(await t.run((ctx) => ctx.db.query("handbookSecrets").collect())).toEqual([]);
    expect(await asUser(t, "bob").query(api.handbook.entries, {})).toEqual([]);
  });
});
