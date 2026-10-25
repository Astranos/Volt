// A small Markdown subset for handbook pages: headings, paragraphs, bulleted,
// numbered and checklist items, bold, italic, inline code, and links. It parses to
// plain data so pages render as React elements and never as raw HTML.

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold" | "italic"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "paragraph"; lines: Inline[][] }
  | { type: "list"; ordered: boolean; items: Array<{ checked?: boolean; children: Inline[] }> };

// A link needs a host (or an address/number) after the scheme; "https://" alone stays text.
const SAFE_LINK = /^(?:https?:\/\/[^\s/?#]+|mailto:\S+|tel:\S+)/i;

// Sticky patterns tried only where a marker character appears. Every span is bounded,
// so a page full of unmatched markers parses in linear time.
const CODE = /`([^`\n]{1,300})`/y;
const BOLD = /\*\*(?=\S)([^\n]{1,300}?)(?<=\S)\*\*/y;
const STAR_ITALIC = /\*(?=\S)([^*\n]{1,300}?)(?<=\S)\*(?!\*)/y;
const UNDERSCORE_ITALIC = /_(?=\S)([^_\n]{1,300}?)(?<=\S)_(?!\w)/y;
// Link targets may contain one level of balanced parentheses, like Policy_(retail).
const LINK = /\[([^\]\n]{1,300})\]\(((?:[^()\s]|\([^()\s]{0,200}\)){1,2000})\)/y;
const MARKER = /[`*_[]/g;

function matchAt(pattern: RegExp, text: string, index: number) {
  pattern.lastIndex = index;
  return pattern.exec(text);
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ type: "text", text: plain });
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    MARKER.lastIndex = i;
    const next = MARKER.exec(text);
    if (!next) break;
    plain += text.slice(i, next.index);
    i = next.index;
    const char = text[i];
    // Underscores and single asterisks inside a word (sku_code_123, 2*3) stay literal.
    const atWordStart = i === 0 || !/\w/.test(text[i - 1]);
    let match: RegExpExecArray | null = null;
    let node: Inline | null = null;
    if (char === "`" && (match = matchAt(CODE, text, i))) {
      node = { type: "code", text: match[1] };
    } else if (char === "*" && (match = matchAt(BOLD, text, i))) {
      node = { type: "bold", children: parseInline(match[1]) };
    } else if (char === "*" && atWordStart && (match = matchAt(STAR_ITALIC, text, i))) {
      node = { type: "italic", children: parseInline(match[1]) };
    } else if (char === "_" && atWordStart && (match = matchAt(UNDERSCORE_ITALIC, text, i))) {
      node = { type: "italic", children: parseInline(match[1]) };
    } else if (char === "[" && (match = matchAt(LINK, text, i)) && SAFE_LINK.test(match[2])) {
      node = { type: "link", href: match[2], children: parseInline(match[1]) };
    }
    if (node && match) {
      flush();
      out.push(node);
      i += match[0].length;
    } else {
      plain += char;
      i += 1;
    }
  }
  plain += text.slice(i);
  flush();
  return out;
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(?:\[( |x|X)\]\s+)?(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;

export function parseHandbookMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: Inline[][] | null = null;
  const closeParagraph = () => {
    if (paragraph?.length) blocks.push({ type: "paragraph", lines: paragraph });
    paragraph = null;
  };
  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = line.match(HEADING);
    const bullet = line.match(BULLET);
    const numbered = !bullet ? line.match(NUMBERED) : null;
    if (!line) {
      closeParagraph();
    } else if (heading) {
      closeParagraph();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, children: parseInline(heading[2]) });
    } else if (bullet || numbered) {
      closeParagraph();
      const ordered = Boolean(numbered);
      const item = bullet
        ? { checked: bullet[1] === undefined ? undefined : bullet[1].toLowerCase() === "x", children: parseInline(bullet[2]) }
        : { children: parseInline(numbered![1]) };
      const last = blocks[blocks.length - 1];
      if (last?.type === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ type: "list", ordered, items: [item] });
    } else {
      (paragraph ??= []).push(parseInline(line));
    }
  }
  closeParagraph();
  return blocks;
}

/** Plain text of a page, for previews and search. */
export function markdownPlainText(source: string) {
  const inlineText = (nodes: Inline[]): string => nodes.map((node) =>
    node.type === "text" || node.type === "code" ? node.text : inlineText(node.children)).join("");
  // Headings and list items are separated so previews read "Sales floor · Lock the cases".
  return parseHandbookMarkdown(source).map((block) =>
    block.type === "heading" ? inlineText(block.children)
      : block.type === "paragraph" ? block.lines.map(inlineText).join(" ")
        : block.items.map((item) => inlineText(item.children)).join(" · ")).join(" · ");
}
