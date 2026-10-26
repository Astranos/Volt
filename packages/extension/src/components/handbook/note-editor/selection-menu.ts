// The formatting toolbar over a selection: Bold, Italic, Code, and Link, which turns the
// toolbar into a link input. Also the Mod-b/i/e/k shortcuts for the same commands.
import { Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";
import { noteIcons } from "./icons";
import { isInlineMarkerActive, markdownLink, normalizeLinkHref, toggleInlineMarker, type InlineMarker } from "./markdown-edits";


const setFocused = StateEffect.define<boolean>();
const setLinking = StateEffect.define<boolean>();

// Markers don't span lines in notes, so formatting works within one line.
function lineSelection(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  return to <= line.to ? { line, from: from - line.from, to: to - line.from } : null;
}

const toggleMarker = (marker: InlineMarker) => (view: EditorView) => {
  const selection = lineSelection(view);
  if (!selection) return true;
  const { line } = selection;
  const result = toggleInlineMarker(line.text, selection.from, selection.to, marker);
  view.dispatch({
    changes: result.changes.map((change) => ({ ...change, from: line.from + change.from, to: line.from + change.to })),
    selection: { anchor: line.from + result.selection.anchor, head: line.from + result.selection.head },
    userEvent: "input",
  });
  return true;
};

const startLink = (view: EditorView) => {
  if (view.state.selection.main.empty || !lineSelection(view)) return false;
  view.dispatch({ effects: setLinking.of(true) });
  return true;
};

function applyLink(view: EditorView, input: string) {
  const href = normalizeLinkHref(input);
  if (!href) return;
  const { from, to } = view.state.selection.main;
  const insert = markdownLink(view.state.sliceDoc(from, to), href);
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, effects: setLinking.of(false), userEvent: "input" });
  view.focus();
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function linkInput(view: EditorView) {
  const wrap = element("div", "handbook-bubble-link");
  const input = element("input");
  input.placeholder = "Paste a link";
  input.setAttribute("aria-label", "Link address");
  const button = element("button");
  button.type = "button";
  button.textContent = "Link";
  button.disabled = true;
  const close = () => {
    view.dispatch({ effects: setLinking.of(false) });
    view.focus();
  };
  input.addEventListener("input", () => { button.disabled = !normalizeLinkHref(input.value); });
  input.addEventListener("keydown", (event) => {
    // Enter would otherwise submit the entry form the editor sits in.
    if (event.key === "Enter") {
      event.preventDefault();
      applyLink(view, input.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  // Clicking away (anywhere but back into the menu) cancels the link.
  input.addEventListener("blur", (event) => {
    if (event.relatedTarget instanceof Node && wrap.contains(event.relatedTarget)) return;
    queueMicrotask(() => {
      if (view.state.field(menuField, false)?.linking && !view.hasFocus) view.dispatch({ effects: setLinking.of(false) });
    });
  });
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => applyLink(view, input.value));
  wrap.append(input, button);
  return { dom: wrap, focus: () => input.focus() };
}

function menu(view: EditorView, linking: boolean) {
  const icon = view.state.facet(noteIcons);
  const dom = element("div", "handbook-bubble-menu");
  if (linking) {
    const link = linkInput(view);
    dom.append(link.dom);
    return { dom, mount: link.focus };
  }
  const selection = lineSelection(view);
  const button = (label: string, name: string, active: boolean, run: () => void) => {
    const node = element("button", active ? "is-active" : undefined);
    node.type = "button";
    node.title = label;
    node.setAttribute("aria-label", label);
    node.setAttribute("aria-pressed", String(active));
    const glyph = icon(name);
    if (glyph) node.append(glyph);
    // Keep focus and the selection in the editor.
    node.addEventListener("mousedown", (event) => event.preventDefault());
    node.addEventListener("click", run);
    return node;
  };
  const markerButton = (label: string, name: string, marker: InlineMarker) => button(
    label,
    name,
    Boolean(selection && isInlineMarkerActive(selection.line.text, selection.from, selection.to, marker)),
    () => toggleMarker(marker)(view),
  );
  dom.append(
    markerButton("Bold", "bold", "**"),
    markerButton("Italic", "italic", "*"),
    markerButton("Code", "code", "`"),
    button("Link", "link", false, () => startLink(view)),
  );
  return { dom };
}

type MenuState = { focused: boolean; linking: boolean; tooltip: Tooltip | null };

const menuField = StateField.define<MenuState>({
  create: () => ({ focused: false, linking: false, tooltip: null }),
  update(value, tr) {
    let { focused, linking } = value;
    let linkingChanged = false;
    for (const effect of tr.effects) {
      if (effect.is(setFocused)) focused = effect.value;
      if (effect.is(setLinking)) {
        linkingChanged = linking !== effect.value;
        linking = effect.value;
      }
    }
    // Editing or moving the selection drops an unfinished link.
    if ((tr.docChanged || tr.selection) && !tr.effects.some((effect) => effect.is(setLinking))) linking = false;
    const range = tr.state.selection.main;
    const line = tr.state.doc.lineAt(range.from);
    if (range.empty || range.to > line.to || !(focused || linking)) return { focused, linking: false, tooltip: null };
    if (value.tooltip && !linkingChanged && !tr.docChanged && !tr.selection) return { focused, linking, tooltip: value.tooltip };
    const tooltip: Tooltip = { pos: range.from, above: true, create: (view) => menu(view, linking) };
    return { focused, linking, tooltip };
  },
  provide: (field) => showTooltip.compute([field], (state) => state.field(field).tooltip),
});

export const selectionMenu = [
  menuField,
  EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
  Prec.high(keymap.of([
    { key: "Mod-b", run: toggleMarker("**") },
    { key: "Mod-i", run: toggleMarker("*") },
    { key: "Mod-e", run: toggleMarker("`") },
    { key: "Mod-k", run: startLink },
  ])),
];
