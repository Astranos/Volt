import { useEffect, useLayoutEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Bold, Code, Heading1, Heading2, Heading3, Italic, Link2, List, ListChecks, ListOrdered, Pilcrow, type LucideIcon } from "lucide-react";
import { externalChange, noteEditorExtensions } from "./note-editor/extensions";

// Rendered hidden once; the editor's menus clone these SVGs by name.
const ICONS: Record<string, LucideIcon> = {
  Text: Pilcrow,
  "Heading 1": Heading1,
  "Heading 2": Heading2,
  "Heading 3": Heading3,
  "Bulleted list": List,
  "Numbered list": ListOrdered,
  Checklist: ListChecks,
  bold: Bold,
  italic: Italic,
  code: Code,
  link: Link2,
};

/**
 * Obsidian-style note editor: the text is the note's Markdown, shown formatted with its
 * markers hidden except where the cursor is.
 */
export function NoteEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const iconsRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialValue = useRef(value);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    const icon = (name: string) => iconsRef.current?.querySelector(`[data-icon="${name}"] > svg`)?.cloneNode(true) ?? null;
    const view = new EditorView({
      parent: frameRef.current!,
      state: EditorState.create({
        doc: initialValue.current,
        extensions: noteEditorExtensions({ icon, onChange: (text) => onChangeRef.current(text) }),
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // The draft can change outside the editor (switching an entry to a note carries its values over).
  useEffect(() => {
    const view = viewRef.current;
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: externalChange.of(true) });
    }
  }, [value]);

  return (
    <div className="handbook-field">
      <span className="handbook-field-label">Note</span>
      <div
        ref={frameRef}
        className="handbook-page-rich-frame"
        onMouseDown={(event) => {
          if (event.target !== event.currentTarget || !viewRef.current) return;
          event.preventDefault();
          viewRef.current.focus();
          viewRef.current.dispatch({ selection: { anchor: viewRef.current.state.doc.length } });
        }}
      />
      <div ref={iconsRef} hidden>
        {Object.entries(ICONS).map(([name, Icon]) => <span key={name} data-icon={name}><Icon /></span>)}
      </div>
      <span className="handbook-field-hint">Type / for headings, lists, and checklists, or write Markdown like ## and - [ ]. Select text to bold, italicize, or link it.</span>
    </div>
  );
}
