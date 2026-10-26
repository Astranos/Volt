// Converts handbook page Markdown to and from the rich editor's document. Parsing goes
// through parseHandbookMarkdown, so the editor shows exactly what the page renders, and
// saving writes back the same small Markdown subset the side panel and search read.

import type { JSONContent } from "@tiptap/core";
import { parseHandbookMarkdown, type Inline } from "./handbook-markdown";

type Mark = NonNullable<JSONContent["marks"]>[number];

function inlineToDoc(nodes: Inline[], marks: Mark[] = []): JSONContent[] {
  return nodes.flatMap((node): JSONContent[] => {
    if (node.type === "text") return node.text ? [{ type: "text", text: node.text, ...(marks.length ? { marks } : {}) }] : [];
    if (node.type === "code") return [{ type: "text", text: node.text, marks: [...marks, { type: "code" }] }];
    const mark: Mark = node.type === "link" ? { type: "link", attrs: { href: node.href } } : { type: node.type };
    return inlineToDoc(node.children, [...marks, mark]);
  });
}

const paragraph = (content: JSONContent[]): JSONContent => ({ type: "paragraph", ...(content.length ? { content } : {}) });

export function markdownToDoc(source: string): JSONContent {
  const content = parseHandbookMarkdown(source).flatMap((block): JSONContent[] => {
    if (block.type === "heading") return [{ type: "heading", attrs: { level: block.level }, content: inlineToDoc(block.children) }];
    if (block.type === "paragraph") {
      return [paragraph(block.lines.flatMap((line, index) => [...(index ? [{ type: "hardBreak" }] : []), ...inlineToDoc(line)]))];
    }
    if (block.ordered) {
      return [{ type: "orderedList", content: block.items.map((item) => ({ type: "listItem", content: [paragraph(inlineToDoc(item.children))] })) }];
    }
    // One Markdown list can mix checklist and bullet items; the editor keeps them as separate lists.
    const runs: JSONContent[] = [];
    for (const item of block.items) {
      const task = item.checked !== undefined;
      const type = task ? "taskList" : "bulletList";
      const node: JSONContent = task
        ? { type: "taskItem", attrs: { checked: item.checked }, content: [paragraph(inlineToDoc(item.children))] }
        : { type: "listItem", content: [paragraph(inlineToDoc(item.children))] };
      const last = runs[runs.length - 1];
      if (last?.type === type) last.content!.push(node);
      else runs.push({ type, content: [node] });
    }
    return runs;
  });
  return { type: "doc", content: content.length ? content : [paragraph([])] };
}

// Outermost first, so a bold link is written [**text**](url) and code is innermost.
const MARK_ORDER = ["link", "bold", "italic", "code"];
const markKey = (mark: Mark) => (mark.type === "link" ? `link ${mark.attrs?.href}` : mark.type);
const opener = (mark: Mark) => (mark.type === "link" ? "[" : mark.type === "bold" ? "**" : mark.type === "italic" ? "*" : "`");
const closer = (mark: Mark) => (mark.type === "link" ? `](${mark.attrs?.href})` : opener(mark));

/**
 * Writes inline content, keeping marks open across neighbouring text and moving spaces
 * outside markers (`**bold** text`, never `**bold **text`), which the parser requires.
 */
function inlineToMarkdown(nodes: JSONContent[] = [], breaks = "\n"): string {
  let out = "";
  let open: Mark[] = [];
  let pendingSpace = "";
  const closeTo = (keep: number) => {
    out += open.slice(keep).reverse().map(closer).join("") + pendingSpace;
    open = open.slice(0, keep);
    pendingSpace = "";
  };
  for (const node of nodes) {
    if (node.type === "hardBreak") {
      closeTo(0);
      out += breaks;
      continue;
    }
    let text = node.text ?? "";
    const marks = text.trim()
      ? (node.marks ?? []).filter((mark) => MARK_ORDER.includes(mark.type)).sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type))
      : [];
    let keep = 0;
    while (keep < open.length && keep < marks.length && markKey(open[keep]) === markKey(marks[keep])) keep += 1;
    closeTo(keep);
    if (marks.length > keep) {
      const lead = text.match(/^\s*/)![0];
      out += lead + marks.slice(keep).map(opener).join("");
      text = text.slice(lead.length);
      open = marks;
    }
    if (open.length) {
      const trail = text.match(/\s*$/)![0];
      out += text.slice(0, text.length - trail.length);
      pendingSpace = trail;
    } else {
      out += text;
    }
  }
  closeTo(0);
  return out;
}

/** Text of a list item. Items are single lines, so extra paragraphs and line breaks join with spaces. */
function itemText(item: JSONContent): string {
  return (item.content ?? [])
    .filter((child) => child.type === "paragraph" || child.type === "heading")
    .map((child) => inlineToMarkdown(child.content, " ").trim())
    .filter(Boolean)
    .join(" ");
}

/** Lists are flat; anything nested (pasted, say) follows its parent as a sibling item. */
function listLines(list: JSONContent): string[] {
  let number = 0;
  return (list.content ?? []).flatMap((item) => {
    const prefix = list.type === "orderedList" ? `${(number += 1)}. ` : list.type === "taskList" ? `- [${item.attrs?.checked ? "x" : " "}] ` : "- ";
    const nested = (item.content ?? []).filter((child) => child.type?.endsWith("List")).flatMap(listLines);
    const text = itemText(item);
    return [...(text ? [prefix + text] : []), ...nested];
  });
}

export function docToMarkdown(doc: JSONContent): string {
  const blocks = (doc.content ?? []).flatMap((block): string[] => {
    if (block.type === "heading") {
      const text = inlineToMarkdown(block.content, " ").trim();
      return text ? [`${"#".repeat(Math.min(Math.max(Number(block.attrs?.level) || 1, 1), 3))} ${text}`] : [];
    }
    if (block.type?.endsWith("List")) {
      const lines = listLines(block);
      return lines.length ? [lines.join("\n")] : [];
    }
    const text = inlineToMarkdown(block.content).split("\n").map((line) => line.trim()).join("\n").trim();
    return text ? [text] : [];
  });
  return blocks.join("\n\n");
}
