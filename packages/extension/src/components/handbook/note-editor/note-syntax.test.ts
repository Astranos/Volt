import { describe, expect, test } from "vitest";
import { parseHandbookMarkdown, parseInline } from "../../../domain/handbook-markdown";
import { inlineSpans, inlineText, parseNoteLine } from "./note-syntax";

const spans = (text: string) => inlineSpans(text).map((span) => ({
  type: span.type,
  source: text.slice(span.from, span.to),
  content: text.slice(span.contentFrom, span.contentTo),
}));

describe("inlineSpans", () => {
  test("maps the renderer's formatting back to source offsets", () => {
    expect(spans("Write it in the **daily log** or `SKU-12`.")).toEqual([
      { type: "bold", source: "**daily log**", content: "daily log" },
      { type: "code", source: "`SKU-12`", content: "SKU-12" },
    ]);
    expect(spans("Call [the **manager**](tel:3135550100) or _Returns_")).toEqual([
      { type: "bold", source: "**manager**", content: "manager" },
      { type: "link", source: "[the **manager**](tel:3135550100)", content: "the **manager**" },
      { type: "italic", source: "_Returns_", content: "Returns" },
    ]);
  });

  test("bold and italic together are bold around italic", () => {
    expect(spans("***log***")).toEqual([
      { type: "italic", source: "*log*", content: "log" },
      { type: "bold", source: "***log***", content: "*log*" },
    ]);
  });

  test("finds nothing the renderer prints literally", () => {
    expect(spans("foo*bar* and sku_code_1")).toEqual([]);
    expect(spans("*a **b** c*")).toEqual([{ type: "bold", source: "**b**", content: "b" }]);
    expect(spans(`**${"x".repeat(301)}**`)).toEqual([]);
    expect(spans("[a](javascript:alert)")).toEqual([]);
  });

  test("offsets stay right after literal markers", () => {
    const text = "2*3 = [6] and `x` *y*";
    for (const span of inlineSpans(text)) expect(text[span.to - 1]).toMatch(/[`*]/);
    expect(inlineText(text)).toBe("2*3 = [6] and x y");
  });
});

describe("parseNoteLine", () => {
  // Every line kind, checked against how the renderer reads the same line.
  const lines = [
    "# Title", "### Small", "#### Four", "#", "# ", "#hashtag", "  ## Indented  ",
    "- item", "* item", "+ item", "- [ ] task", "- [x] done", "- [X]", "- [ ]", "- [x]foo", "- # foo",
    "1. one", "12) twelve", "1.no", "plain **bold** text", "-5 degrees",
  ];

  test.each(lines)("%j matches the renderer", (line) => {
    const parsed = parseNoteLine(line);
    const [block] = parseHandbookMarkdown(line);
    const content = parsed ? parseInline(line.slice(parsed.content[0], parsed.content[1])) : null;
    if (!block) return expect(parsed).toBeNull();
    if (block.type === "heading") {
      expect(parsed).toMatchObject({ kind: "heading", level: block.level });
      expect(content).toEqual(block.children);
    } else if (block.type === "paragraph") {
      expect(parsed?.kind).toBe("paragraph");
      expect(content).toEqual(block.lines[0]);
    } else {
      expect(parsed?.kind).toBe(block.ordered ? "numbered" : "bullet");
      expect(content).toEqual(block.items[0].children);
      const checked = parsed?.kind === "bullet" && parsed.task ? parsed.task.checked : undefined;
      expect(checked).toBe(block.items[0].checked);
    }
  });

  test("gives marker offsets in the raw line", () => {
    expect(parseNoteLine("  - [x] Lock up")).toEqual({
      kind: "bullet", marker: [2, 3], task: { marker: [4, 7], checked: true }, content: [8, 15],
    });
    expect(parseNoteLine("## Before opening")).toEqual({ kind: "heading", level: 2, marker: [0, 3], content: [3, 17] });
  });
});
