import { describe, expect, test } from "vitest";
import {
  filterHandbook,
  formatHandbookUpdated,
  groupHandbook,
  guideSummary,
  matchesHandbookQuery,
  parseKeyCombo,
  type HandbookEntry,
} from "./handbook";

let nextId = 0;
function entry(fields: Partial<HandbookEntry> & Pick<HandbookEntry, "kind" | "title" | "category">): HandbookEntry {
  nextId += 1;
  return {
    _id: `entry${nextId}` as HandbookEntry["_id"],
    note: undefined,
    value: undefined,
    valueFormat: undefined,
    showInList: undefined,
    fields: undefined,
    username: undefined,
    body: undefined,
    variants: undefined,
    secretPreview: undefined,
    pinned: false,
    order: nextId,
    updatedAt: 0,
    updatedByName: "Sam",
    ...fields,
  };
}

const phone = entry({ kind: "value", title: "Store phone", category: "Store info", value: "555-0100" });
const address = entry({ kind: "value", title: "Store address", category: "Store info", note: "Right off Main", value: "1 Main St", pinned: true });
const login = entry({ kind: "secret", title: "Console login", category: "Logins", secretPreview: "user••• · ••••••" });
const guide = entry({
  kind: "guide",
  title: "Skip sign-in",
  category: "Setup guides",
  variants: [
    { label: "New", steps: [{ text: "Open a prompt", keys: ["Shift", "F10"] }, { text: "Run it", command: "start ms-cxh:localonly" }] },
    { label: "Old", steps: [{ text: "Run it", command: "OOBE\\BYPASSNRO" }] },
  ],
});
const entries = [phone, address, login, guide];

describe("handbook domain", () => {
  test("searches titles, notes, values and guide steps", () => {
    expect(filterHandbook(entries, "addr", { kind: "all" })).toEqual([address]);
    expect(filterHandbook(entries, "main", { kind: "all" })).toEqual([address]);
    expect(filterHandbook(entries, "bypassnro", { kind: "all" })).toEqual([guide]);
    expect(filterHandbook(entries, "store 0100", { kind: "all" })).toEqual([phone]);
  });

  test("never matches on a secret entry's masked preview", () => {
    expect(matchesHandbookQuery(login, "user")).toBe(false);
    expect(matchesHandbookQuery(login, "console")).toBe(true);
  });

  test("filters by pinned and category", () => {
    expect(filterHandbook(entries, "", { kind: "pinned" })).toEqual([address]);
    expect(filterHandbook(entries, "", { kind: "category", category: "Logins" })).toEqual([login]);
  });

  test("groups by category with pinned entries first", () => {
    expect(groupHandbook(entries).map((group) => [group.category, group.entries.map((item) => item.title)])).toEqual([
      ["Store info", ["Store address", "Store phone"]],
      ["Logins", ["Console login"]],
      ["Setup guides", ["Skip sign-in"]],
    ]);
  });

  test("follows the saved category order, with unlisted categories after in first-seen order", () => {
    expect(groupHandbook(entries, ["Setup guides", "Retired category"]).map((group) => group.category))
      .toEqual(["Setup guides", "Store info", "Logins"]);
  });

  test("summarizes guides and formats metadata", () => {
    expect(guideSummary(guide)).toBe("2 methods · start ms-cxh:localonly");
    expect(guideSummary({ ...guide, variants: guide.variants?.slice(1) })).toBe("1 step · OOBE\\BYPASSNRO");
    expect(parseKeyCombo(" Shift + Fn+F10 ")).toEqual(["Shift", "Fn", "F10"]);
    expect(formatHandbookUpdated({ updatedAt: 0, updatedByName: "Sam" }, 3 * 86_400_000)).toBe("Updated 3d ago by Sam");
  });
});
