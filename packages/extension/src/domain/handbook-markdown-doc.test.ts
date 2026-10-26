import { describe, expect, test } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { docToMarkdown, markdownToDoc } from "./handbook-markdown-doc";

const roundTrip = (source: string) => docToMarkdown(markdownToDoc(source));
const text = (value: string, ...marks: string[]): JSONContent => ({ type: "text", text: value, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const p = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });

describe("handbook note Markdown ↔ editor document", () => {
  test("round-trips every supported block", () => {
    const source = [
      "# Opening",
      "## Before opening",
      "- [ ] Turn on the lights\n- [x] Count the drawer",
      "1. Unlock the door\n2. Flip the sign",
      "- Keys are in the back",
      "Call the manager if anything is **missing**.\nAsk for *Sam* or see [the policy](https://example.com/policy_(retail)).",
      "Run `start ms-cxh:localonly` and ***never*** skip it.",
    ].join("\n\n");
    expect(roundTrip(source)).toBe(source);
  });

  test("normalizes spacing and numbering into the canonical form", () => {
    expect(roundTrip("## Title\n- [ ] one\n- [ ] two\n\n\n3) three\n7. four")).toBe("## Title\n\n- [ ] one\n- [ ] two\n\n1. three\n2. four");
  });

  test("keeps checklist and bullet items in one list as separate editor lists", () => {
    const parsed = markdownToDoc("- [ ] Check\n- Note\n- [x] Done");
    expect(parsed.content?.map((block) => block.type)).toEqual(["taskList", "bulletList", "taskList"]);
    expect(docToMarkdown(parsed)).toBe("- [ ] Check\n\n- Note\n\n- [x] Done");
    // Blank lines don't split a Markdown list, so the note still renders one list.
    expect(roundTrip(docToMarkdown(parsed))).toBe(docToMarkdown(parsed));
  });

  test("moves spaces outside markers and keeps marks open across neighbours", () => {
    expect(docToMarkdown(doc(p(text("Call "), text("the manager ", "bold"), text("now"))))).toBe("Call **the manager** now");
    expect(docToMarkdown(doc(p(text("bold ", "bold"), text("both", "bold", "italic"), text(" plain"))))).toBe("**bold *both*** plain");
    expect(docToMarkdown(doc(p(text("   ", "bold"), text("x"))))).toBe("x");
  });

  test("flattens nested lists and drops empty blocks", () => {
    const nested = doc(
      { type: "paragraph" },
      { type: "bulletList", content: [{ type: "listItem", content: [p(text("Parent")), { type: "bulletList", content: [{ type: "listItem", content: [p(text("Child"))] }] }] }] },
      { type: "heading", attrs: { level: 2 } },
    );
    expect(docToMarkdown(nested)).toBe("- Parent\n- Child");
  });

  test("an empty note is one empty paragraph", () => {
    expect(markdownToDoc("")).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(docToMarkdown(markdownToDoc(""))).toBe("");
  });
});
