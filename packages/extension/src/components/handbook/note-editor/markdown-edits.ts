// Text edits behind the note editor's menus. They work on plain strings (a line, or a
// line plus offsets) so they can be tested without an editor.
import { isSafeHandbookLink } from "../../../domain/handbook-markdown";

// A heading, bullet, checklist, or numbered-list prefix, with its indentation.
const LINE_PREFIX = /^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/;

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

export type InlineMarker = "**" | "*" | "`";
type Change = { from: number; to: number; insert: string };

const runAt = (text: string, char: string, start: number, step: 1 | -1) => {
  let count = 0;
  for (let i = start; text[i] === char; i += step) count += 1;
  return count;
};

// How many marker characters to remove when the run on both sides means `marker` is
// applied. "***x***" is bold and italic, so a run of 3 counts for both.
function wrappedRun(marker: InlineMarker, run: number, char: string) {
  if (marker === "**") return run >= 2 ? 2 : 0;
  if (marker === "*" && char === "*") return run === 1 || run === 3 ? 1 : 0;
  return run >= 1 ? 1 : 0;
}

const markerChars = (marker: InlineMarker) => (marker === "*" ? ["*", "_"] : [marker[0]]);

function findWrap(text: string, from: number, to: number, marker: InlineMarker) {
  for (const char of markerChars(marker)) {
    const outside = wrappedRun(marker, Math.min(runAt(text, char, from - 1, -1), runAt(text, char, to, 1)), char);
    if (outside) return { inside: false, length: outside };
    const inner = text.slice(from, to);
    const inside = wrappedRun(marker, Math.min(runAt(inner, char, 0, 1), runAt(inner, char, inner.length - 1, -1)), char);
    if (inside && inner.length > inside * 2) return { inside: true, length: inside };
  }
  return null;
}

// Markers have to hug the text ("**word** ", not "**word **") for the note to render them.
function trimRange(text: string, from: number, to: number) {
  while (from < to && /\s/.test(text[from])) from += 1;
  while (to > from && /\s/.test(text[to - 1])) to -= 1;
  return { from, to };
}

export function isInlineMarkerActive(text: string, from: number, to: number, marker: InlineMarker) {
  const range = trimRange(text, from, to);
  return findWrap(text, range.from, range.to, marker) !== null;
}

/**
 * Wraps text[from, to) in `marker`, or unwraps it when it's already wrapped, whether
 * the markers sit just outside the selection or at its edges. Returns the changes and
 * the selection afterwards (in the changed text) around the same words.
 */
export function toggleInlineMarker(text: string, selFrom: number, selTo: number, marker: InlineMarker): {
  changes: Change[];
  selection: { anchor: number; head: number };
} {
  const { from, to } = trimRange(text, selFrom, selTo);
  const wrap = findWrap(text, from, to, marker);
  if (wrap && !wrap.inside) {
    const n = wrap.length;
    return {
      changes: [{ from: from - n, to: from, insert: "" }, { from: to, to: to + n, insert: "" }],
      selection: { anchor: from - n, head: to - n },
    };
  }
  if (wrap) {
    const n = wrap.length;
    return {
      changes: [{ from, to: from + n, insert: "" }, { from: to - n, to, insert: "" }],
      selection: { anchor: from, head: to - n * 2 },
    };
  }
  return {
    changes: [{ from, to: from, insert: marker }, { from: to, to, insert: marker }],
    selection: { anchor: from + marker.length, head: to + marker.length },
  };
}

const UNSAFE_URL_CHAR = /[\s()]/g;

/**
 * "example.com" becomes "https://example.com", and spaces and parentheses are
 * percent-encoded so the note's link syntax can hold them. Returns null for anything
 * the note renderer wouldn't link (javascript:, a bare "https://", …).
 */
export function normalizeLinkHref(input: string) {
  const value = input.trim().replace(UNSAFE_URL_CHAR, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  if (!value) return null;
  // A scheme, but not "host:port".
  const href = /^(?:tel:|[a-z][a-z0-9+.-]*:(?!\d))/i.test(value) ? value : `https://${value}`;
  return isSafeHandbookLink(href) ? href : null;
}

export const markdownLink = (text: string, href: string) => `[${text}](${href})`;
