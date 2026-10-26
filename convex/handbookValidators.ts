import { v, type Infer } from "convex/values";

// "note" is a formatted article (called "page" before 1.0.81).
export const handbookKindValidator = v.union(v.literal("value"), v.literal("secret"), v.literal("guide"), v.literal("note"));
// The kinds `handbook.list` returns to extensions released before 1.0.81, which call a note a "page".
// Clients from before pages existed never receive them (see `list`).
export const handbookLegacyKindValidator = v.union(v.literal("value"), v.literal("secret"), v.literal("guide"), v.literal("page"));
// What may be stored, and what editors may send, until `migratePagesToNotes` has run and every
// client sends "note": "page" is accepted and always rewritten to "note".
const handbookStoredKindValidator = v.union(
  v.literal("value"), v.literal("secret"), v.literal("guide"), v.literal("note"), v.literal("page"),
);

// How a "value" entry is typed and shown. Phone values are formatted as they're typed;
// addresses are edited as street / city / state / ZIP and stored as one line.
export const handbookValueFormatValidator = v.union(v.literal("text"), v.literal("phone"), v.literal("address"));

// One copyable value of a quick-value entry: "Phone", "Address", "Network", …
export const handbookFieldValidator = v.object({
  label: v.optional(v.string()),
  value: v.string(),
  format: v.optional(handbookValueFormatValidator),
});

export const handbookStepValidator = v.object({
  text: v.string(),
  keys: v.optional(v.array(v.string())),
  command: v.optional(v.string()),
  tip: v.optional(v.string()),
});

export const handbookVariantValidator = v.object({
  label: v.string(),
  steps: v.array(handbookStepValidator),
  warning: v.optional(v.string()),
});

// Content shared by every shape below.
const handbookSharedContentFields = {
  title: v.string(),
  category: v.string(),
  // The copyable value of a "value" entry.
  value: v.optional(v.string()),
  valueFormat: v.optional(handbookValueFormatValidator),
  // Several labeled values to copy. When set, `value`/`valueFormat` mirror the first one so
  // extensions released before fields existed still show and copy something sensible.
  fields: v.optional(v.array(handbookFieldValidator)),
  // A guide's intro, older notes on a value or login that didn't fit its comment, or the
  // formatted content (a small Markdown subset) of a note.
  body: v.optional(v.string()),
  // Notes only: show the whole note in the sidepanel list instead of a row to tap.
  showInList: v.optional(v.boolean()),
  // Guide steps. A guide without alternatives has one variant with an empty label.
  variants: v.optional(v.array(handbookVariantValidator)),
  pinned: v.boolean(),
};

// Clean content in the current shape. Secret values are passed separately and never
// stored on the entry itself.
export const handbookContentFields = {
  kind: handbookKindValidator,
  ...handbookSharedContentFields,
  // Short context shown with the title, e.g. "right off Wick".
  comment: v.optional(v.string()),
};

// Everything an editor can send: the current shape, or the one extensions released before
// 1.0.81 send (kind "page", `note` instead of `comment`). Normalized to the current shape
// before it's validated or stored.
export const handbookInputFields = {
  ...handbookContentFields,
  kind: handbookStoredKindValidator,
  // Legacy name of `comment`; `comment` wins when both are sent.
  note: v.optional(v.string()),
};

// Stored entries. Kind "page" and `note` only remain on entries `migratePagesToNotes` hasn't reached.
export const handbookEntryFields = {
  ...handbookContentFields,
  kind: handbookStoredKindValidator,
  note: v.optional(v.string()),
  order: v.number(),
};

export const handbookCredentialsValidator = v.object({
  username: v.optional(v.string()),
  secret: v.string(),
});

const handbookContentValidator = v.object(handbookContentFields);

const handbookInputValidator = v.object(handbookInputFields);

export type HandbookContent = Infer<typeof handbookContentValidator>;
export type HandbookInput = Infer<typeof handbookInputValidator>;
export type HandbookCredentials = Infer<typeof handbookCredentialsValidator>;
