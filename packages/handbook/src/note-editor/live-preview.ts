// Obsidian-style live preview: Markdown markers are hidden (or swapped for a bullet or a
// checkbox) except in the span the cursor is in, where they show faded so they can be
// edited. The document text never changes; this is all decoration.
//
// What gets styled comes from the note renderer's own rules (see note-syntax.ts), line by
// line, so the editor shows exactly what a saved note will. Every range is within one
// line: a replace decoration from a plugin can't cross a line break.
import type { EditorState, Line, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { toggleTaskMarker } from "./markdown-edits";
import { inlineSpans, parseNoteLine, type InlineSpanType } from "./note-syntax";

const hidden = Decoration.replace({});
const faded = Decoration.mark({ class: "cm-md-mark" });
const doneText = Decoration.mark({ class: "cm-md-done" });
const listNumber = Decoration.mark({ class: "cm-md-number" });
const headingLines = [1, 2, 3].map((level) => Decoration.line({ class: `cm-md-h${level}` }));
const spanStyles: Record<InlineSpanType, Decoration> = {
  bold: Decoration.mark({ class: "cm-md-strong" }),
  italic: Decoration.mark({ class: "cm-md-em" }),
  code: Decoration.mark({ class: "cm-md-code" }),
  link: Decoration.mark({ class: "cm-md-link" }),
};

class BulletWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const bullet = document.createElement("span");
    bullet.className = "cm-md-bullet";
    bullet.textContent = "•";
    return bullet;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) { super(); }
  eq(other: CheckboxWidget) { return other.checked === this.checked; }
  toDOM(view: EditorView) {
    const box = document.createElement("span");
    box.className = this.checked ? "cm-md-check is-checked" : "cm-md-check";
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(this.checked));
    box.setAttribute("aria-label", this.checked ? "Uncheck" : "Check");
    // mousedown, not click, so neither focus nor the selection moves.
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const line = view.state.doc.lineAt(view.posAtDOM(box));
      const toggle = toggleTaskMarker(line.text);
      if (!toggle) return;
      const from = line.from + toggle.offset;
      view.dispatch({ changes: { from, to: from + 1, insert: toggle.insert }, userEvent: "input" });
    });
    return box;
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() });
const checkboxes = [false, true].map((checked) => Decoration.replace({ widget: new CheckboxWidget(checked) }));

// The cursor (or a selection) touches from..to, ends included.
const touches = (state: EditorState, from: number, to: number) =>
  state.selection.ranges.some((range) => range.from <= to && range.to >= from);

function decorateLine(state: EditorState, line: Line, out: Range<Decoration>[]) {
  const parsed = parseNoteLine(line.text);
  if (!parsed) return;
  const at = (offset: number) => line.from + offset;
  // The one guard against ranges that leave the line, for anything that replaces text.
  const inLine = (from: number, to: number) => from >= line.from && to <= line.to && from < to;
  const replace = (decoration: Decoration, from: number, to: number) => {
    if (inLine(from, to)) out.push(decoration.range(from, to));
  };
  const mark = (decoration: Decoration, from: number, to: number) => {
    if (from < to) out.push(decoration.range(from, to));
  };
  // Markers: hidden, or faded while the cursor is in what they format.
  const markers = (from: number, to: number, active: boolean) => {
    if (active) mark(faded, from, to);
    else replace(hidden, from, to);
  };
  const onLine = touches(state, line.from, line.to);

  if (parsed.kind === "heading") {
    out.push(headingLines[parsed.level - 1].range(line.from));
    markers(at(parsed.marker[0]), at(parsed.marker[1]), onLine);
  } else if (parsed.kind === "numbered") {
    mark(listNumber, at(parsed.marker[0]), at(parsed.marker[1]));
  } else if (parsed.kind === "bullet" && parsed.task) {
    const from = at(parsed.marker[0]);
    const to = at(parsed.task.marker[1]);
    if (touches(state, from, to)) mark(faded, from, to);
    else replace(checkboxes[Number(parsed.task.checked)], from, to);
    if (parsed.task.checked) mark(doneText, at(parsed.content[0]), at(parsed.content[1]));
  } else if (parsed.kind === "bullet" && !onLine) {
    replace(bullet, at(parsed.marker[0]), at(parsed.marker[1]));
  }

  const [contentFrom, contentTo] = parsed.content;
  for (const span of inlineSpans(line.text.slice(contentFrom, contentTo), at(contentFrom))) {
    const active = touches(state, span.from, span.to);
    mark(spanStyles[span.type], span.contentFrom, span.contentTo);
    markers(span.from, span.contentFrom, active);
    markers(span.contentTo, span.to, active);
  }
}

/** The live-preview decorations for the given ranges (the visible ones, in the editor). */
export function buildDecorations(state: EditorState, ranges: readonly { from: number; to: number }[]): DecorationSet {
  const out: Range<Decoration>[] = [];
  let lastLine = 0;
  for (const { from, to } of ranges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      if (line.number > lastLine) decorateLine(state, line, out);
      lastLine = line.number;
      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
}

export const livePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = buildDecorations(view.state, view.visibleRanges); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged) {
      this.decorations = buildDecorations(update.state, update.view.visibleRanges);
    }
  }
}, { decorations: (plugin) => plugin.decorations });
