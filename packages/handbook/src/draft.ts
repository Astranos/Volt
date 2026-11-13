// The handbook editor's form state, and how it becomes a create/update call. Shared by
// the extension and the web dashboard so both save entries exactly the same way.
import type { FunctionArgs } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import { parseKeyCombo, type HandbookEntry } from "./entries";
import { entryFields, formatAddress, formatPhoneInput, parseAddress, type AddressParts, type HandbookValueFormat } from "./format";

export type HandbookKind = HandbookEntry["kind"];
export type DraftStep = { text: string; keys: string; command: string; tip: string };
export type DraftVariant = { label: string; warning: string; steps: DraftStep[] };
export type DraftField = { label: string; format: HandbookValueFormat; value: string; address: AddressParts };
export type HandbookDraft = {
  kind: HandbookKind;
  title: string;
  category: string;
  comment: string;
  fields: DraftField[];
  body: string;
  showInList: boolean;
  pinned: boolean;
  variants: DraftVariant[];
  username: string;
  secret: string;
};

type CreateArgs = FunctionArgs<typeof api.handbook.create>;
export type HandbookContentArgs = Omit<CreateArgs, "credentials">;
export type HandbookCredentialsArgs = CreateArgs["credentials"];

export const KIND_OPTIONS: Array<{ kind: HandbookKind; label: string }> = [
  { kind: "value", label: "Quick value" },
  { kind: "secret", label: "Login" },
  { kind: "guide", label: "Guide" },
  { kind: "note", label: "Note" },
];
export const FORMAT_OPTIONS: Array<{ format: HandbookValueFormat; label: string }> = [
  { format: "text", label: "Text" },
  { format: "phone", label: "Phone" },
  { format: "address", label: "Address" },
];
export const DRAFT_PLACEHOLDERS: Record<HandbookKind, { title: string; category: string }> = {
  value: { title: "Store phone", category: "Store info" },
  secret: { title: "PSN", category: "Logins" },
  guide: { title: "Skip Windows sign-in", category: "Setup guides" },
  note: { title: "Opening checklist", category: "Procedures" },
};
// The server's limits (convex/handbook.ts).
export const MAX_DRAFT_FIELDS = 8;
export const MAX_DRAFT_VARIANTS = 4;

export const emptyAddress = (): AddressParts => ({ street: "", city: "", state: "", zip: "" });
export const emptyField = (format: HandbookValueFormat = "text"): DraftField => ({ label: "", format, value: "", address: emptyAddress() });
export const emptyStep = (): DraftStep => ({ text: "", keys: "", command: "", tip: "" });
export const emptyVariant = (): DraftVariant => ({ label: "", warning: "", steps: [emptyStep()] });
/** The text a field saves: an address's parts joined into one line, anything else as typed. */
export const draftFieldValue = (field: DraftField) => (field.format === "address" ? formatAddress(field.address) : field.value);

export function draftFor(entry: HandbookEntry | null, defaults: Partial<HandbookDraft> = {}): HandbookDraft {
  const fields = entry?.kind === "value"
    ? entryFields(entry).map((field) => ({
      label: field.label ?? "",
      format: field.format,
      value: field.value,
      address: field.format === "address" ? parseAddress(field.value) : emptyAddress(),
    }))
    : [emptyField()];
  return {
    kind: entry?.kind ?? "value",
    title: entry?.title ?? "",
    category: entry?.category ?? "",
    comment: entry?.comment ?? "",
    fields,
    // Guides (intro) and notes use this. Quick values and logins no longer have notes, but
    // any left from older versions are kept here and sent back, so the server can fold
    // them into the comment instead of a save dropping them.
    body: entry?.body ?? "",
    showInList: entry?.showInList ?? false,
    pinned: entry?.pinned ?? false,
    variants: entry?.variants?.map((variant) => ({
      label: variant.label,
      warning: variant.warning ?? "",
      steps: variant.steps.map((step) => ({
        text: step.text,
        keys: step.keys?.join(" + ") ?? "",
        command: step.command ?? "",
        tip: step.tip ?? "",
      })),
    })) ?? [emptyVariant()],
    username: "",
    secret: "",
    ...defaults,
  };
}

/**
 * Changes an entry's type. Turning a quick value into a note moves the value into
 * the note (above any older notes) so it isn't silently dropped on save.
 */
