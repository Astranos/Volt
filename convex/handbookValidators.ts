import { v, type Infer } from "convex/values";

// "page" is a formatted article. Clients from before pages existed never receive them (see `list`).
export const handbookKindValidator = v.union(v.literal("value"), v.literal("secret"), v.literal("guide"), v.literal("page"));

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

// Everything an editor can write. Secret values are passed separately and never
// stored on the entry itself.
export const handbookContentFields = {
  kind: handbookKindValidator,
  title: v.string(),
  category: v.string(),
  // Short context shown with the title, e.g. "right off Wick".
  note: v.optional(v.string()),
  // The copyable value of a "value" entry.
  value: v.optional(v.string()),
  valueFormat: v.optional(handbookValueFormatValidator),
  // Several labeled values to copy. When set, `value`/`valueFormat` mirror the first one so
  // extensions released before fields existed still show and copy something sensible.
  fields: v.optional(v.array(handbookFieldValidator)),
  // Notes for most kinds; the formatted content (a small Markdown subset) of a page.
  body: v.optional(v.string()),
  // Pages only: show the whole page in the sidepanel list instead of a row to tap.
  showInList: v.optional(v.boolean()),
  // Guide steps. A guide without alternatives has one variant with an empty label.
  variants: v.optional(v.array(handbookVariantValidator)),
  pinned: v.boolean(),
};

export const handbookEntryFields = { ...handbookContentFields, order: v.number() };

export const handbookCredentialsValidator = v.object({
  username: v.optional(v.string()),
  secret: v.string(),
});

const handbookContentValidator = v.object(handbookContentFields);

export type HandbookContent = Infer<typeof handbookContentValidator>;
export type HandbookCredentials = Infer<typeof handbookCredentialsValidator>;
