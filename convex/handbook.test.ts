import { convexTest } from "convex-test";
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
    await expect(t.query(api.handbook.list, {})).rejects.toThrow("AUTHENTICATION_REQUIRED");
    await expect(t.mutation(api.handbook.create, valueEntry)).rejects.toThrow("AUTHENTICATION_REQUIRED");
    await expect(t.mutation(api.handbook.revealSecret, { id })).rejects.toThrow("AUTHENTICATION_REQUIRED");
    await expect(t.mutation(api.handbook.remove, { id })).rejects.toThrow("AUTHENTICATION_REQUIRED");
    await expect(t.mutation(api.handbook.addStarterEntries, {})).rejects.toThrow("AUTHENTICATION_REQUIRED");
  });

  test("lists return a masked preview and never the secret", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    expect(await alice.query(api.handbook.list, {})).toEqual([]);
    const id = await alice.mutation(api.handbook.create, { ...secretEntry, credentials: LOGIN });

    const [entry] = await alice.query(api.handbook.list, {});
    expect(entry).toMatchObject({ _id: id, kind: "secret", title: "Console login", updatedByName: "alice Example" });
    expect(entry.secretPreview).toBe("test••• · ••••••");
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(LOGIN.secret);
    expect(serialized).not.toContain(LOGIN.username);

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
