import { describe, expect, test } from "vitest";
import { parseHandbookMarkdown } from "../../../domain/handbook-markdown";
import {
  canLinkText,
  inlineFormat,
  markdownLink,
  normalizeLinkHref,
  numberedPrefix,
  replaceLinePrefix,
  slashQueryStart,
  toggleTaskMarker,
  type InlineFormat,
} from "./markdown-edits";
import { inlineSpans } from "./note-syntax";

// Runs inlineFormat on `marked`, where « and » mark the selection. Returns the result with
// the new selection marked the same way, or null when the button would be disabled.
function toggle(marked: string, format: InlineFormat) {
  const from = marked.indexOf("«");
  const to = marked.indexOf("»") - 1;
  const text = marked.replace("«", "").replace("»", "");
  const { edit } = inlineFormat(text, from, to, format);
  if (!edit) return null;
  let result = text;
  const changes = [...edit.changes].sort((a, b) => b.from - a.from || b.to - a.to);
  for (const change of changes) result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  const { anchor, head } = edit.selection;
  return `${result.slice(0, anchor)}«${result.slice(anchor, head)}»${result.slice(head)}`;
}

const active = (marked: string, format: InlineFormat) =>
  inlineFormat(marked.replace("«", "").replace("»", ""), marked.indexOf("«"), marked.indexOf("»") - 1, format).active;

// The formatting the renderer finds in a line, as "type:text".
const formats = (text: string) => inlineSpans(text).map((span) => `${span.type}:${text.slice(span.contentFrom, span.contentTo)}`).sort();

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
    expect(replaceLinePrefix("- [x]", "## ")).toBe("## ");
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

describe("inlineFormat", () => {
  test("formats a line's content, never its heading or list prefix", () => {
    expect(toggle("«- foo»", "bold")).toBe("- **«foo»**");
    expect(toggle("«# Title»", "italic")).toBe("# *«Title»*");
    expect(toggle("«- [ ] task»", "bold")).toBe("- [ ] **«task»**");
    expect(toggle("«1. step»", "code")).toBe("1. `«step»`");
  });

  test("won't unwrap when that changes the line's kind or its visible text", () => {
    // "1. Intro" would become a numbered item; "x_a_b" would show its underscores.
    expect(toggle("**«1. Intro»**", "bold")).toBeNull();
    expect(toggle("x**_«a»_**b", "bold")).toBeNull();
  });

  test("an empty italic pair isn't offered inside a word", () => {
    expect(toggle("foo«»bar", "italic")).toBeNull();
    expect(toggle("foo «»bar", "italic")).toBeNull();
    expect(toggle("foo «» bar", "italic")).toBe("foo *«»* bar");
  });

  test("wraps the selection", () => {
    expect(toggle("Write it in the «daily log».", "bold")).toBe("Write it in the **«daily log»**.");
    expect(toggle("«Returns» note", "italic")).toBe("*«Returns»* note");
    expect(toggle("Use «SKU-12»", "code")).toBe("Use `«SKU-12»`");
  });

  test("keeps markers next to the words, not the selected spaces", () => {
    expect(toggle("Write it in the« daily log ».", "bold")).toBe("Write it in the **«daily log»** .");
  });

  test("unwraps a span selected with or without its markers", () => {
    expect(toggle("the **«daily log»**.", "bold")).toBe("the «daily log».");
    expect(toggle("the «**daily log**».", "bold")).toBe("the «daily log».");
    expect(toggle("the _«Returns»_ note", "italic")).toBe("the «Returns» note");
    expect(toggle("the «*Returns*» note", "italic")).toBe("the «Returns» note");
    expect(toggle("the `«SKU»`", "code")).toBe("the «SKU»");
  });

  test("a selection inside a span takes the formatting off the whole span", () => {
    expect(toggle("**«foo» bar**", "bold")).toBe("«foo» bar");
    expect(toggle("*foo «bar»*", "italic")).toBe("foo «bar»");
    expect(toggle("`a «b» c`", "code")).toBe("a «b» c");
  });

  test("selecting across several spans merges them instead of breaking them", () => {
    expect(toggle("«**a** and **b**»", "bold")).toBe("**«a and b»**");
    expect(toggle("«*a* and *b*»", "italic")).toBe("*«a and b»*");
    expect(toggle("«`a` and `b`»", "code")).toBe("`«a and b»`");
  });

  test("italic and bold combine instead of unwrapping each other", () => {
    expect(toggle("**«log»**", "italic")).toBe("***«log»***");
    expect(toggle("***«log»***", "italic")).toBe("**«log»**");
    expect(toggle("***«log»***", "bold")).toBe("*«log»*");
    expect(toggle("*«log»*", "bold")).toBe("***«log»***");
    expect(formats("***log***")).toEqual(["bold:*log*", "italic:log"]);
  });

  test("italic around bold switches to underscores, which can hold it", () => {
    expect(toggle("«a **b** c»", "italic")).toBe("_«a **b** c»_");
    expect(formats("_a **b** c_")).toEqual(["bold:b", "italic:a **b** c"]);
  });

  test("italic needs whole words", () => {
    expect(toggle("foo«bar»", "italic")).toBeNull();
    expect(toggle("«foo»bar", "italic")).toBeNull();
    expect(toggle("fo«ob»ar", "italic")).toBeNull();
  });

  test("does nothing when the result wouldn't render as that formatting", () => {
    expect(toggle("«a`b»", "code")).toBeNull();
    expect(toggle("«a_b*c»", "italic")).toBeNull();
    expect(toggle("«2*3»", "italic")).toBe("_«2*3»_");
    expect(toggle(`«${"x".repeat(301)}»`, "bold")).toBeNull();
  });

  test("an empty selection inserts a pair to type into", () => {
    expect(toggle("Note «»", "bold")).toBe("Note **«»**");
  });

  test("reports whether the selection is formatted", () => {
    expect(active("the **«daily log»**.", "bold")).toBe(true);
    expect(active("the **daily «log»**.", "bold")).toBe(true);
    expect(active("the **«daily log»**.", "italic")).toBe(false);
    expect(active("the «daily log».", "bold")).toBe(false);
  });
});

describe("link limits", () => {
  test("text and targets stay within what the renderer reads as a link", () => {
    expect(canLinkText("a".repeat(300))).toBe(true);
    expect(canLinkText("a".repeat(301))).toBe(false);
    expect(normalizeLinkHref(`https://example.com/${"a".repeat(1_980)}`)).not.toBeNull();
    expect(normalizeLinkHref(`https://example.com/${"a".repeat(2_000)}`)).toBeNull();
  });
});

describe("canLinkText", () => {
  test("rejects text the link syntax can't hold", () => {
    expect(canLinkText("the policy")).toBe(true);
    expect(canLinkText("item [1]")).toBe(false);
    expect(canLinkText("a]b")).toBe(false);
    expect(canLinkText("  ")).toBe(false);
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

  test("encodes other whitespace as UTF-8 and keeps existing escapes", () => {
    expect(normalizeLinkHref("example.com/a\u00a0b%20c")).toBe("https://example.com/a%C2%A0b%20c");
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
