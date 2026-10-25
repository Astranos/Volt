import { describe, expect, test } from "vitest";
import { addressLines, displayValue, formatAddress, formatPhoneInput, parseAddress, valueFormatOf } from "./handbook-format";
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
  });
});
