import { describe, expect, test } from "vitest";
import { draftFor, draftToSave, emptyField, handbookErrorText, switchFieldFormat, switchKind } from "./draft";
import type { HandbookEntry } from "./entries";

function entry(fields: Partial<HandbookEntry> & Pick<HandbookEntry, "kind">): HandbookEntry {
  return {
    _id: "entry1" as HandbookEntry["_id"],
    title: "Entry",
    category: "Store info",
    comment: undefined,
    value: undefined,
    valueFormat: undefined,
    showInList: undefined,
    fields: undefined,
    username: undefined,
    body: undefined,
    variants: undefined,
    secretPreview: undefined,
    pinned: false,
    order: 0,
    updatedAt: 0,
    updatedByName: "Sam",
    ...fields,
  };
}

describe("draftToSave", () => {
  test("a quick value saves its fields and mirrors the first into value/valueFormat", () => {
    const draft = draftFor(null, {
      title: "Store",
      category: "Store info",
      fields: [
        { ...emptyField("phone"), label: "Phone", value: "313-555-0100" },
        { ...emptyField("address"), label: " Address ", address: { street: "1 Main St", city: "Taylor", state: "MI", zip: "48180" } },
      ],
    });
    const { content, credentials } = draftToSave(draft, null);
    expect(content.value).toBe("313-555-0100");
    expect(content.valueFormat).toBe("phone");
    expect(content.fields).toEqual([
      { label: "Phone", value: "313-555-0100", format: "phone" },
      { label: "Address", value: "1 Main St, Taylor, MI 48180", format: "address" },
    ]);
    expect(credentials).toBeUndefined();
  });

  test("other kinds send an empty field list so the server doesn't re-add moved values", () => {
    const { content } = draftToSave(draftFor(null, { kind: "note", title: "N", category: "C", body: "Hello" }), null);
    expect(content.fields).toEqual([]);
    expect(content.body).toBe("Hello");
    expect(content.value).toBeUndefined();
  });

  test("editing a login with blank username and password keeps the saved login", () => {
    const saved = entry({ kind: "secret", secretPreview: "x" });
    expect(draftToSave(draftFor(saved), saved).credentials).toBeUndefined();
    expect(draftToSave(draftFor(saved, { secret: "new" }), saved).credentials).toEqual({ username: undefined, secret: "new" });
  });

  test("a new login always sends credentials", () => {
    expect(draftToSave(draftFor(null, { kind: "secret", username: "me" }), null).credentials).toEqual({ username: "me", secret: "" });
  });

  test("older notes on a quick value are sent back; a value's empty body is not", () => {
    const older = entry({ kind: "value", value: "1", body: "Old note" });
    expect(draftToSave(draftFor(older), older).content.body).toBe("Old note");
    const plain = entry({ kind: "value", value: "1" });
    expect(draftToSave(draftFor(plain, { body: "stray" }), plain).content.body).toBeUndefined();
  });

  test("guide steps split key combos and drop empty extras", () => {
    const draft = draftFor(null, {
      kind: "guide",
      variants: [{ label: "", warning: "", steps: [{ text: "Open it", keys: "Shift + F10", command: "", tip: "" }] }],
    });
    expect(draftToSave(draft, null).content.variants).toEqual([
      { label: "", warning: undefined, steps: [{ text: "Open it", keys: ["Shift", "F10"], command: undefined, tip: undefined }] },
    ]);
  });
});

describe("switching types", () => {
  test("a quick value turned into a note carries its values into the note", () => {
    const draft = draftFor(null, { fields: [{ ...emptyField(), label: "Wi-Fi", value: "store-guest" }], body: "Ask a manager" });
    expect(switchKind(draft, "note").body).toBe("Wi-Fi: store-guest\n\nAsk a manager");
    // Switching again doesn't add the same line twice.
    expect(switchKind({ ...switchKind(draft, "note"), kind: "value" }, "note").body).toBe("Wi-Fi: store-guest\n\nAsk a manager");
  });

  test("a value's type change keeps what was typed", () => {
    const address = switchFieldFormat({ ...emptyField(), value: "1 Main St, Taylor, MI 48180" }, "address");
    expect(address.address).toEqual({ street: "1 Main St", city: "Taylor", state: "MI", zip: "48180" });
    expect(switchFieldFormat(address, "text").value).toBe("1 Main St, Taylor, MI 48180");
    expect(switchFieldFormat({ ...emptyField(), value: "3135550100" }, "phone").value).toBe("313-555-0100");
  });
});

test("server error codes read as sentences", () => {
  expect(handbookErrorText(new Error("[CONVEX M] Uncaught ConvexError: HANDBOOK_TITLE_REQUIRED"))).toBe("Title required.");
  expect(handbookErrorText(new Error("HANDBOOK_PAGE_TOO_LONG"))).toBe("Note too long.");
  expect(handbookErrorText(new Error("Network down"))).toBe("Network down");
});
