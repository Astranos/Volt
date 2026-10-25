import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../../convex/_generated/api";
import { markdownPlainText } from "./handbook-markdown";

export type HandbookEntry = FunctionReturnType<typeof api.handbook.list>[number];
export type HandbookEntryId = HandbookEntry["_id"];
export type HandbookVariant = NonNullable<HandbookEntry["variants"]>[number];
export type HandbookStep = HandbookVariant["steps"][number];
export type HandbookFilter = { kind: "all" } | { kind: "pinned" } | { kind: "category"; category: string };

// Written by the Command Menu or New Tab right before opening the sidepanel on an entry.
export const HANDBOOK_OPEN_ENTRY_KEY = "volt.handbook.openEntry";
export const HANDBOOK_PAGE_PATH = "/handbook.html";

export const DEFAULT_HANDBOOK_CATEGORIES = ["Store info", "Logins", "Setup guides", "Procedures", "Testing"];

// Offered as blanks for each store to fill in. Values are typed in by the user, never shipped.
export const BLANK_SUGGESTIONS = [
  { kind: "value", valueFormat: "phone", category: "Store info", title: "Store phone", note: "" },
  { kind: "value", valueFormat: "address", category: "Store info", title: "Store address", note: "" },
  { kind: "value", valueFormat: "phone", category: "Store info", title: "Local police", note: "Non-emergency line" },
  { kind: "secret", category: "Logins", title: "PSN", note: "Testing consoles" },
  { kind: "secret", category: "Logins", title: "Microsoft account", note: "Testing PCs and Xbox" },
  { kind: "secret", category: "Logins", title: "Mac test user", note: "Local account on test Macs" },
] as const;

/** Categories in the account's saved order; any not in it follow, in first-seen order. */
export function handbookCategories(entries: HandbookEntry[], order: readonly string[] = []) {
  const rank = new Map(order.map((category, index) => [category, index]));
  return [...new Set(entries.map((entry) => entry.category))]
    .map((category, index) => ({ category, index }))
    .sort((a, b) => (rank.get(a.category) ?? Infinity) - (rank.get(b.category) ?? Infinity) || a.index - b.index)
    .map(({ category }) => category);
}

function searchText(entry: HandbookEntry) {
  const steps = (entry.variants ?? []).flatMap((variant) => [
    variant.label,
    variant.warning,
    ...variant.steps.flatMap((step) => [step.text, step.command, step.tip, ...(step.keys ?? [])]),
  ]);
  // Pages are searched as plain text; guide intros and any older notes left on a quick
  // value or login (shown when they couldn't be folded) as written.
  const body = entry.kind === "page" && entry.body ? markdownPlainText(entry.body) : entry.body;
  const fields = (entry.fields ?? []).flatMap((field) => [field.label, field.value]);
  return [entry.title, entry.category, entry.note, entry.value, entry.username, body, ...fields, ...steps]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Every word of the query must appear somewhere in the entry. Secret values are never searchable. */
export function matchesHandbookQuery(entry: HandbookEntry, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = searchText(entry);
  return words.every((word) => haystack.includes(word));
}

export function filterHandbook(entries: HandbookEntry[], query: string, filter: HandbookFilter) {
  return entries.filter((entry) =>
    (filter.kind === "all"
      || (filter.kind === "pinned" && entry.pinned)
      || (filter.kind === "category" && entry.category === filter.category))
    && matchesHandbookQuery(entry, query));
}

/** Groups by category (in the saved category order), pinned entries first within each group. */
export function groupHandbook(entries: HandbookEntry[], order: readonly string[] = []) {
  return handbookCategories(entries, order).map((category) => ({
    category,
    entries: entries
      .filter((entry) => entry.category === category)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order),
  }));
}

export function guideSummary(entry: HandbookEntry) {
  const variants = entry.variants ?? [];
  const steps = variants[0]?.steps ?? [];
  const command = steps.find((step) => step.command)?.command;
  const count = variants.length > 1
    ? `${variants.length} methods`
    : `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
  return command ? `${count} · ${command}` : count;
}

/** Entries that open in their own view in the sidepanel and from the Command Menu. */
export const opensAsDocument = (entry: Pick<HandbookEntry, "kind">) => entry.kind === "guide" || entry.kind === "page";

/** First words of a page, for list rows. */
export function pageSummary(entry: HandbookEntry, max = 90) {
  const text = markdownPlainText(entry.body ?? "").trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function formatHandbookUpdated(entry: Pick<HandbookEntry, "updatedAt" | "updatedByName">, now = Date.now()) {
  const days = Math.floor((now - entry.updatedAt) / 86_400_000);
  const when = days <= 0 ? "today"
    : days === 1 ? "yesterday"
      : days < 7 ? `${days}d ago`
        : new Date(entry.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `Updated ${when} by ${entry.updatedByName}`;
}

/** Splits a typed key combo like "Shift + Fn + F10" into keycaps. */
export function parseKeyCombo(value: string) {
  return value.split("+").map((key) => key.trim()).filter(Boolean);
}
