import { useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import {
  DEFAULT_HANDBOOK_CATEGORIES,
  parseKeyCombo,
  type HandbookEntry,
  type HandbookEntryId,
} from "../../domain/handbook";
import {
  entryFields,
  formatAddress,
  formatPhoneInput,
  formatPhoneTyping,
  parseAddress,
  type AddressParts,
  type HandbookValueFormat,
} from "../../domain/handbook-format";
import { cn } from "../../lib/utils";
import { NoteEditor } from "./NoteEditor";

type Kind = HandbookEntry["kind"];
type DraftStep = { text: string; keys: string; command: string; tip: string };
type DraftVariant = { label: string; warning: string; steps: DraftStep[] };
export type DraftField = { label: string; format: HandbookValueFormat; value: string; address: AddressParts };
export type HandbookDraft = {
  kind: Kind;
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

const KIND_OPTIONS: Array<{ kind: Kind; label: string }> = [
  { kind: "value", label: "Quick value" },
  { kind: "secret", label: "Login" },
  { kind: "guide", label: "Guide" },
  { kind: "note", label: "Note" },
];
const FORMAT_OPTIONS: Array<{ format: HandbookValueFormat; label: string }> = [
  { format: "text", label: "Text" },
  { format: "phone", label: "Phone" },
  { format: "address", label: "Address" },
];
const PLACEHOLDERS: Record<Kind, { title: string; category: string }> = {
  value: { title: "Store phone", category: "Store info" },
  secret: { title: "PSN", category: "Logins" },
  guide: { title: "Skip Windows sign-in", category: "Setup guides" },
  note: { title: "Opening checklist", category: "Procedures" },
};
const emptyAddress = (): AddressParts => ({ street: "", city: "", state: "", zip: "" });
export const emptyField = (format: HandbookValueFormat = "text"): DraftField => ({ label: "", format, value: "", address: emptyAddress() });
const MAX_FIELDS = 8;
const fieldValue = (field: DraftField) => (field.format === "address" ? formatAddress(field.address) : field.value);
const emptyStep = (): DraftStep => ({ text: "", keys: "", command: "", tip: "" });
const emptyVariant = (): DraftVariant => ({ label: "", warning: "", steps: [emptyStep()] });

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
function switchKind(draft: HandbookDraft, kind: Kind): HandbookDraft {
  if (draft.kind !== "value" || kind !== "note") return { ...draft, kind };
  // Each value becomes a line ("Phone: 313-555-0100"), unless the note already has that exact line.
  const lines = draft.fields
    .map((field) => [field.label.trim(), fieldValue(field).trim()])
    .filter(([, value]) => value)
    .map(([label, value]) => (label ? `${label}: ${value}` : value));
  const existing = new Set(draft.body.split("\n").map((line) => line.trim()));
  const added = lines.filter((line) => !existing.has(line));
  const body = added.length ? [added.join("\n"), draft.body].filter(Boolean).join("\n\n") : draft.body;
  return { ...draft, kind, body };
}

function move<T>(items: T[], index: number, offset: number) {
  const target = index + offset;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// Codes named before notes were called pages and short notes were called notes.
const RENAMED_ERRORS: Record<string, string> = {
  HANDBOOK_NOTE_TOO_LONG: "Comment too long.",
  HANDBOOK_PAGE_REQUIRED: "Write something in the note before saving.",
  HANDBOOK_PAGE_TOO_LONG: "Note too long.",
};

function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.match(/HANDBOOK_[A-Z_]+/)?.[0];
  if (!code) return message;
  return RENAMED_ERRORS[code] ?? code.replace(/^HANDBOOK_/, "").replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase()) + ".";
}

export function HandbookEditor({
  entry,
  initial,
  categories,
  onSaved,
  onCancel,
}: {
  entry: HandbookEntry | null;
  initial: HandbookDraft;
  categories: string[];
  onSaved: (id: HandbookEntryId) => void;
  onCancel: () => void;
}) {
  const create = useMutation(api.handbook.create);
  const update = useMutation(api.handbook.update);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <Key extends keyof HandbookDraft>(key: Key, value: HandbookDraft[Key]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setVariant = (index: number, variant: DraftVariant) =>
    set("variants", draft.variants.map((item, itemIndex) => (itemIndex === index ? variant : item)));
  const keepsLogin = entry?.kind === "secret" && draft.kind === "secret";
  // Notes left on a saved quick value or login from an earlier version. A note's or guide's
  // text never counts as that, even after switching the type here.
  const hadOlderNotes = (entry?.kind === "value" || entry?.kind === "secret") && Boolean(entry.body?.trim());
  const keepsBody = draft.kind === "guide" || draft.kind === "note" || hadOlderNotes;

  const save = async () => {
    setSaving(true);
    setError(null);
    const content = {
      kind: draft.kind,
      title: draft.title,
      category: draft.category,
      comment: draft.comment || undefined,
      // `value`/`valueFormat` mirror the first field for older extensions; `fields` is the source of truth.
      value: draft.kind === "value" ? fieldValue(draft.fields[0]) : undefined,
      valueFormat: draft.kind === "value" ? draft.fields[0].format : undefined,
      // An empty list for other kinds tells the server this editor already moved the values
      // (into a note, say); its fallback for older extensions would otherwise add them again.
      fields: draft.kind === "value"
        ? draft.fields.map((field) => ({ label: field.label.trim() || undefined, value: fieldValue(field), format: field.format }))
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
    const credentials = draft.kind === "secret" && (draft.secret || draft.username || !keepsLogin)
      ? { username: draft.username || undefined, secret: draft.secret }
      : undefined;
    try {
      if (entry) {
        await update({ id: entry._id, ...content, credentials });
        onSaved(entry._id);
      } else {
        onSaved(await create({ ...content, credentials }));
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  };

  const categoryOptions = [...new Set([...categories, ...DEFAULT_HANDBOOK_CATEGORIES])];

  return (
    <form
      className="handbook-editor"
      onSubmit={(event) => {
        event.preventDefault();
        // The note editor isn't a form field, so it can't be `required`.
        if (draft.kind === "note" && !draft.body.trim()) {
          setError("Write something in the note before saving.");
          return;
        }
        void save();
      }}
    >
      <div className="handbook-editor-head">
        <h1 className="handbook-article-title">{entry ? "Edit entry" : "New entry"}</h1>
        <div className="handbook-segmented" role="radiogroup" aria-label="Entry type">
          {KIND_OPTIONS.map((option) => (
            <button
              key={option.kind}
              type="button"
              role="radio"
              aria-checked={draft.kind === option.kind}
              className={cn(draft.kind === option.kind && "is-active")}
              onClick={() => setDraft((current) => switchKind(current, option.kind))}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="handbook-field-row">
        <Field label="Title">
          <input value={draft.title} onChange={(event) => set("title", event.target.value)} placeholder={PLACEHOLDERS[draft.kind].title} required autoFocus />
        </Field>
        <Field label="Category">
          <input
            value={draft.category}
            onChange={(event) => set("category", event.target.value)}
            list="handbook-categories"
            placeholder={PLACEHOLDERS[draft.kind].category}
            required
          />
          <datalist id="handbook-categories">
            {categoryOptions.map((category) => <option key={category} value={category} />)}
          </datalist>
        </Field>
      </div>
      {draft.kind === "value" ? (
        <ValueFieldsEditor fields={draft.fields} onChange={(fields) => set("fields", fields)} />
      ) : null}

      {draft.kind === "note" ? (
        <NoteEditor value={draft.body} onChange={(body) => set("body", body)} />
      ) : null}

      {draft.kind === "secret" ? (
        <div className="handbook-field-row">
          <Field label="Username or email">
            <input
              value={draft.username}
              onChange={(event) => set("username", event.target.value)}
              placeholder={keepsLogin ? "Leave blank to keep the saved login" : ""}
              autoComplete="off"
            />
          </Field>
          <Field label="Password" hint={keepsLogin ? "Leave blank to keep the saved password." : "Hidden in lists. Shown only when someone reveals or copies it."}>
            <input
              type="password"
              value={draft.secret}
              onChange={(event) => set("secret", event.target.value)}
              autoComplete="new-password"
              required={!keepsLogin}
            />
          </Field>
        </div>
      ) : null}

      {draft.kind === "guide" ? (
        <div className="handbook-variants">
          {draft.variants.map((variant, variantIndex) => (
            <fieldset key={variantIndex} className="mobile-scanner-card handbook-variant">
              <div className="handbook-field-row">
                <Field label={draft.variants.length > 1 ? `Method ${variantIndex + 1} name` : "Method name (optional)"}>
                  <input
                    value={variant.label}
                    onChange={(event) => setVariant(variantIndex, { ...variant, label: event.target.value })}
                    placeholder="New method (24H2+)"
                  />
                </Field>
                {draft.variants.length > 1 ? (
                  <button
                    type="button"
                    className="handbook-button is-danger handbook-variant-remove"
                    onClick={() => set("variants", draft.variants.filter((_, index) => index !== variantIndex))}
                  >
                    <Trash2 aria-hidden="true" />
                    Remove method
                  </button>
                ) : null}
              </div>
              <ol className="handbook-step-editor">
                {variant.steps.map((step, stepIndex) => {
                  const setStep = (next: DraftStep) => setVariant(variantIndex, {
                    ...variant,
                    steps: variant.steps.map((item, index) => (index === stepIndex ? next : item)),
                  });
                  return (
                    <li key={stepIndex}>
                      <span className="handbook-step-number is-upcoming">{stepIndex + 1}</span>
                      <div className="handbook-step-fields">
                        <input
                          value={step.text}
                          onChange={(event) => setStep({ ...step, text: event.target.value })}
                          placeholder="What to do"
                          aria-label={`Step ${stepIndex + 1}`}
                          required
                        />
                        <div className="handbook-field-row is-compact">
                          <input value={step.keys} onChange={(event) => setStep({ ...step, keys: event.target.value })} placeholder="Keys, e.g. Shift + F10" aria-label="Keys" />
                          <input className="handbook-mono" value={step.command} onChange={(event) => setStep({ ...step, command: event.target.value })} placeholder="Command to copy" aria-label="Command" />
                        </div>
                        <input value={step.tip} onChange={(event) => setStep({ ...step, tip: event.target.value })} placeholder="Tip (optional)" aria-label="Tip" />
                      </div>
                      <div className="handbook-step-tools">
                        <button type="button" className="handbook-button is-icon" aria-label="Move step up" disabled={stepIndex === 0}
                          onClick={() => setVariant(variantIndex, { ...variant, steps: move(variant.steps, stepIndex, -1) })}>
                          <ArrowUp aria-hidden="true" />
                        </button>
                        <button type="button" className="handbook-button is-icon" aria-label="Move step down" disabled={stepIndex === variant.steps.length - 1}
                          onClick={() => setVariant(variantIndex, { ...variant, steps: move(variant.steps, stepIndex, 1) })}>
                          <ArrowDown aria-hidden="true" />
                        </button>
                        <button type="button" className="handbook-button is-icon is-danger" aria-label="Remove step" disabled={variant.steps.length === 1}
                          onClick={() => setVariant(variantIndex, { ...variant, steps: variant.steps.filter((_, index) => index !== stepIndex) })}>
                          <Trash2 aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <button type="button" className="handbook-button" onClick={() => setVariant(variantIndex, { ...variant, steps: [...variant.steps, emptyStep()] })}>
                <Plus aria-hidden="true" />
                Add step
              </button>
              <Field label="Warning (optional)" hint="Shown under the steps, for example what to do if a command fails.">
                <input value={variant.warning} onChange={(event) => setVariant(variantIndex, { ...variant, warning: event.target.value })} />
              </Field>
            </fieldset>
          ))}
          {draft.variants.length < 4 ? (
            <button type="button" className="handbook-button" onClick={() => set("variants", [...draft.variants, emptyVariant()])}>
              <Plus aria-hidden="true" />
              Add another method
            </button>
          ) : null}
        </div>
      ) : null}

      {draft.kind === "guide" ? (
        <Field label="Intro (optional)" hint="A line shown above the steps, like “For Windows: no password.”">
          <textarea value={draft.body} onChange={(event) => set("body", event.target.value)} rows={2} />
        </Field>
      ) : null}
      {/* Below the main content: it's a one-line extra, not what the entry is about. */}
      <Field label="Comment (optional)" hint="Shown under the title, like “next to the bank” or “non-emergency”.">
        <input value={draft.comment} onChange={(event) => set("comment", event.target.value)} />
      </Field>
      {(draft.kind === "value" || draft.kind === "secret") && hadOlderNotes ? (
        <Field label="Older text" hint="Left from an earlier version. Move what you need into the comment (or a note), then clear this.">
          <textarea value={draft.body} onChange={(event) => set("body", event.target.value)} rows={3} />
        </Field>
      ) : null}
      {draft.kind === "note" ? (
        <label className="handbook-checkbox">
          <input type="checkbox" checked={draft.showInList} onChange={(event) => set("showInList", event.target.checked)} />
          <span>
            Show the whole note in the sidepanel list
            <span className="handbook-field-hint handbook-checkbox-hint">Best for short notes, so staff can read it without tapping in.</span>
          </span>
        </label>
      ) : null}
      <label className="handbook-checkbox">
        <input type="checkbox" checked={draft.pinned} onChange={(event) => set("pinned", event.target.checked)} />
        Pin to the top of the handbook
      </label>

      {error ? <p className="handbook-editor-error" role="alert">{error}</p> : null}
      <div className="handbook-editor-actions">
        <button type="button" className="handbook-button is-wide" onClick={onCancel}>Cancel</button>
        <button type="submit" className="handbook-button is-primary is-wide" disabled={saving}>
          {saving ? "Saving…" : entry ? "Save changes" : "Add entry"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="handbook-field">
      <span className="handbook-field-label">{label}</span>
      {children}
      {hint ? <span className="handbook-field-hint">{hint}</span> : null}
    </label>
  );
}

function AddressFields({ value, onChange }: { value: AddressParts; onChange: (value: AddressParts) => void }) {
  const set = (key: keyof AddressParts, next: string) => onChange({ ...value, [key]: next });
  return (
    <div className="handbook-address-fields">
      <Field label="Street">
        <input value={value.street} onChange={(event) => set("street", event.target.value)} placeholder="9058 Telegraph Rd" autoComplete="street-address" required />
      </Field>
      <div className="handbook-field-row is-address">
        <Field label="City">
          <input value={value.city} onChange={(event) => set("city", event.target.value)} placeholder="Taylor" autoComplete="address-level2" />
        </Field>
        <Field label="State">
          <input
            value={value.state}
            onChange={(event) => set("state", event.target.value.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase())}
            placeholder="MI"
            autoComplete="address-level1"
          />
        </Field>
        <Field label="ZIP">
          <input
            value={value.zip}
            onChange={(event) => set("zip", event.target.value.replace(/[^\d-]/g, "").slice(0, 10))}
            inputMode="numeric"
            placeholder="48180"
            autoComplete="postal-code"
          />
        </Field>
      </div>
      <p className="handbook-field-hint">Saved as “{formatAddress(value) || "9058 Telegraph Rd, Taylor, MI 48180"}”.</p>
    </div>
  );
}

/**
 * A phone field that adds dashes as you type. Deleting never re-adds what was just
 * removed (the number is tidied when the field loses focus), and the caret stays
 * after the same digit when formatting shifts the text.
 */
function PhoneInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <input
      ref={input}
      value={value}
      inputMode="tel"
      placeholder="313-555-0100"
      required
      onBlur={() => onChange(formatPhoneInput(value))}
      onChange={(event) => {
        const raw = event.target.value;
        if ((event.nativeEvent as InputEvent).inputType?.startsWith("delete")) {
          onChange(raw);
          return;
        }
        const { value: formatted, caret } = formatPhoneTyping(raw, event.target.selectionStart ?? raw.length);
        onChange(formatted);
        if (formatted !== raw) requestAnimationFrame(() => input.current?.setSelectionRange(caret, caret));
      }}
    />
  );
}

/**
 * A quick value's values: one or more, each with an optional label, a type, and its
 * own input. A single unlabeled value is the classic "copy this" entry.
 */
function ValueFieldsEditor({ fields, onChange }: { fields: DraftField[]; onChange: (fields: DraftField[]) => void }) {
  const setField = (index: number, next: DraftField) => onChange(fields.map((field, i) => (i === index ? next : field)));
  const several = fields.length > 1;
  return (
    <div className="handbook-value-fields">
      {fields.map((field, index) => (
        <fieldset key={index} className={cn("handbook-value-field", several && "mobile-scanner-card")}>
          <div className="handbook-field-row">
            <Field label={several ? `Value ${index + 1} label` : "Label (optional)"}>
              <input
                value={field.label}
                onChange={(event) => setField(index, { ...field, label: event.target.value })}
                placeholder={several ? "Phone, Address, Network…" : "Only needed with more than one value"}
              />
            </Field>
            <div className="handbook-field">
              <span className="handbook-field-label">Type</span>
              <div className="handbook-segmented is-inline" role="radiogroup" aria-label={`Value ${index + 1} type`}>
                {FORMAT_OPTIONS.map((option) => (
                  <button
                    key={option.format}
                    type="button"
                    role="radio"
                    aria-checked={field.format === option.format}
                    className={cn(field.format === option.format && "is-active")}
                    // Carry what's typed across, so switching types doesn't lose it.
                    onClick={() => setField(index, {
                      ...field,
                      format: option.format,
                      address: option.format === "address" && field.format !== "address" ? parseAddress(field.value) : field.address,
                      value: field.format === "address" && option.format !== "address" ? formatAddress(field.address)
                        : option.format === "phone" ? formatPhoneInput(field.value) : field.value,
                    })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {field.format === "address" ? (
            <AddressFields value={field.address} onChange={(address) => setField(index, { ...field, address })} />
          ) : field.format === "phone" ? (
            <Field label="Phone number" hint="Dashes are added as you type. Add an extension with “x”, like 734-287-6611 x6.">
              <PhoneInput value={field.value} onChange={(value) => setField(index, { ...field, value })} />
            </Field>
          ) : (
            <Field label="Value to copy">
              <input value={field.value} onChange={(event) => setField(index, { ...field, value: event.target.value })} required />
            </Field>
          )}
          {several ? (
            <div className="handbook-value-field-tools">
              <button type="button" className="handbook-button is-icon" aria-label={`Move value ${index + 1} up`} disabled={index === 0}
                onClick={() => onChange(move(fields, index, -1))}>
                <ArrowUp aria-hidden="true" />
              </button>
              <button type="button" className="handbook-button is-icon" aria-label={`Move value ${index + 1} down`} disabled={index === fields.length - 1}
                onClick={() => onChange(move(fields, index, 1))}>
                <ArrowDown aria-hidden="true" />
              </button>
              <button type="button" className="handbook-button is-danger" onClick={() => onChange(fields.filter((_, i) => i !== index))}>
                <Trash2 aria-hidden="true" />
                Remove value
              </button>
            </div>
          ) : null}
        </fieldset>
      ))}
      {fields.length < MAX_FIELDS ? (
        <button type="button" className="handbook-button handbook-add-value" onClick={() => onChange([...fields, emptyField()])}>
          <Plus aria-hidden="true" />
          Add another value
        </button>
      ) : null}
    </div>
  );
}
