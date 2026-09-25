import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";

import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type Settings = { payload: string; revision: number; updatedAt: number };
const getSettings = makeFunctionReference<"query", Record<string, never>, Settings | null>(
  "extensionSettings:get",
);
const saveSettings = makeFunctionReference<
  "mutation",
  { payload: string; expectedRevision: number | null; expectedSubject: string },
  Settings
>("extensionSettings:save");

function asUser(t: ReturnType<typeof convexTest>, name: string) {
  return t.withIdentity({ subject: name, tokenIdentifier: `clerk|${name}` });
}

describe("extension settings sync", () => {
  test("requires authentication and isolates account settings", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const bob = asUser(t, "bob");

    await expect(t.query(getSettings, {})).rejects.toThrow("AUTHENTICATION_REQUIRED");
    await expect(t.mutation(saveSettings, { payload: "{}", expectedRevision: null, expectedSubject: "alice" }))
      .rejects.toThrow("AUTHENTICATION_REQUIRED");

    const saved = await alice.mutation(saveSettings, {
      payload: '{"highlightActions":["copy"]}',
      expectedRevision: null,
      expectedSubject: "alice",
    });
    expect(saved.revision).toBe(1);
    expect(await alice.query(getSettings, {})).toEqual(saved);
    expect(await bob.query(getSettings, {})).toBeNull();

    const bobSaved = await bob.mutation(saveSettings, { payload: "{}", expectedRevision: null, expectedSubject: "bob" });
    expect(bobSaved.revision).toBe(1);
    expect(await alice.query(getSettings, {})).toEqual(saved);
    await expect(bob.mutation(saveSettings, {
      payload: '{"from":"alice"}',
      expectedRevision: bobSaved.revision,
      expectedSubject: "alice",
    })).rejects.toThrow("SETTINGS_ACCOUNT_CHANGED");
    expect(await t.run((ctx) => ctx.db.query("extensionSettings").collect())).toHaveLength(2);
  });

  test("rejects stale writes without changing the latest settings", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const first = await alice.mutation(saveSettings, { payload: '{"value":1}', expectedRevision: null, expectedSubject: "alice" });
    const second = await alice.mutation(saveSettings, {
      payload: '{"value":2}', expectedRevision: first.revision, expectedSubject: "alice",
    });
    expect(second.revision).toBe(2);
    await expect(alice.mutation(saveSettings, { payload: '{"value":3}', expectedRevision: 1, expectedSubject: "alice" }))
      .rejects.toThrow("SETTINGS_CONFLICT");
    await expect(alice.mutation(saveSettings, { payload: '{"value":3}', expectedRevision: null, expectedSubject: "alice" }))
      .rejects.toThrow("SETTINGS_CONFLICT");
    expect(await alice.query(getSettings, {})).toEqual(second);
  });

  test("validates JSON object payload and UTF-8 size", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    for (const payload of ["not JSON", "null", "[]", '"text"']) {
      await expect(alice.mutation(saveSettings, { payload, expectedRevision: null, expectedSubject: "alice" }))
        .rejects.toThrow("INVALID_SETTINGS_PAYLOAD");
    }
    await expect(alice.mutation(saveSettings, {
      payload: JSON.stringify({ value: "🙂".repeat(16_384) }),
      expectedRevision: null,
      expectedSubject: "alice",
    })).rejects.toThrow("SETTINGS_TOO_LARGE");
    expect(await alice.query(getSettings, {})).toBeNull();
  });

  test("rejects invalid or oversized action lists", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    for (const actions of [
      ["ebay", "google-upc", "pricecharting", "google-search"],
      ["ebay", "ebay"],
      ["unknown"],
    ]) {
      await expect(alice.mutation(saveSettings, {
        payload: JSON.stringify({ contextMenu: { selectionPopupActions: actions } }),
        expectedRevision: null,
        expectedSubject: "alice",
      })).rejects.toThrow("INVALID_SETTINGS_PAYLOAD");
    }
  });

  test("accepts custom actions in both selection action lists", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const customAction = {
      kind: "custom",
      id: "my-reference",
      label: "Reference",
      iconName: "book-open",
      iconCodepoint: 0xf0123,
      url: "https://example.com/search?q=",
    };
    const payload = JSON.stringify({ contextMenu: {
      selectionPopupActions: ["look-up", customAction],
      contextMenuSelectionActions: [customAction],
    } });

    const saved = await alice.mutation(saveSettings, {
      payload,
      expectedRevision: null,
      expectedSubject: "alice",
    });
    expect(saved.payload).toBe(payload);
  });

  test("rejects malformed custom actions and duplicate action keys", async () => {
    const t = convexTest(schema, modules);
    const alice = asUser(t, "alice");
    const customAction = {
      kind: "custom",
      id: "my-reference",
      label: "Reference",
      iconName: "book-open",
      iconCodepoint: 0xf0123,
      url: "https://example.com/search?q=",
    };
    const invalidActions: unknown[][] = [
      [{ ...customAction, id: "  " }],
      [{ ...customAction, id: "x".repeat(65) }],
      [{ ...customAction, label: "x".repeat(49) }],
      [{ ...customAction, iconName: "Book-Open" }],
      [{ ...customAction, iconName: "x".repeat(81) }],
      [{ ...customAction, iconCodepoint: 0xeffff }],
      [{ ...customAction, iconCodepoint: 0x100000 }],
      [{ ...customAction, iconCodepoint: 0xf0123 + 0.5 }],
      [{ ...customAction, url: "javascript:alert(1)" }],
      [{ ...customAction, url: "https://user:pass@example.com/" }],
      [{ ...customAction, url: `https://example.com/${"x".repeat(2048)}` }],
      [customAction, { ...customAction }],
      ["look-up", { ...customAction, id: "look-up" }],
    ];

    for (const actions of invalidActions) {
      await expect(alice.mutation(saveSettings, {
        payload: JSON.stringify({ contextMenu: { selectionPopupActions: actions } }),
        expectedRevision: null,
        expectedSubject: "alice",
      })).rejects.toThrow("INVALID_SETTINGS_PAYLOAD");
    }
    expect(await alice.query(getSettings, {})).toBeNull();
  });
});
