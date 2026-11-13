import { describe, expect, test } from "vitest";
import { handbookLocation, handbookSearch, validateHandbookSearch } from "./handbook-search";

describe("handbook URL", () => {
  test("reads views and filters from the query string", () => {
    expect(handbookLocation(validateHandbookSearch({}))).toEqual({ view: { kind: "list" }, filter: { kind: "all" } });
    expect(handbookLocation(validateHandbookSearch({ entry: "abc", edit: "1", category: "Logins" }))).toEqual({
      view: { kind: "edit", id: "abc" },
      filter: { kind: "category", category: "Logins" },
    });
    expect(handbookLocation(validateHandbookSearch({ new: 1, pinned: "1" }))).toEqual({ view: { kind: "new" }, filter: { kind: "pinned" } });
  });

  test("ignores junk values", () => {
    expect(validateHandbookSearch({ entry: "  ", edit: "yes", category: 5 })).toEqual({
      entry: undefined, edit: undefined, new: undefined, category: undefined, pinned: undefined,
    });
  });

  test("round-trips every view", () => {
    for (const location of [
      { view: { kind: "list" }, filter: { kind: "all" } },
      { view: { kind: "article", id: "e1" }, filter: { kind: "pinned" } },
      { view: { kind: "edit", id: "e1" }, filter: { kind: "category", category: "Setup guides" } },
      { view: { kind: "new" }, filter: { kind: "all" } },
    ] as const) {
      expect(handbookLocation(validateHandbookSearch(handbookSearch(location)))).toEqual(location);
    }
  });
});
