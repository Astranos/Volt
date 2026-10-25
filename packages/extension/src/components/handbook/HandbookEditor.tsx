import { useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { ArrowDown, ArrowUp, Bold, Heading2, Italic, Link2, List, ListChecks, ListOrdered, Plus, Trash2 } from "lucide-react";
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
import { MarkdownView } from "./handbook-parts";

type Kind = HandbookEntry["kind"];
type DraftStep = { text: string; keys: string; command: string; tip: string };
type DraftVariant = { label: string; warning: string; steps: DraftStep[] };
export type DraftField = { label: string; format: HandbookValueFormat; value: string; address: AddressParts };
export type HandbookDraft = {
  kind: Kind;
  title: string;
  category: string;
  note: string;
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
  { kind: "page", label: "Page" },
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
  page: { title: "Opening checklist", category: "Procedures" },
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
    note: entry?.note ?? "",
    fields,
    // Quick values and logins no longer have notes; only guides (intro) and pages use this.
    body: entry?.kind === "guide" || entry?.kind === "page" ? entry.body ?? "" : "",
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
 * Changes an entry's type. Turning a quick value into a page moves the value into
 * the page (above any notes) so it isn't silently dropped on save.
 */
function switchKind(draft: HandbookDraft, kind: Kind): HandbookDraft {
  if (draft.kind !== "value" || kind !== "page") return { ...draft, kind };
  // Each value becomes a line ("Phone: 313-555-0100"), unless the page already has that exact line.
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

function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.match(/HANDBOOK_[A-Z_]+/)?.[0];
  return code
    ? code.replace(/^HANDBOOK_/, "").replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase()) + "."
    : message;
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

  const save = async () => {
    setSaving(true);
    setError(null);
    const content = {
      kind: draft.kind,
      title: draft.title,
      category: draft.category,
      note: draft.note || undefined,
      // `value`/`valueFormat` mirror the first field for older extensions; `fields` is the source of truth.
      value: draft.kind === "value" ? fieldValue(draft.fields[0]) : undefined,
      valueFormat: draft.kind === "value" ? draft.fields[0].format : undefined,
      fields: draft.kind === "value"
        ? draft.fields.map((field) => ({ label: field.label.trim() || undefined, value: fieldValue(field), format: field.format }))
        : undefined,
      body: draft.kind === "guide" || draft.kind === "page" ? draft.body || undefined : undefined,
      showInList: draft.kind === "page" ? draft.showInList : undefined,
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
      <Field label="Short note" hint="Shown next to the title, like “next to the bank” or “non-emergency”.">
        <input value={draft.note} onChange={(event) => set("note", event.target.value)} />
      </Field>

      {draft.kind === "value" ? (
        <ValueFieldsEditor fields={draft.fields} onChange={(fields) => set("fields", fields)} />
      ) : null}

      {draft.kind === "page" ? (
        <PageBodyEditor value={draft.body} onChange={(body) => set("body", body)} />
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
      {draft.kind === "page" ? (
        <label className="handbook-checkbox">
          <input type="checkbox" checked={draft.showInList} onChange={(event) => set("showInList", event.target.checked)} />
          <span>
            Show the whole page in the sidepanel list
            <span className="handbook-field-hint handbook-checkbox-hint">Best for short pages, so staff can read it without tapping in.</span>
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

type Wrap = { before: string; after?: string; placeholder: string; line?: boolean };
const TOOLS: Array<{ label: string; icon: ReactNode; wrap: Wrap }> = [
  { label: "Heading", icon: <Heading2 />, wrap: { before: "## ", placeholder: "Heading", line: true } },
  { label: "Bold", icon: <Bold />, wrap: { before: "**", after: "**", placeholder: "bold text" } },
  // Asterisks, not underscores, so italicizing words like sku_code_123 works.
  { label: "Italic", icon: <Italic />, wrap: { before: "*", after: "*", placeholder: "italic text" } },
  { label: "Bulleted list", icon: <List />, wrap: { before: "- ", placeholder: "List item", line: true } },
  { label: "Numbered list", icon: <ListOrdered />, wrap: { before: "1. ", placeholder: "First step", line: true } },
  { label: "Checklist", icon: <ListChecks />, wrap: { before: "- [ ] ", placeholder: "To do", line: true } },
  { label: "Link", icon: <Link2 />, wrap: { before: "[", after: "](https://)", placeholder: "link text" } },
];

/** A Markdown textarea with a formatting toolbar and a preview of how the page will look. */
function PageBodyEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [preview, setPreview] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const apply = ({ before, after = "", placeholder, line }: Wrap) => {
    const element = textarea.current;
    let start = element?.selectionStart ?? value.length;
    const end = element?.selectionEnd ?? value.length;
    let next: string;
    let selection: [number, number];
    if (line && start !== end) {
      // Line tools apply to every selected line: two lines become two checklist items.
      start = value.lastIndexOf("\n", start - 1) + 1;
      const lines = value.slice(start, end).split("\n").map((text) => (text.trim() ? `${before}${text}` : text));
      const replaced = lines.join("\n");
      next = `${value.slice(0, start)}${replaced}${value.slice(end)}`;
      selection = [start, start + replaced.length];
    } else {
      const selected = value.slice(start, end) || placeholder;
      // Line tools start on a fresh line.
      const lead = line && start > 0 && value[start - 1] !== "\n" ? "\n" : "";
      next = `${value.slice(0, start)}${lead}${before}${selected}${after}${value.slice(end)}`;
      const selectFrom = start + lead.length + before.length;
      selection = [selectFrom, selectFrom + selected.length];
    }
    onChange(next);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(...selection);
    });
  };

  return (
    <div className="handbook-field">
      <div className="handbook-page-editor-head">
        <span className="handbook-field-label">Page</span>
        <div className="handbook-segmented is-inline" role="tablist" aria-label="Page editor view">
          <button type="button" role="tab" aria-selected={!preview} className={cn(!preview && "is-active")} onClick={() => setPreview(false)}>Write</button>
          <button type="button" role="tab" aria-selected={preview} className={cn(preview && "is-active")} onClick={() => setPreview(true)}>Preview</button>
        </div>
      </div>
      {preview ? (
        <div className="mobile-scanner-card handbook-card handbook-page-preview">
          {value.trim() ? <MarkdownView source={value} /> : <p className="handbook-field-hint">Nothing to preview yet.</p>}
        </div>
      ) : (
        <>
          <div className="handbook-md-toolbar" role="toolbar" aria-label="Formatting">
            {TOOLS.map((tool) => (
              <button key={tool.label} type="button" className="handbook-button is-icon" aria-label={tool.label} title={tool.label} onClick={() => apply(tool.wrap)}>
                {tool.icon}
              </button>
            ))}
          </div>
          <textarea
            ref={textarea}
            className="handbook-page-textarea"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={14}
            placeholder={"## Before opening\n- [ ] Turn on the lights\n- [ ] Count the drawer\n\nCall the manager if anything is **missing**."}
            required
          />
          <span className="handbook-field-hint">Use the buttons, or type ## for a heading, - for a list, - [ ] for a checklist, and **bold**.</span>
        </>
      )}
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
