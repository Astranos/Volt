import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Extension, type ChainedCommands, type Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { Bold, Code, Heading1, Heading2, Heading3, Italic, Link2, List, ListChecks, ListOrdered, Pilcrow, Unlink } from "lucide-react";
import { isSafeHandbookLink } from "../../domain/handbook-markdown";
import { docToMarkdown, markdownToDoc } from "../../domain/handbook-markdown-doc";
import { cn } from "../../lib/utils";

type SlashItem = { label: string; hint: string; icon: ReactNode; keywords: string; run: (chain: ChainedCommands) => boolean };
type SlashMenu = { items: SlashItem[]; index: number; rect: DOMRect | null; select: (item: SlashItem) => void };

const SLASH_ITEMS: SlashItem[] = [
  { label: "Text", hint: "", icon: <Pilcrow />, keywords: "paragraph plain", run: (chain) => chain.setParagraph().run() },
  { label: "Heading 1", hint: "#", icon: <Heading1 />, keywords: "title h1 big", run: (chain) => chain.setHeading({ level: 1 }).run() },
  { label: "Heading 2", hint: "##", icon: <Heading2 />, keywords: "subtitle h2 section", run: (chain) => chain.setHeading({ level: 2 }).run() },
  { label: "Heading 3", hint: "###", icon: <Heading3 />, keywords: "h3 small", run: (chain) => chain.setHeading({ level: 3 }).run() },
  { label: "Bulleted list", hint: "-", icon: <List />, keywords: "bullet unordered ul", run: (chain) => chain.toggleBulletList().run() },
  { label: "Numbered list", hint: "1.", icon: <ListOrdered />, keywords: "ordered steps ol", run: (chain) => chain.toggleOrderedList().run() },
  { label: "Checklist", hint: "[]", icon: <ListChecks />, keywords: "todo task checkbox", run: (chain) => chain.toggleTaskList().run() },
];

/** "/" opens a block menu, like Notion. Menu state is handed to React through `onChange`. */
function slashCommand(onChange: (menu: SlashMenu | null) => void) {
  return Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: "/",
        items: ({ query }) => SLASH_ITEMS.filter((item) => `${item.label} ${item.keywords}`.toLowerCase().includes(query.toLowerCase())),
        command: ({ editor, range, props }) => props.run(editor.chain().focus().deleteRange(range)),
        render: () => {
          let menu: SlashMenu | null = null;
          let dismissed = false;
          const show = (props: SuggestionProps<SlashItem, SlashItem>, index: number) => {
            menu = dismissed || !props.items.length
              ? null
              : { items: props.items, index: Math.min(index, props.items.length - 1), rect: props.clientRect?.() ?? null, select: props.command };
            onChange(menu);
          };
          let last: SuggestionProps<SlashItem, SlashItem> | null = null;
          return {
            onStart: (props) => { last = props; dismissed = false; show(props, 0); },
            onUpdate: (props) => { last = props; show(props, 0); },
            onKeyDown: ({ event }) => {
              if (!menu || !last) return false;
              const count = menu.items.length;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                show(last, (menu.index + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
                return true;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                menu.select(menu.items[menu.index]);
                return true;
              }
              if (event.key === "Escape") {
                dismissed = true;
                show(last, 0);
                return true;
              }
              return false;
            },
            onExit: () => { menu = null; last = null; onChange(null); },
          };
        },
      })];
    },
  });
}

// Pages store flat lists, so Tab doesn't indent inside a list (and still leaves the editor elsewhere).
const FlatLists = Extension.create({
  name: "flatLists",
  priority: 1000,
  addKeyboardShortcuts() {
    const inList = () => this.editor.isActive("listItem") || this.editor.isActive("taskItem");
    return { Tab: inList, "Shift-Tab": inList };
  },
});

/** "example.com" becomes "https://example.com"; anything the page renderer wouldn't link is rejected. */
function normalizeLink(input: string) {
  const value = input.trim();
  const href = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  return isSafeHandbookLink(href) ? href : null;
}

