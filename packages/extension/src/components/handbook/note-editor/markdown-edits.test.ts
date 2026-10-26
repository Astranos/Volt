import { describe, expect, test } from "vitest";
import { parseHandbookMarkdown, parseInline } from "../../../domain/handbook-markdown";
import {
  isInlineMarkerActive,
  markdownLink,
  normalizeLinkHref,
  numberedPrefix,
  replaceLinePrefix,
  slashQueryStart,
  toggleInlineMarker,
  toggleTaskMarker,
  type InlineMarker,
} from "./markdown-edits";

// Applies toggleInlineMarker to `text`, where [ and ] mark the selection, and returns
// the result with the new selection marked the same way.
function toggle(marked: string, marker: InlineMarker) {
  const from = marked.indexOf("[");
  const to = marked.indexOf("]") - 1;
  const text = marked.replace("[", "").replace("]", "");
  const { changes, selection } = toggleInlineMarker(text, from, to, marker);
  let result = text;
  for (const change of [...changes].reverse()) result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  return `${result.slice(0, selection.anchor)}[${result.slice(selection.anchor, selection.head)}]${result.slice(selection.head)}`;
}

describe("replaceLinePrefix", () => {
  test("swaps any block prefix for the new one", () => {
    expect(replaceLinePrefix("Lock up", "# ")).toBe("# Lock up");
    expect(replaceLinePrefix("## Lock up", "### ")).toBe("### Lock up");
    expect(replaceLinePrefix("- [x] Lock up", "1. ")).toBe("1. Lock up");
    expect(replaceLinePrefix("12. Lock up", "- [ ] ")).toBe("- [ ] Lock up");
    expect(replaceLinePrefix("  * Lock up", "- ")).toBe("- Lock up");
  });

  test("Text removes the prefix", () => {
    expect(replaceLinePrefix("# Lock up", "")).toBe("Lock up");
    expect(replaceLinePrefix("- [ ] ", "")).toBe("");
  });

  test("leaves text that only looks like a prefix", () => {
    expect(replaceLinePrefix("#hashtag", "- ")).toBe("- #hashtag");
    expect(replaceLinePrefix("-5 degrees", "")).toBe("-5 degrees");
  });
});

describe("numberedPrefix", () => {
  test("continues the list above", () => {
    expect(numberedPrefix("2. Call the manager")).toBe("3. ");
    expect(numberedPrefix("Some text")).toBe("1. ");
    expect(numberedPrefix("")).toBe("1. ");
  });
});

describe("slashQueryStart", () => {
  test("finds a slash at the line start or after a space", () => {
    expect(slashQueryStart("/")).toBe(0);
    expect(slashQueryStart("/head")).toBe(0);
    expect(slashQueryStart("Call the manager /che")).toBe(17);
    expect(slashQueryStart("- /")).toBe(2);
  });

  test("ignores slashes inside words and URLs", () => {
    expect(slashQueryStart("and/or")).toBeNull();
    expect(slashQueryStart("https://")).toBeNull();
    expect(slashQueryStart("/head ")).toBeNull();
  });
});

describe("toggleTaskMarker", () => {
  test("checks and unchecks a task", () => {
    expect(toggleTaskMarker("- [ ] Count the drawer")).toEqual({ offset: 3, insert: "x" });
    expect(toggleTaskMarker("* [X] Count the drawer")).toEqual({ offset: 3, insert: " " });
  });

  test("ignores lines that aren't tasks", () => {
    expect(toggleTaskMarker("- Count the drawer")).toBeNull();
    expect(toggleTaskMarker("[ ] Count the drawer")).toBeNull();
  });
});

describe("toggleInlineMarker", () => {
  test("wraps the selection", () => {
    expect(toggle("Write it in the [daily log].", "**")).toBe("Write it in the **[daily log]**.");
    expect(toggle("[Returns] note", "*")).toBe("*[Returns]* note");
    expect(toggle("Use [SKU-12]", "`")).toBe("Use `[SKU-12]`");
  });

  test("keeps markers next to the words, not the selected spaces", () => {
    expect(toggle("Write it in the[ daily log ].", "**")).toBe("Write it in the **[daily log]** .");
  });

  test("unwraps markers just outside the selection", () => {
    expect(toggle("the **[daily log]**.", "**")).toBe("the [daily log].");
    expect(toggle("the _[Returns]_ note", "*")).toBe("the [Returns] note");
    expect(toggle("the `[SKU]`", "`")).toBe("the [SKU]");
  });

  test("unwraps markers at the edges of the selection", () => {
    expect(toggle("the [**daily log**].", "**")).toBe("the [daily log].");
    expect(toggle("the [*Returns*] note", "*")).toBe("the [Returns] note");
  });

  test("italic and bold combine instead of unwrapping each other", () => {
    expect(toggle("**[log]**", "*")).toBe("***[log]***");
    expect(toggle("***[log]***", "*")).toBe("**[log]**");
    expect(toggle("***[log]***", "**")).toBe("*[log]*");
    expect(toggle("*[log]*", "**")).toBe("***[log]***");
  });

  test("an empty selection inserts a pair to type into", () => {
    expect(toggle("Note []", "**")).toBe("Note **[]**");
  });

  test("the result parses as the formatting it shows", () => {
    expect(parseInline("***log***")).toEqual([{ type: "bold", children: [{ type: "italic", children: [{ type: "text", text: "log" }] }] }]);
  });
});

describe("isInlineMarkerActive", () => {
  test("reports whether the selection is wrapped", () => {
    expect(isInlineMarkerActive("the **daily log**.", 6, 15, "**")).toBe(true);
    expect(isInlineMarkerActive("the **daily log**.", 6, 15, "*")).toBe(false);
    expect(isInlineMarkerActive("the daily log.", 4, 13, "**")).toBe(false);
  });
});

describe("normalizeLinkHref", () => {
  test("adds https:// when there's no scheme", () => {
    expect(normalizeLinkHref(" example.com/returns ")).toBe("https://example.com/returns");
    expect(normalizeLinkHref("localhost:3000")).toBe("https://localhost:3000");
  });

  test("keeps the schemes notes can link", () => {
    expect(normalizeLinkHref("http://example.com")).toBe("http://example.com");
    expect(normalizeLinkHref("mailto:help@example.com")).toBe("mailto:help@example.com");
    expect(normalizeLinkHref("tel:3135550100")).toBe("tel:3135550100");
  });

  test("percent-encodes spaces and parentheses", () => {
    expect(normalizeLinkHref("https://example.com/Policy (retail) v2")).toBe("https://example.com/Policy%20%28retail%29%20v2");
  });

  test("rejects links a note wouldn't render", () => {
    expect(normalizeLinkHref("")).toBeNull();
    expect(normalizeLinkHref("https://")).toBeNull();
    expect(normalizeLinkHref("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkHref("ftp://example.com")).toBeNull();
  });

  test("the link it builds renders as a link", () => {
    const href = normalizeLinkHref("example.com/Policy (retail)")!;
    expect(parseHandbookMarkdown(markdownLink("the policy", href))).toEqual([
      { type: "paragraph", lines: [[{ type: "link", href, children: [{ type: "text", text: "the policy" }] }]] },
    ]);
  });
});
