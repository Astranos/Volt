// Text edits behind the note editor's menus. They work on plain strings (a line, or a
// line plus offsets) so they can be tested without an editor.
import { isSafeHandbookLink } from "../../../domain/handbook-markdown";
import { inlineSpans, inlineText, type InlineSpan } from "./note-syntax";

// A heading, bullet, checklist, or numbered-list prefix, with its indentation.
const LINE_PREFIX = /^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\](?:\s+|$))?|\d+[.)]\s+)?/;

export const linePrefixLength = (line: string) => LINE_PREFIX.exec(line)![0].length;

/** Swaps whatever block prefix a line has ("## ", "- [ ] ", "2. ") for `prefix`. */
export const replaceLinePrefix = (line: string, prefix: string) => prefix + line.slice(linePrefixLength(line));

/** "1. " for a new numbered item, or the next number when the line above is one. */
export function numberedPrefix(previousLine: string) {
  const number = /^\s*(\d+)[.)]\s/.exec(previousLine);
  return `${number ? Number(number[1]) + 1 : 1}. `;
}

/** Where a "/" command starts in the text before the cursor: at the line start or after a space. */
export function slashQueryStart(textBefore: string) {
  const match = /(?:^|\s)\/\w*$/.exec(textBefore);
  return match ? textBefore.lastIndexOf("/") : null;
}

/** The change that checks or unchecks the task on a line, or null when it isn't a task. */
export function toggleTaskMarker(line: string) {
  const match = /^(\s*[-*+]\s+\[)([ xX])\]/.exec(line);
  if (!match) return null;
  return { offset: match[1].length, insert: match[2] === " " ? "x" : " " };
}

export type InlineFormat = "bold" | "italic" | "code";
type Change = { from: number; to: number; insert: string };
export type InlineEdit = { changes: Change[]; selection: { anchor: number; head: number } };

// Italic tries "*" first, then "_" (which can hold a "**bold**" inside it).
const MARKERS: Record<InlineFormat, string[]> = { bold: ["**"], italic: ["*", "_"], code: ["`"] };

const applyChanges = (text: string, changes: Change[]) =>
  [...changes].sort((a, b) => b.from - a.from || b.to - a.to).reduce((result, change) => result.slice(0, change.from) + change.insert + result.slice(change.to), text);

// Markers have to hug the text ("**word** ", not "**word **") for the note to render them.
function trimRange(text: string, from: number, to: number) {
  while (from < to && /\s/.test(text[from])) from += 1;
  while (to > from && /\s/.test(text[to - 1])) to -= 1;
  return { from, to };
}

// Takes the markers off one span, keeping the selection on the same text.
function unwrap(span: InlineSpan, from: number, to: number): InlineEdit {
  const open = span.contentFrom - span.from;
  const map = (pos: number) =>
    pos <= span.from ? pos
      : pos <= span.contentFrom ? span.from
        : pos <= span.contentTo ? pos - open
          : pos >= span.to ? pos - open - (span.to - span.contentTo)
            : span.contentTo - open;
  return {
    changes: [{ from: span.from, to: span.contentFrom, insert: "" }, { from: span.contentTo, to: span.to, insert: "" }],
    selection: { anchor: map(from), head: map(to) },
  };
}

// Wraps [from, to) in a marker, first taking the same formatting off spans inside it
// ("**a** and **b**" becomes "**a and b**"). Only an edit that the renderer reads back as
// one span over the same visible text counts; otherwise there's nothing to do.
function wrap(text: string, from: number, to: number, format: InlineFormat, spans: InlineSpan[]): InlineEdit | null {
  // Italics have to start and end at word edges, or "foo*bar*" stays literal.
  if (format === "italic" && (/\w/.test(text[from - 1] ?? "") || /\w/.test(text[to] ?? ""))) return null;
  const inner = spans
    .filter((span) => from <= span.from && span.to <= to)
    .filter((span, _, all) => !all.some((other) => other !== span && other.from <= span.from && span.to <= other.to));
  const removals = inner.flatMap((span) => [
    { from: span.from, to: span.contentFrom, insert: "" },
    { from: span.contentTo, to: span.to, insert: "" },
  ]);
  const removed = removals.reduce((sum, change) => sum + change.to - change.from, 0);
  const visible = inlineText(text);
  for (const marker of MARKERS[format]) {
    const changes = [{ from, to: from, insert: marker }, ...removals, { from: to, to, insert: marker }];
    const result = applyChanges(text, changes);
    const anchor = from + marker.length;
    const head = to + marker.length - removed;
    // A span of this format covering the same words ("***x***" reads as bold around italic,
    // so bold's content there is "*x*").
    const words = inlineText(result.slice(anchor, head));
    const reads = inlineSpans(result).some((span) => span.type === format && span.contentFrom <= anchor && head <= span.contentTo
      && inlineText(result.slice(span.contentFrom, span.contentTo)) === words);
    if (reads && inlineText(result) === visible) return { changes, selection: { anchor, head } };
  }
  return null;
}

/**
 * Bold, italic, or code for text[from, to) of one line. `active` when the selection is
 * already formatted that way; `edit` toggles it, or is null when the result wouldn't
 * render as intended (so the button is disabled).
 * - The selection is one span, with or without its markers, or sits inside one: that
 *   whole span loses the formatting.
 * - Otherwise the selection is wrapped (see `wrap`).
 * - An empty selection outside any span gets an empty pair to type into.
 */
export function inlineFormat(text: string, selFrom: number, selTo: number, format: InlineFormat): { active: boolean; edit: InlineEdit | null } {
  const { from, to } = trimRange(text, selFrom, selTo);
  const spans = inlineSpans(text).filter((span) => span.type === format);
  const exact = spans.find((span) => (span.from === from && span.to === to) || (span.contentFrom === from && span.contentTo === to));
  const around = exact ?? spans
    .filter((span) => span.contentFrom <= from && to <= span.contentTo)
    .sort((a, b) => a.to - a.from - (b.to - b.from))[0];
  if (around) return { active: true, edit: unwrap(around, from, to) };
  if (from === to) {
    const [marker] = MARKERS[format];
    return { active: false, edit: { changes: [{ from, to, insert: marker + marker }], selection: { anchor: from + marker.length, head: from + marker.length } } };
  }
  return { active: false, edit: wrap(text, from, to, format, spans) };
}

/**
 * "example.com" becomes "https://example.com", and spaces and parentheses are
 * percent-encoded so the note's link syntax can hold them. Returns null for anything
 * the note renderer wouldn't link (javascript:, a bare "https://", …).
 */
export function normalizeLinkHref(input: string) {
  // encodeURIComponent leaves parentheses alone; existing %XX escapes are kept as they are.
  const value = input.trim().replace(/[\s()]/g, (char) => (char === "(" ? "%28" : char === ")" ? "%29" : encodeURIComponent(char)));
  if (!value) return null;
  // A scheme, but not "host:port".
  const href = /^(?:tel:|[a-z][a-z0-9+.-]*:(?!\d))/i.test(value) ? value : `https://${value}`;
  return isSafeHandbookLink(href) ? href : null;
}

/** Link text can't hold brackets: the renderer would print "[item [1]](url)" as is. */
export const canLinkText = (text: string) => Boolean(text.trim()) && !/[[\]\n]/.test(text);

export const markdownLink = (text: string, href: string) => `[${text}](${href})`;
