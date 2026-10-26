import { describe, expect, test } from "vitest";
import { markdownPlainText, parseHandbookMarkdown } from "./handbook-markdown";

describe("parseHandbookMarkdown", () => {
  test("an empty checklist item is a task, not literal text", () => {
    expect(parseHandbookMarkdown("- [ ]\n- [x]\n- [ ] ")).toEqual([
      { type: "list", ordered: false, items: [{ checked: false, children: [] }, { checked: true, children: [] }, { checked: false, children: [] }] },
    ]);
  });

  test("a task marker still needs a space before its text", () => {
    expect(parseHandbookMarkdown("- [x] Lock up\n- [x]foo")).toEqual([
      {
        type: "list",
        ordered: false,
        items: [
          { checked: true, children: [{ type: "text", text: "Lock up" }] },
          { checked: undefined, children: [{ type: "text", text: "[x]foo" }] },
        ],
      },
    ]);
  });
});

describe("markdownPlainText", () => {
  test("leaves empty checklist items out of previews", () => {
    expect(markdownPlainText("- a\n- [ ]\n- b")).toBe("a · b");
    expect(markdownPlainText("- [ ]\n- b")).toBe("b");
  });
});
