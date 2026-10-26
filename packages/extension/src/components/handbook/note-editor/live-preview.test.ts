import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { buildDecorations } from "./live-preview";

// The decorations over the whole doc, as "kind from-to" strings (marks and lines by class).
// `cursor` defaults to the end of a trailing plain line, away from everything else.
function decorations(doc: string, cursor?: number) {
  const text = cursor === undefined ? `${doc}\nend` : doc;
  const state = EditorState.create({ doc: text, selection: EditorSelection.cursor(cursor ?? text.length) });
  const out: string[] = [];
  buildDecorations(state, [{ from: 0, to: state.doc.length }]).between(0, state.doc.length, (from, to, decoration) => {
    const spec: { class?: string; widget?: unknown } = decoration.spec;
    if (!spec.class && state.doc.lineAt(from).number !== state.doc.lineAt(to).number) {
      throw new Error(`Replace decoration ${from}-${to} crosses a line break`);
    }
    const kind = spec.class ?? (spec.widget ? spec.widget.constructor.name : "hidden");
    out.push(`${kind} ${JSON.stringify(text.slice(from, to))}`);
  });
  return out;
}

describe("buildDecorations", () => {
  test("never replaces across a line break", () => {
    for (const doc of ["- foo\n\n  [ ] bar", "-\n  [ ] foo", "[a](\nhttps://x.com)", "*a\nb*", "- [ ]\n- [x]\n"]) {
      expect(() => decorations(doc)).not.toThrow();
    }
  });

  test("leaves multi-line links and emphasis alone, like the renderer", () => {
    expect(decorations("[a](\nhttps://x.com)")).toEqual([]);
    expect(decorations("*a\nb*")).toEqual([]);
  });

  test("hides markers away from the cursor", () => {
    expect(decorations("## Before opening")).toEqual(["cm-md-h2 \"\"", "hidden \"## \""]);
    expect(decorations("Write **daily log**.")).toEqual(["hidden \"**\"", "cm-md-strong \"daily log\"", "hidden \"**\""]);
    expect(decorations("Call [313](tel:313).")).toEqual(["hidden \"[\"", "cm-md-link \"313\"", "hidden \"](tel:313)\""]);
  });

  test("fades markers where the cursor is", () => {
    expect(decorations("Write **daily log**.", 9)).toEqual(["cm-md-mark \"**\"", "cm-md-strong \"daily log\"", "cm-md-mark \"**\""]);
    expect(decorations("## Before", 4)).toEqual(["cm-md-h2 \"\"", "cm-md-mark \"## \""]);
  });

  test("lists: checkboxes, bullets, and numbers", () => {
    expect(decorations("- [x] Lock up")).toEqual(["CheckboxWidget \"- [x]\"", "cm-md-done \"Lock up\""]);
    expect(decorations("- [ ]")).toEqual(["CheckboxWidget \"- [ ]\""]);
    expect(decorations("- [ ] Count", 3)).toEqual(["cm-md-mark \"- [ ]\""]);
    expect(decorations("- Lock up")).toEqual(["BulletWidget \"-\""]);
    expect(decorations("- Lock up", 5)).toEqual([]);
    expect(decorations("2. Call")).toEqual(["cm-md-number \"2.\""]);
  });

  test("styles only what the renderer renders", () => {
    expect(decorations("foo*bar*")).toEqual([]);
    expect(decorations("*a **b** c*")).toEqual(["hidden \"**\"", "cm-md-strong \"b\"", "hidden \"**\""]);
    expect(decorations(`**${"x".repeat(301)}**`)).toEqual([]);
    expect(decorations("- # foo")).toEqual(["BulletWidget \"-\""]);
    expect(decorations("# ")).toEqual([]);
    expect(decorations("#### Four")).toEqual([]);
    expect(decorations("[a](javascript:x)")).toEqual([]);
  });
});
