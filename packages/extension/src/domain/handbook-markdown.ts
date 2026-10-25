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

const SAFE_LINK = /^(https?:\/\/|mailto:|tel:)/i;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push({ type: "text", text: plain });
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const code = rest.match(/^`([^`]+)`/);
    const bold = rest.match(/^\*\*(.+?)\*\*/);
    const italic = !bold ? rest.match(/^[*_]([^*_]+?)[*_]/) : null;
    const link = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/);
    if (code) {
      flush();
      out.push({ type: "code", text: code[1] });
      i += code[0].length;
    } else if (bold) {
      flush();
      out.push({ type: "bold", children: parseInline(bold[1]) });
      i += bold[0].length;
    } else if (italic) {
      flush();
      out.push({ type: "italic", children: parseInline(italic[1]) });
      i += italic[0].length;
    } else if (link && SAFE_LINK.test(link[2])) {
      flush();
      out.push({ type: "link", href: link[2], children: parseInline(link[1]) });
      i += link[0].length;
    } else {
      plain += text[i];
      i += 1;
    }
  }
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
  return parseHandbookMarkdown(source).map((block) =>
    block.type === "heading" ? inlineText(block.children)
      : block.type === "paragraph" ? block.lines.map(inlineText).join(" ")
        : block.items.map((item) => inlineText(item.children)).join(" ")).join(" ");
}
