import { describe, expect, it } from "vitest";
import type { DetailBlock } from "../catalog";
import { partitionListing } from "./listing-layout";

describe("listing layout", () => {
  it.each(["Cosmetic condition:", "COSMETIC", "Functionality Condition:", "Functionality", "Functional condition :"])("groups %s with its following content", (text) => {
    const blocks: DetailBlock[] = [
      { kind: "heading", text },
      { kind: "paragraph", text: "Minor scratches." },
      { kind: "list", items: ["Tested"] },
    ];
    expect(partitionListing(blocks)).toEqual({ conditionNotes: blocks, mainDetails: [] });
  });

  it("returns to main details at unrelated headings and preserves all blocks", () => {
    const introduction: DetailBlock = { kind: "paragraph", text: "Device" };
    const cosmetic: DetailBlock = { kind: "heading", text: "Cosmetic Condition" };
    const note: DetailBlock = { kind: "paragraph", text: "Light scratches" };
    const specifications: DetailBlock = { kind: "heading", text: "Specifications:" };
    const table: DetailBlock = { kind: "specifications", rows: [{ label: "Condition", value: "Used" }] };
    const functional: DetailBlock = { kind: "heading", text: "Functionality:" };
    const tested: DetailBlock = { kind: "paragraph", text: "Tested" };
    const included: DetailBlock = { kind: "heading", text: "Items included in this sale:" };
    const items: DetailBlock = { kind: "list", items: ["Phone"] };
    const result = partitionListing([introduction, cosmetic, note, specifications, table, functional, tested, included, items]);
    expect(result.conditionNotes).toEqual([cosmetic, note, functional, tested]);
    expect(result.mainDetails).toEqual([introduction, specifications, table, included, items]);
  });

  it("leaves ordinary condition headings and spec rows in main details without mutating input", () => {
    const blocks: DetailBlock[] = [
      { kind: "heading", text: "Condition" },
      { kind: "specifications", rows: [{ label: "Condition", value: "Used" }] },
      { kind: "heading", text: "Cosmetic accessories" },
    ];
    const before = structuredClone(blocks);
    const result = partitionListing(Object.freeze(blocks));
    expect(result).toEqual({ conditionNotes: [], mainDetails: before });
    expect(blocks).toEqual(before);
    expect(result.mainDetails).not.toBe(blocks);
    expect(result.mainDetails[0]).toBe(blocks[0]);
    expect(partitionListing([])).toEqual({ conditionNotes: [], mainDetails: [] });
  });
});
