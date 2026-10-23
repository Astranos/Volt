import { describe, expect, test } from "vitest";
import type { HandbookEntry } from "../../domain/handbook";
import { handbookCommandMatches, wantsHandbookAction } from "./HandbookCommandGroup";

const entry = (index: number, title: string): HandbookEntry => ({
  _id: `id${index}` as HandbookEntry["_id"],
  kind: "value",
  title,
  category: "Store info",
  note: undefined,
  value: `value ${index}`,
  body: undefined,
  variants: undefined,
  secretPreview: undefined,
  pinned: false,
  order: index,
  updatedAt: 0,
  updatedByName: "Sam",
});

describe("handbook command results", () => {
  const entries = Array.from({ length: 8 }, (_, index) => entry(index, `Store item ${index}`));

  test("matches only with a query and caps the result count", () => {
    expect(handbookCommandMatches(entries, "  ")).toEqual([]);
    expect(handbookCommandMatches(entries, "store")).toHaveLength(6);
    expect(handbookCommandMatches(entries, "item 3").map((item) => item.title)).toEqual(["Store item 3"]);
  });

  test("offers the open action with results or when the query names it", () => {
    expect(wantsHandbookAction("hand", [])).toBe(true);
    expect(wantsHandbookAction("sidepanel", [])).toBe(true);
    expect(wantsHandbookAction("zzz", [])).toBe(false);
    expect(wantsHandbookAction("st", [entries[0]])).toBe(true);
    expect(wantsHandbookAction("h", [])).toBe(false);
  });
});
