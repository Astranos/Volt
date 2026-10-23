import { v, type Infer } from "convex/values";

export const handbookKindValidator = v.union(v.literal("value"), v.literal("secret"), v.literal("guide"));

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
  body: v.optional(v.string()),
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
