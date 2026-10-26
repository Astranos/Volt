// Obsidian-style live preview: Markdown markers are hidden (or swapped for a bullet or a
// checkbox) except in the construct the cursor is in, where they show faded so they can
// be edited. The document text never changes; this is all decoration.
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { isSafeHandbookLink } from "../../../domain/handbook-markdown";
import { toggleTaskMarker } from "./markdown-edits";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

const hidden = Decoration.replace({});
const faded = Decoration.mark({ class: "cm-md-mark" });
const linkText = Decoration.mark({ class: "cm-md-link" });
const doneText = Decoration.mark({ class: "cm-md-done" });
const listNumber = Decoration.mark({ class: "cm-md-number" });
// Notes store heading levels 1-3; "####" isn't a heading there, so it stays plain text.
const headingLines: Record<string, Decoration> = {
  ATXHeading1: Decoration.line({ class: "cm-md-h1" }),
  ATXHeading2: Decoration.line({ class: "cm-md-h2" }),
  ATXHeading3: Decoration.line({ class: "cm-md-h3" }),
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

function decorate(state: EditorState, node: SyntaxNode, out: Range<Decoration>[]) {
  const markers = (from: number, to: number, active: boolean) => {
    if (from < to) out.push((active ? faded : hidden).range(from, to));
  };
  const headingLine = headingLines[node.name];
  if (headingLine) {
    const line = state.doc.lineAt(node.from);
    out.push(headingLine.range(line.from));
    const mark = node.getChild("HeaderMark");
    // "# " goes as a whole; closing "#"s stay, as notes render them as text.
    if (mark) markers(mark.from, Math.min(mark.to + 1, node.to), touches(state, line.from, line.to));
    return;
  }
  switch (node.name) {
    case "Emphasis":
    case "StrongEmphasis":
    case "InlineCode": {
      const active = touches(state, node.from, node.to);
      for (const mark of node.getChildren(node.name === "InlineCode" ? "CodeMark" : "EmphasisMark")) markers(mark.from, mark.to, active);
      return;
    }
    case "Link": {
      // Only what notes render as a link: [text](safe-url), no title.
      const [open, close] = node.getChildren("LinkMark");
      const url = node.getChild("URL");
      if (!open || !close || !url || node.getChild("LinkTitle") || open.to === close.from) return;
      if (!isSafeHandbookLink(state.sliceDoc(url.from, url.to))) return;
      const active = touches(state, node.from, node.to);
      out.push(linkText.range(open.to, close.from));
      markers(open.from, open.to, active);
      markers(close.from, node.to, active);
      return;
    }
    case "ListItem": {
      const mark = node.getChild("ListMark");
      if (!mark) return;
      if (node.parent?.name === "OrderedList") {
        out.push(listNumber.range(mark.from, mark.to));
        return;
      }
      // Notes only treat "-" and "*" as bullets.
      if (!/^[-*]$/.test(state.sliceDoc(mark.from, mark.to))) return;
      const line = state.doc.lineAt(mark.from);
      const task = node.getChild("Task");
      const taskMarker = task?.getChild("TaskMarker");
      if (task && taskMarker) {
        const checked = state.sliceDoc(taskMarker.from, taskMarker.to).toLowerCase() === "[x]";
        if (touches(state, mark.from, taskMarker.to)) out.push(faded.range(mark.from, taskMarker.to));
        else out.push(checkboxes[Number(checked)].range(mark.from, taskMarker.to));
        const textStart = taskMarker.to + /^\s*/.exec(state.sliceDoc(taskMarker.to, line.to))![0].length;
        const textEnd = Math.min(task.to, line.to);
        if (checked && textStart < textEnd) out.push(doneText.range(textStart, textEnd));
      } else if (!touches(state, line.from, line.to)) {
        out.push(bullet.range(mark.from, mark.to));
      }
    }
  }
}

function buildDecorations(view: EditorView) {
  const out: Range<Decoration>[] = [];
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({ from, to, enter: (node) => decorate(view.state, node.node, out) });
  }
  return Decoration.set(out, true);
}

const livePreviewPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = buildDecorations(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.decorations = buildDecorations(update.view);
    }
  }
}, { decorations: (plugin) => plugin.decorations });

const inlineStyles = HighlightStyle.define([
  { tag: tags.strong, class: "cm-md-strong" },
  { tag: tags.emphasis, class: "cm-md-em" },
  { tag: tags.monospace, class: "cm-md-code" },
]);

export const livePreview = [livePreviewPlugin, syntaxHighlighting(inlineStyles)];