export function switchKind(draft: HandbookDraft, kind: HandbookKind): HandbookDraft {
  if (draft.kind !== "value" || kind !== "note") return { ...draft, kind };
  // Each value becomes a line ("Phone: 313-555-0100"), unless the note already has that exact line.
  const lines = draft.fields
    .map((field) => [field.label.trim(), draftFieldValue(field).trim()])
    .filter(([, value]) => value)
    .map(([label, value]) => (label ? `${label}: ${value}` : value));
  const existing = new Set(draft.body.split("\n").map((line) => line.trim()));
  const added = lines.filter((line) => !existing.has(line));
  const body = added.length ? [added.join("\n"), draft.body].filter(Boolean).join("\n\n") : draft.body;
  return { ...draft, kind, body };
}

/** Changes a value's type, carrying what's typed across so switching doesn't lose it. */
export function switchFieldFormat(field: DraftField, format: HandbookValueFormat): DraftField {
  return {
    ...field,
    format,
    address: format === "address" && field.format !== "address" ? parseAddress(field.value) : field.address,
    value: field.format === "address" && format !== "address" ? formatAddress(field.address)
      : format === "phone" ? formatPhoneInput(field.value) : field.value,
  };
}

/** Swaps an item with its neighbor; out-of-range moves return the list unchanged. */
export function moveItem<T>(items: T[], index: number, offset: number) {
  const target = index + offset;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Editing a saved login whose type stays a login: blank username and password keep the saved ones. */
export const keepsSavedLogin = (entry: HandbookEntry | null, draft: Pick<HandbookDraft, "kind">) =>
  entry?.kind === "secret" && draft.kind === "secret";

/**
 * Notes left on a saved quick value or login from an earlier version. A note's or guide's
 * text never counts as that, even after switching the type in the editor.
 */
export const hasOlderNotes = (entry: HandbookEntry | null) =>
  (entry?.kind === "value" || entry?.kind === "secret") && Boolean(entry.body?.trim());

/** The arguments for `handbook.create` / `handbook.update` (without `id`). */
export function draftToSave(draft: HandbookDraft, entry: HandbookEntry | null): { content: HandbookContentArgs; credentials: HandbookCredentialsArgs } {
  const keepsBody = draft.kind === "guide" || draft.kind === "note" || hasOlderNotes(entry);
  const content: HandbookContentArgs = {
    kind: draft.kind,
    title: draft.title,
    category: draft.category,
    comment: draft.comment || undefined,
    // `value`/`valueFormat` mirror the first field for older extensions; `fields` is the source of truth.
    value: draft.kind === "value" ? draftFieldValue(draft.fields[0]) : undefined,
    valueFormat: draft.kind === "value" ? draft.fields[0].format : undefined,
    // An empty list for other kinds tells the server this editor already moved the values
    // (into a note, say); its fallback for older extensions would otherwise add them again.
    fields: draft.kind === "value"
      ? draft.fields.map((field) => ({ label: field.label.trim() || undefined, value: draftFieldValue(field), format: field.format }))
      : [],
    body: keepsBody && draft.body.trim() ? draft.body : undefined,
    showInList: draft.kind === "note" ? draft.showInList : undefined,
    pinned: draft.pinned,
    variants: draft.kind === "guide"
      ? draft.variants.map((variant) => ({
        label: variant.label,
        warning: variant.warning || undefined,
        steps: variant.steps.map((step) => ({
          text: step.text,
          keys: step.keys.trim() ? parseKeyCombo(step.keys) : undefined,
          command: step.command || undefined,
          tip: step.tip || undefined,
        })),
      }))
      : undefined,
  };
  // While editing a login, a blank username or password keeps the stored one.
  const credentials = draft.kind === "secret" && (draft.secret || draft.username || !keepsSavedLogin(entry, draft))
    ? { username: draft.username || undefined, secret: draft.secret }
    : undefined;
  return { content, credentials };
}

// Codes named before notes were called pages and short notes were called notes.
const RENAMED_ERRORS: Record<string, string> = {
  HANDBOOK_NOTE_TOO_LONG: "Comment too long.",
  HANDBOOK_PAGE_REQUIRED: "Write something in the note before saving.",
  HANDBOOK_PAGE_TOO_LONG: "Note too long.",
};

/** A readable message for a failed handbook save, from the server's HANDBOOK_* code. */
export function handbookErrorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.match(/HANDBOOK_[A-Z_]+/)?.[0];
  if (!code) return message;
  return RENAMED_ERRORS[code] ?? code.replace(/^HANDBOOK_/, "").replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase()) + ".";
}
