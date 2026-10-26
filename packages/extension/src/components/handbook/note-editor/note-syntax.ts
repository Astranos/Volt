// Where the note renderer (src/domain/handbook-markdown.ts) finds formatting, as source
// offsets. The editor styles exactly these ranges, so it never shows formatting that a
// saved note would print as literal text, or the other way around.
import { parseInline, type Inline } from "../../../domain/handbook-markdown";

// The renderer's line patterns, tried on the trimmed line in the same order.
const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(?:\[( |x|X)\](?:\s+|$))?(.*)$/;
const NUMBERED = /^(\d+[.)])\s+(.*)$/;

/** Offsets within the raw line. `content` is what's parsed for bold, links, and so on. */
export type NoteLine =
  | { kind: "heading"; level: 1 | 2 | 3; marker: [number, number]; content: [number, number] }
  | { kind: "bullet"; marker: [number, number]; task: { marker: [number, number]; checked: boolean } | null; content: [number, number] }
  | { kind: "numbered"; marker: [number, number]; content: [number, number] }
  | { kind: "paragraph"; content: [number, number] };

export function parseNoteLine(raw: string): NoteLine | null {
  const start = raw.length - raw.trimStart().length;
  const end = raw.trimEnd().length;
  const line = raw.slice(start, end);
  if (!line) return null;
  // Content runs to the end of the trimmed line, so its start is `end - text.length`.
  const heading = HEADING.exec(line);
  if (heading) {
    const level = heading[1].length as 1 | 2 | 3;
    return { kind: "heading", level, marker: [start, end - heading[2].length], content: [end - heading[2].length, end] };
  }
  const bullet = BULLET.exec(line);
  if (bullet) {
    const content: [number, number] = [end - bullet[2].length, end];
    if (bullet[1] === undefined) return { kind: "bullet", marker: [start, start + 1], task: null, content };
    // The task marker is the first "[" after the bullet and its spaces.
    const taskFrom = start + line.indexOf("[");
    return { kind: "bullet", marker: [start, start + 1], task: { marker: [taskFrom, taskFrom + 3], checked: bullet[1] !== " " }, content };
  }
  const numbered = NUMBERED.exec(line);
  if (numbered) return { kind: "numbered", marker: [start, start + numbered[1].length], content: [end - numbered[2].length, end] };
  return { kind: "paragraph", content: [start, end] };
}

export type InlineSpanType = "bold" | "italic" | "code" | "link";

/** A formatted span: [from, to) includes its markers, [contentFrom, contentTo) doesn't. */
export type InlineSpan = { type: InlineSpanType; from: number; to: number; contentFrom: number; contentTo: number };

// Every node is its markers around exactly the source of its children, so walking the
// parse and adding up lengths recovers the offsets. "***x***" is bold (2) around italic (1).
function walk(nodes: Inline[], pos: number, out: InlineSpan[]): number {
  for (const node of nodes) {
    const from = pos;
    if (node.type === "text") {
      pos += node.text.length;
    } else if (node.type === "code") {
      pos += node.text.length + 2;
      out.push({ type: "code", from, to: pos, contentFrom: from + 1, contentTo: pos - 1 });
    } else if (node.type === "link") {
      const contentTo = walk(node.children, from + 1, out);
      pos = contentTo + node.href.length + 3;
      out.push({ type: "link", from, to: pos, contentFrom: from + 1, contentTo });
    } else {
      const marker = node.type === "bold" ? 2 : 1;
      const contentTo = walk(node.children, from + marker, out);
      pos = contentTo + marker;
      out.push({ type: node.type, from, to: pos, contentFrom: from + marker, contentTo });
    }
  }
  return pos;
}

/** The formatted spans the renderer finds in `text`, offset by `base`. */
export function inlineSpans(text: string, base = 0): InlineSpan[] {
  const out: InlineSpan[] = [];
  walk(parseInline(text), base, out);
  return out;
}

/** The text a reader sees: no markers, no link targets. */
export function inlineText(text: string) {
  const flatten = (nodes: Inline[]): string => nodes.map((node) =>
    node.type === "text" || node.type === "code" ? node.text : flatten(node.children)).join("");
  return flatten(parseInline(text));
}