function SelectionMenu({ editor }: { editor: Editor }) {
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      code: current.isActive("code"),
      link: current.isActive("link"),
    }),
  });
  const applyLink = (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const href = normalizeLink(linkDraft ?? "");
    if (!href) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setLinkDraft(null);
  };
  const markButton = (label: string, icon: ReactNode, isActive: boolean, toggle: () => void) => (
    <button type="button" aria-label={label} title={label} aria-pressed={isActive} className={cn(isActive && "is-active")} onClick={toggle}>
      {icon}
    </button>
  );

  return (
    <BubbleMenu editor={editor} className="handbook-bubble-menu" options={{ placement: "top", offset: 8, onHide: () => setLinkDraft(null) }}>
      {linkDraft !== null ? (
        // A div, not a nested <form>: the page editor is already inside one.
        <div className="handbook-bubble-link" onKeyDown={(event) => {
          if (event.key === "Enter") applyLink(event);
          if (event.key === "Escape") setLinkDraft(null);
        }}>
          <input autoFocus value={linkDraft} onChange={(event) => setLinkDraft(event.target.value)} placeholder="Paste a link" aria-label="Link address" />
          <button type="button" onClick={applyLink} disabled={!normalizeLink(linkDraft)}>Link</button>
        </div>
      ) : (
        <>
          {markButton("Bold", <Bold />, active.bold, () => editor.chain().focus().toggleBold().run())}
          {markButton("Italic", <Italic />, active.italic, () => editor.chain().focus().toggleItalic().run())}
          {markButton("Code", <Code />, active.code, () => editor.chain().focus().toggleCode().run())}
          {active.link
            ? markButton("Remove link", <Unlink />, true, () => editor.chain().focus().extendMarkRange("link").unsetLink().run())
            : markButton("Link", <Link2 />, false, () => setLinkDraft(""))}
        </>
      )}
    </BubbleMenu>
  );
}

const SLASH_MENU_HEIGHT = 300;

function SlashMenuList({ menu }: { menu: SlashMenu }) {
  if (!menu.rect) return null;
  return createPortal(
    <div
      className="handbook-slash-menu"
      role="listbox"
      aria-label="Insert block"
      // Opens above the line when it wouldn't fit below.
      style={menu.rect.bottom + 6 + SLASH_MENU_HEIGHT > window.innerHeight
        ? { left: menu.rect.left, bottom: window.innerHeight - menu.rect.top + 6 }
        : { left: menu.rect.left, top: menu.rect.bottom + 6 }}
    >
      {menu.items.map((item, index) => (
        <button
          key={item.label}
          type="button"
          role="option"
          aria-selected={index === menu.index}
          className={cn(index === menu.index && "is-active")}
          // Keep focus (and the selection) in the editor.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => menu.select(item)}
        >
          <span className="handbook-slash-icon">{item.icon}</span>
          <span className="handbook-slash-label">{item.label}</span>
          {item.hint ? <kbd>{item.hint}</kbd> : null}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** Notion-style page editor: formatting shows as you type, saved as the handbook's Markdown subset. */
export function PageEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [slashMenu, setSlashMenu] = useState<SlashMenu | null>(null);
  const emitted = useRef(value);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true, isAllowedUri: (url) => isSafeHandbookLink(url) },
      }),
      TaskList,
      TaskItem.configure({ nested: false }),
      Placeholder.configure({ placeholder: "Write, or type / for headings, lists, and checklists…" }),
      FlatLists,
      slashCommand(setSlashMenu),
    ],
    content: markdownToDoc(value),
    editorProps: { attributes: { class: "handbook-md handbook-page-rich", "aria-label": "Page", "aria-multiline": "true" } },
    onUpdate: ({ editor: current }) => {
      emitted.current = docToMarkdown(current.getJSON());
      onChange(emitted.current);
    },
  });

  // The draft can change outside the editor (switching an entry to a page carries its values over).
  useEffect(() => {
    if (editor && value !== emitted.current) {
      emitted.current = value;
      editor.commands.setContent(markdownToDoc(value), { emitUpdate: false });
    }
  }, [editor, value]);

  return (
    <div className="handbook-field">
      <span className="handbook-field-label">Page</span>
      <div className="handbook-page-rich-frame" onClick={(event) => event.target === event.currentTarget && editor?.commands.focus("end")}>
        <EditorContent editor={editor} />
        {editor ? <SelectionMenu editor={editor} /> : null}
      </div>
      {slashMenu ? <SlashMenuList menu={slashMenu} /> : null}
      <span className="handbook-field-hint">Type / for headings, lists, and checklists, or Markdown like ## and - [ ]. Select text to bold, italicize, or link it.</span>
    </div>
  );
}
