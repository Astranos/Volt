import { describe, expect, test } from "vitest";
import { addressLines, displayValue, entryFields, fieldDisplayValue, formatAddress, formatPhoneInput, formatPhoneTyping, hasFieldRows, parseAddress, recognizeAddress, valueFormatOf } from "./handbook-format";
import { markdownPlainText, parseHandbookMarkdown } from "./handbook-markdown";

describe("phone formatting", () => {
  test("adds dashes as digits are typed", () => {
    expect(["3", "313", "3136", "313639", "3136390", "3136390861"].map(formatPhoneInput))
      .toEqual(["3", "313", "313-6", "313-639", "313-639-0", "313-639-0861"]);
    expect(formatPhoneInput("(313) 639 0861")).toBe("313-639-0861");
    expect(formatPhoneInput("13136390861")).toBe("1-313-639-0861");
  });

  test("keeps an extension and leaves non-US input alone", () => {
    expect(formatPhoneInput("7342876611x6")).toBe("734-287-6611 x6");
    expect(formatPhoneInput("734-287-6611 ext 6")).toBe("734-287-6611 x6");
    expect(formatPhoneInput("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatPhoneInput("Call front desk")).toBe("Call front desk");
    expect(formatPhoneInput("123456789012")).toBe("123456789012");
  });
});

describe("phone typing", () => {
  // Types each character at the end, like a person would, following the caret.
  const type = (text: string) => [...text].reduce((value, char) => formatPhoneTyping(value + char, value.length + 1).value, "");

  test("an extension typed at the end lands after the x", () => {
    expect(type("7342876611x6")).toBe("734-287-6611 x6");
    expect(type("3136390861ext12")).toBe("313-639-0861 x12");
  });

  test("an edit in the middle keeps the caret after the same digit", () => {
    expect(formatPhoneTyping("313-639", 5)).toEqual({ value: "313-639", caret: 5 });
    expect(formatPhoneTyping("3136390861", 4)).toEqual({ value: "313-639-0861", caret: 5 });
  });
});

describe("addresses", () => {
  test("joins parts into one clean line", () => {
    expect(formatAddress({ street: "9058 Telegraph Rd", city: "Taylor", state: "mi", zip: "48180" }))
      .toBe("9058 Telegraph Rd, Taylor, MI 48180");
    expect(formatAddress({ street: "9058 Telegraph Rd", city: "", state: "", zip: "" })).toBe("9058 Telegraph Rd");
  });

  test("parses loosely typed addresses", () => {
    expect(parseAddress("9058 Telegraph Rd, Taylor MI, 48180"))
      .toEqual({ street: "9058 Telegraph Rd", city: "Taylor", state: "MI", zip: "48180" });
    expect(parseAddress("9058 Telegraph Rd, Taylor, MI 48180-1234"))
      .toEqual({ street: "9058 Telegraph Rd", city: "Taylor", state: "MI", zip: "48180-1234" });
    expect(parseAddress("Right off Wick")).toEqual({ street: "Right off Wick", city: "", state: "", zip: "" });
    expect(addressLines("9058 Telegraph Rd, Taylor MI, 48180")).toEqual(["9058 Telegraph Rd", "Taylor, MI 48180"]);
  });

  test("never rewrites values that aren't clearly an address", () => {
    const entry = (title: string, value: string) => ({ kind: "value" as const, title, value, valueFormat: undefined });
    for (const [title, value] of [
      ["Store address", "9058 Telegraph Rd 48180"],
      ["Store address", "9058 Telegraph Rd, Taylor 48180"],
      ["Spare key location", "Shelf 10234"],
      ["Store location", "https://maps.google.com/?cid=123456789012345"],
      ["Email address", "mi01@paymore.com"],
      ["IP address", "192.168.1.20"],
    ]) {
      expect(valueFormatOf(entry(title, value))).toBe("text");
      expect(displayValue(entry(title, value))).toBe(value);
    }
    // Even an entry saved as an address keeps an unrecognized value exactly as typed.
    expect(displayValue({ kind: "value", title: "Store address", value: "Shelf 10234", valueFormat: "address" })).toBe("Shelf 10234");
    expect(addressLines("Shelf 10234")).toEqual(["Shelf 10234"]);
    // Long or adversarial values are never addresses, and checking them stays fast.
    const started = performance.now();
    expect(recognizeAddress(`1, ${" ".repeat(1_900)}!`)).toBeNull();
    expect(performance.now() - started).toBeLessThan(50);
    expect(parseAddress("123 Main St, Apt 4, Springfield, IL 62701"))
      .toEqual({ street: "123 Main St, Apt 4", city: "Springfield", state: "IL", zip: "62701" });
  });

  test("infers formats for entries saved before formats existed", () => {
    const entry = (title: string, value: string) => ({ kind: "value" as const, title, value, valueFormat: undefined });
    expect(valueFormatOf(entry("Store Address", "9058 Telegraph Rd, Taylor MI, 48180"))).toBe("address");
    expect(valueFormatOf(entry("Store Phone", "313-639-0861"))).toBe("phone");
    expect(valueFormatOf(entry("Wipe checklist", "Sign out of iCloud"))).toBe("text");
    expect(displayValue(entry("Store Address", "9058 Telegraph Rd, Taylor MI, 48180"))).toBe("9058 Telegraph Rd, Taylor, MI 48180");
  });
});

describe("page markdown", () => {
  test("parses headings, lists, checklists, and inline styles", () => {
    expect(parseHandbookMarkdown("## Opening\n- [x] Lights on\n- [ ] Count drawer\n1. Unlock\n\nCall **Juan** at [store](tel:3136390861).")).toEqual([
      { type: "heading", level: 2, children: [{ type: "text", text: "Opening" }] },
      {
        type: "list",
        ordered: false,
        items: [
          { checked: true, children: [{ type: "text", text: "Lights on" }] },
          { checked: false, children: [{ type: "text", text: "Count drawer" }] },
        ],
      },
      { type: "list", ordered: true, items: [{ children: [{ type: "text", text: "Unlock" }] }] },
      {
        type: "paragraph",
        lines: [[
          { type: "text", text: "Call " },
          { type: "bold", children: [{ type: "text", text: "Juan" }] },
          { type: "text", text: " at " },
          { type: "link", href: "tel:3136390861", children: [{ type: "text", text: "store" }] },
          { type: "text", text: "." },
        ]],
      },
    ]);
  });

  test("never turns unsafe links into links", () => {
    expect(parseHandbookMarkdown("[x](javascript:alert(1))")).toEqual([
      { type: "paragraph", lines: [[{ type: "text", text: "[x](javascript:alert(1))" }]] },
    ]);
    expect(markdownPlainText("# Title\n- **one**\n- `two`")).toBe("Title · one · two");
    expect(parseHandbookMarkdown("[empty](https://)")).toEqual([
      { type: "paragraph", lines: [[{ type: "text", text: "[empty](https://)" }]] },
    ]);
  });

  test("keeps underscores and asterisks inside words, and balanced link parentheses", () => {
    expect(markdownPlainText("sku_code_123 and 2*3*4 and https://x.com/my_page_here")).toBe("sku_code_123 and 2*3*4 and https://x.com/my_page_here");
    expect(parseHandbookMarkdown("See [policy](https://en.wikipedia.org/wiki/Policy_(retail)).")[0]).toEqual({
      type: "paragraph",
      lines: [[
        { type: "text", text: "See " },
        { type: "link", href: "https://en.wikipedia.org/wiki/Policy_(retail)", children: [{ type: "text", text: "policy" }] },
        { type: "text", text: "." },
      ]],
    });
    expect(markdownPlainText("_real italics_ and *these*")).toBe("real italics and these");
    // Bold then Italic on the same word makes ***word***, which renders as both.
    expect(parseHandbookMarkdown("a ***word*** b")[0]).toEqual({
      type: "paragraph",
      lines: [[
        { type: "text", text: "a " },
        { type: "bold", children: [{ type: "italic", children: [{ type: "text", text: "word" }] }] },
        { type: "text", text: " b" },
      ]],
    });
    expect(markdownPlainText("**_both_** and ***both***")).toBe("both and both");
    // The toolbar's Italic wraps in asterisks, which works around underscores inside words.
    expect(parseHandbookMarkdown("*sku_code_123*")[0]).toEqual({
      type: "paragraph",
      lines: [[{ type: "italic", children: [{ type: "text", text: "sku_code_123" }] }]],
    });
  });

  test("parses pages full of unmatched markers quickly", () => {
    const started = performance.now();
    for (const marker of ["[", "*", "_", "`", "**"]) parseHandbookMarkdown(marker.repeat(15_000));
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe("entry fields", () => {
  const base = { kind: "value" as const, title: "Store", value: "313-555-0100", valueFormat: undefined, fields: undefined };

  test("an entry saved before fields existed is one unlabeled field with its inferred format", () => {
    expect(entryFields({ ...base, title: "Store phone" })).toEqual([{ value: "313-555-0100", format: "phone" }]);
    expect(hasFieldRows({ ...base, title: "Store phone" })).toBe(false);
  });

  test("several or labeled values are shown as labeled rows", () => {
    const fields = [
      { label: "Phone", value: "313-555-0100", format: "phone" as const },
      { label: "Address", value: "1234 Main St, Springfield MI, 48180", format: "address" as const },
    ];
    expect(hasFieldRows({ ...base, fields })).toBe(true);
    expect(entryFields({ ...base, fields }).map(fieldDisplayValue)).toEqual(["313-555-0100", "1234 Main St, Springfield, MI 48180"]);
    expect(hasFieldRows({ ...base, fields: [{ label: "Phone", value: "1" }] })).toBe(true);
    expect(hasFieldRows({ kind: "secret", title: "PSN", value: undefined, valueFormat: undefined, fields: undefined })).toBe(true);
  });
});
