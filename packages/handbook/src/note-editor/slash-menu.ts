// "/" at the start of a line (or after a space) opens a menu that turns the line into a
// heading, a list item, or plain text by swapping its Markdown prefix.
import { autocompletion, pickedCompletion, type Completion, type CompletionSource } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { linePrefixLength, numberedPrefix, slashQueryStart } from "./markdown-edits";
import { noteIcons } from "./icons";

type SlashItem = { label: string; detail?: string; prefix: (previousLine: string) => string };

export const SLASH_ITEMS: SlashItem[] = [
  { label: "Text", prefix: () => "" },
  { label: "Heading 1", detail: "#", prefix: () => "# " },
  { label: "Heading 2", detail: "##", prefix: () => "## " },
  { label: "Heading 3", detail: "###", prefix: () => "### " },
  { label: "Bulleted list", detail: "-", prefix: () => "- " },
  { label: "Numbered list", detail: "1.", prefix: numberedPrefix },
  { label: "Checklist", detail: "- [ ]", prefix: () => "- [ ] " },
];

function applyItem(item: SlashItem) {
  // `from` is just after the "/".
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    const { doc } = view.state;
    const line = doc.lineAt(from);
    const previousLine = line.number > 1 ? doc.line(line.number - 1).text : "";
    const changes = view.state.changes([
      { from: line.from, to: line.from + linePrefixLength(line.text), insert: item.prefix(previousLine) },
      { from: from - 1, to },
    ]);
    view.dispatch({
      changes,
      selection: { anchor: changes.mapPos(to, 1) },
      annotations: pickedCompletion.of(completion),
      userEvent: "input.complete",
    });
  };
}

const OPTIONS: Completion[] = SLASH_ITEMS.map((item) => ({ label: item.label, detail: item.detail, apply: applyItem(item) }));

const slashSource: CompletionSource = (context) => {
  const match = context.matchBefore(/\/\w*$/);
  if (!match) return null;
  const line = context.state.doc.lineAt(context.pos);
  if (slashQueryStart(context.state.sliceDoc(line.from, context.pos)) === null) return null;
  // Matched against what's typed after the "/".
  return { from: match.from + 1, options: OPTIONS, validFor: /^\w*$/ };
};

const order = (completion: Completion) => OPTIONS.findIndex((option) => option.label === completion.label);

export const slashMenu = autocompletion({
  override: [slashSource],
  icons: false,
  tooltipClass: () => "handbook-slash-menu",
  compareCompletions: (a, b) => order(a) - order(b),
  addToOptions: [{
    position: 20,
    render: (completion, state) => {
      const icon = document.createElement("span");
      icon.className = "handbook-slash-icon";
      const glyph = state.facet(noteIcons)(completion.label);
      if (glyph) icon.append(glyph);
      return icon;
    },
  }],
});
