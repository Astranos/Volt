import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { commonmarkLanguage, deleteMarkupBackward, insertNewlineContinueMarkupCommand, markdown } from "@codemirror/lang-markdown";
import { Annotation, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { TaskList } from "@lezer/markdown";
import { noteIcons, type IconFor } from "./icons";
import { livePreview } from "./live-preview";
import { selectionMenu } from "./selection-menu";
import { slashMenu } from "./slash-menu";

/** Marks a change that came from the `value` prop, so it isn't reported back. */
export const externalChange = Annotation.define<boolean>();

export function noteEditorExtensions({ icon, onChange }: { icon: IconFor; onChange: (value: string) => void }): Extension {
  return [
    // CommonMark plus task items: what notes render, without GFM's tables or strikethrough.
    markdown({ base: commonmarkLanguage, extensions: [TaskList], addKeymap: false, completeHTMLTags: false, pasteURLAsLink: false }),
    history(),
    Prec.high(keymap.of([
      // Continues "- ", "1. " and "- [ ] " on Enter; Enter on an empty item ends the list.
      { key: "Enter", run: insertNewlineContinueMarkupCommand({ nonTightLists: false }) },
      { key: "Backspace", run: deleteMarkupBackward },
    ])),
    // Tab isn't bound, so it still moves focus out of the editor.
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ "aria-label": "Note", spellcheck: "true" }),
    placeholder("Write, or type / for headings, lists, and checklists…"),
    noteIcons.of(icon),
    livePreview,
    slashMenu,
    selectionMenu,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !update.transactions.some((tr) => tr.annotation(externalChange))) onChange(update.state.doc.toString());
    }),
  ];
}
