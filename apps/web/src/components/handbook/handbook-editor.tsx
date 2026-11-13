import { lazy, Suspense, useId, useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  DEFAULT_HANDBOOK_CATEGORIES,
  DRAFT_PLACEHOLDERS,
  FORMAT_OPTIONS,
  KIND_OPTIONS,
  MAX_DRAFT_FIELDS,
  MAX_DRAFT_VARIANTS,
  draftToSave,
  emptyField,
  emptyStep,
  emptyVariant,
  formatAddress,
  formatPhoneInput,
  formatPhoneTyping,
  handbookErrorText,
  hasOlderNotes,
  keepsSavedLogin,
  moveItem,
  switchFieldFormat,
  switchKind,
  type AddressParts,
  type DraftField,
  type DraftStep,
  type DraftVariant,
  type HandbookDraft,
  type HandbookEntry,
  type HandbookEntryId,
} from "@volt/handbook";

import { api } from "../../../../../convex/_generated/api";
import { buttonClass, iconButtonClass, primaryButtonClass } from "./handbook-parts";

const inputClass =
  "mt-1.5 block h-11 w-full rounded-[0.85rem] border border-zinc-300 bg-white px-3.5 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-[3px] focus:ring-emerald-500/15";
const compactInputClass =
  "block h-10 w-full rounded-[0.7rem] border border-zinc-300 bg-white px-3 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-[3px] focus:ring-emerald-500/15";
const textareaClass =
  "mt-1.5 block w-full resize-y rounded-[0.85rem] border border-zinc-300 bg-white px-3.5 py-2.5 text-sm leading-6 text-zinc-950 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-[3px] focus:ring-emerald-500/15";
const cardClass = "rounded-[1.2rem] border border-zinc-200 bg-white p-4 sm:p-5";

// CodeMirror only loads when someone writes a note.
const NoteEditor = lazy(() => import("./note-editor").then((module) => ({ default: module.NoteEditor })));

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
  const categoryListId = useId();
  const set = <Key extends keyof HandbookDraft>(key: Key, value: HandbookDraft[Key]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setVariant = (index: number, variant: DraftVariant) =>
    set("variants", draft.variants.map((item, itemIndex) => (itemIndex === index ? variant : item)));
  const keepsLogin = keepsSavedLogin(entry, draft);
  const olderNotes = hasOlderNotes(entry);

  const save = async () => {
    setSaving(true);
    setError(null);
    const { content, credentials } = draftToSave(draft, entry);
    try {
      if (entry) {
        await update({ id: entry._id, ...content, credentials });
        onSaved(entry._id);
      } else {
        onSaved(await create({ ...content, credentials }));
      }
    } catch (cause) {
      setError(handbookErrorText(cause));
    } finally {
      setSaving(false);
    }
  };

  const categoryOptions = [...new Set([...categories, ...DEFAULT_HANDBOOK_CATEGORIES])];

  return (
    <form
      className="space-y-5"
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight text-zinc-950">{entry ? "Edit entry" : "New entry"}</h2>
        <Segmented
          label="Entry type"
          options={KIND_OPTIONS.map((option) => ({ value: option.kind, label: option.label }))}
          value={draft.kind}
          onChange={(kind) => setDraft((current) => switchKind(current, kind))}
        />
      </div>

      <div className={`${cardClass} space-y-5`}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title">
            <input
              className={inputClass}
              value={draft.title}
              onChange={(event) => set("title", event.target.value)}
              placeholder={DRAFT_PLACEHOLDERS[draft.kind].title}
              required
              autoFocus
            />
          </Field>
          <Field label="Category">
            <input
              className={inputClass}
              value={draft.category}
              onChange={(event) => set("category", event.target.value)}
              list={categoryListId}
              placeholder={DRAFT_PLACEHOLDERS[draft.kind].category}
              required
            />
            <datalist id={categoryListId}>
              {categoryOptions.map((category) => <option key={category} value={category} />)}
            </datalist>
          </Field>
        </div>

        {draft.kind === "value" ? <ValueFieldsEditor fields={draft.fields} onChange={(fields) => set("fields", fields)} /> : null}

        {draft.kind === "note" ? (
          <Suspense fallback={<div className="h-[360px] animate-pulse rounded-[0.85rem] bg-zinc-100" role="status" aria-label="Loading the note editor" />}>
            <NoteEditor value={draft.body} onChange={(body) => set("body", body)} />
          </Suspense>
        ) : null}

        {draft.kind === "secret" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Username or email">
              <input
                className={inputClass}
                value={draft.username}
                onChange={(event) => set("username", event.target.value)}
                placeholder={keepsLogin ? "Leave blank to keep the saved login" : ""}
                autoComplete="off"
              />
            </Field>
            <Field
              label="Password"
              hint={keepsLogin ? "Leave blank to keep the saved password." : "Hidden in lists. Shown only when someone reveals or copies it."}
            >
              <input
                className={inputClass}
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
          <Field label="Intro (optional)" hint="A line shown above the steps, like “For Windows: no password.”">
            <textarea className={textareaClass} value={draft.body} onChange={(event) => set("body", event.target.value)} rows={2} />
          </Field>
        ) : null}
      </div>

      {draft.kind === "guide" ? (
        <div className="space-y-4">
          {draft.variants.map((variant, variantIndex) => (
            <GuideMethodEditor
              key={variantIndex}
              variant={variant}
              index={variantIndex}
              count={draft.variants.length}
              onChange={(next) => setVariant(variantIndex, next)}
              onRemove={() => set("variants", draft.variants.filter((_, index) => index !== variantIndex))}
            />
          ))}
          {draft.variants.length < MAX_DRAFT_VARIANTS ? (
            <button type="button" className={buttonClass} onClick={() => set("variants", [...draft.variants, emptyVariant()])}>
              <Plus aria-hidden="true" />
              Add another method
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={`${cardClass} space-y-4`}>
        {/* Below the main content: extra context, not what the entry is about. */}
        <Field label="Comment (optional)" hint="Shown under the title, like “next to the bank” or “non-emergency”.">
          <textarea className={textareaClass} value={draft.comment} onChange={(event) => set("comment", event.target.value)} rows={2} />
        </Field>
        {(draft.kind === "value" || draft.kind === "secret") && olderNotes ? (
          <Field label="Older text" hint="Left from an earlier version. Move what you need into the comment (or a note), then clear this.">
            <textarea className={textareaClass} value={draft.body} onChange={(event) => set("body", event.target.value)} rows={3} />
          </Field>
        ) : null}
        {draft.kind === "note" ? (
          <Checkbox
            checked={draft.showInList}
            onChange={(checked) => set("showInList", checked)}
            label="Show the whole note in the extension's sidepanel list"
            hint="Best for short notes, so staff can read it without tapping in."
          />
        ) : null}
        <Checkbox checked={draft.pinned} onChange={(checked) => set("pinned", checked)} label="Pin to the top of the handbook" />
      </div>

      {error ? (
        <p className="rounded-[1rem] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={`${buttonClass} h-10 px-4 text-sm`} onClick={onCancel}>Cancel</button>
        <button type="submit" className={primaryButtonClass} disabled={saving}>
          {saving ? "Saving…" : entry ? "Save changes" : "Add entry"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs leading-5 text-zinc-500">{hint}</span> : null}
    </label>
  );
}

function Checkbox({ checked, onChange, label, hint }: { checked: boolean; onChange: (checked: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm text-zinc-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 rounded border-zinc-300 accent-emerald-600"
      />
      <span>
        {label}
        {hint ? <span className="mt-0.5 block text-xs leading-5 text-zinc-500">{hint}</span> : null}
      </span>
    </label>
  );
}

function Segmented<Value extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: Value; label: string }>;
  value: Value;
  onChange: (value: Value) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-[0.85rem] bg-zinc-100 p-1" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-[0.6rem] px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${value === option.value ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:text-zinc-900"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function GuideMethodEditor({
  variant,
  index,
  count,
  onChange,
  onRemove,
}: {
  variant: DraftVariant;
  index: number;
  count: number;
  onChange: (variant: DraftVariant) => void;
  onRemove: () => void;
}) {
  const setStep = (stepIndex: number, next: DraftStep) =>
    onChange({ ...variant, steps: variant.steps.map((item, itemIndex) => (itemIndex === stepIndex ? next : item)) });
  return (
    <fieldset className={`${cardClass} space-y-4`}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Field label={count > 1 ? `Method ${index + 1} name` : "Method name (optional)"}>
            <input
              className={inputClass}
              value={variant.label}
              onChange={(event) => onChange({ ...variant, label: event.target.value })}
              placeholder="New method (24H2+)"
            />
          </Field>
        </div>
        {count > 1 ? (
          <button type="button" className={`${buttonClass} h-11 text-red-700 hover:text-red-800`} onClick={onRemove}>
            <Trash2 aria-hidden="true" />
            Remove method
          </button>
        ) : null}
      </div>
      <ol className="space-y-3">
        {variant.steps.map((step, stepIndex) => (
          <li key={stepIndex} className="flex gap-3 rounded-[1rem] bg-zinc-50 p-3">
            <span className="mt-2 grid size-6 shrink-0 place-items-center rounded-full bg-white text-xs font-bold text-zinc-700 ring-1 ring-zinc-200">
              {stepIndex + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-2">
              <input
                className={compactInputClass}
                value={step.text}
                onChange={(event) => setStep(stepIndex, { ...step, text: event.target.value })}
                placeholder="What to do"
                aria-label={`Step ${stepIndex + 1}`}
                required
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  className={compactInputClass}
                  value={step.keys}
                  onChange={(event) => setStep(stepIndex, { ...step, keys: event.target.value })}
                  placeholder="Keys, e.g. Shift + F10"
                  aria-label="Keys"
                />
                <input
                  className={`${compactInputClass} font-mono`}
                  value={step.command}
                  onChange={(event) => setStep(stepIndex, { ...step, command: event.target.value })}
                  placeholder="Command to copy"
                  aria-label="Command"
                />
              </div>
              <input
                className={compactInputClass}
                value={step.tip}
                onChange={(event) => setStep(stepIndex, { ...step, tip: event.target.value })}
                placeholder="Tip (optional)"
                aria-label="Tip"
              />
            </div>
            <div className="flex shrink-0 flex-col gap-0.5">
              <button type="button" className={iconButtonClass} aria-label="Move step up" disabled={stepIndex === 0}
                onClick={() => onChange({ ...variant, steps: moveItem(variant.steps, stepIndex, -1) })}>
                <ArrowUp aria-hidden="true" />
              </button>
              <button type="button" className={iconButtonClass} aria-label="Move step down" disabled={stepIndex === variant.steps.length - 1}
                onClick={() => onChange({ ...variant, steps: moveItem(variant.steps, stepIndex, 1) })}>
                <ArrowDown aria-hidden="true" />
              </button>
              <button type="button" className={`${iconButtonClass} hover:text-red-700`} aria-label="Remove step" disabled={variant.steps.length === 1}
                onClick={() => onChange({ ...variant, steps: variant.steps.filter((_, itemIndex) => itemIndex !== stepIndex) })}>
                <Trash2 aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className={buttonClass} onClick={() => onChange({ ...variant, steps: [...variant.steps, emptyStep()] })}>
        <Plus aria-hidden="true" />
        Add step
      </button>
      <Field label="Warning (optional)" hint="Shown under the steps, for example what to do if a command fails.">
        <input className={inputClass} value={variant.warning} onChange={(event) => onChange({ ...variant, warning: event.target.value })} />
      </Field>
    </fieldset>
  );
}

function AddressFields({ value, onChange }: { value: AddressParts; onChange: (value: AddressParts) => void }) {
  const set = (key: keyof AddressParts, next: string) => onChange({ ...value, [key]: next });
  return (
    <div className="space-y-3">
      <Field label="Street">
        <input className={inputClass} value={value.street} onChange={(event) => set("street", event.target.value)} placeholder="9058 Telegraph Rd" autoComplete="street-address" required />
      </Field>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)] gap-3">
        <Field label="City">
          <input className={inputClass} value={value.city} onChange={(event) => set("city", event.target.value)} placeholder="Taylor" autoComplete="address-level2" />
        </Field>
        <Field label="State">
          <input
            className={inputClass}
            value={value.state}
            onChange={(event) => set("state", event.target.value.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase())}
            placeholder="MI"
            autoComplete="address-level1"
          />
        </Field>
        <Field label="ZIP">
          <input
            className={inputClass}
            value={value.zip}
            onChange={(event) => set("zip", event.target.value.replace(/[^\d-]/g, "").slice(0, 10))}
            inputMode="numeric"
            placeholder="48180"
            autoComplete="postal-code"
          />
        </Field>
      </div>
      <p className="text-xs leading-5 text-zinc-500">Saved as “{formatAddress(value) || "9058 Telegraph Rd, Taylor, MI 48180"}”.</p>
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
      className={inputClass}
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
    <div className="space-y-3">
      {fields.map((field, index) => (
        <fieldset key={index} className={several ? "space-y-4 rounded-[1rem] bg-zinc-50 p-4" : "space-y-4"}>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Field label={several ? `Value ${index + 1} label` : "Label (optional)"}>
              <input
                className={inputClass}
                value={field.label}
                onChange={(event) => setField(index, { ...field, label: event.target.value })}
                placeholder={several ? "Phone, Address, Network…" : "Only needed with more than one value"}
              />
            </Field>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-zinc-700">Type</span>
              <Segmented
                label={`Value ${index + 1} type`}
                options={FORMAT_OPTIONS.map((option) => ({ value: option.format, label: option.label }))}
                value={field.format}
                onChange={(format) => setField(index, switchFieldFormat(field, format))}
              />
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
              <input className={inputClass} value={field.value} onChange={(event) => setField(index, { ...field, value: event.target.value })} required />
            </Field>
          )}
          {several ? (
            <div className="flex items-center gap-1">
              <button type="button" className={iconButtonClass} aria-label={`Move value ${index + 1} up`} disabled={index === 0}
                onClick={() => onChange(moveItem(fields, index, -1))}>
                <ArrowUp aria-hidden="true" />
              </button>
              <button type="button" className={iconButtonClass} aria-label={`Move value ${index + 1} down`} disabled={index === fields.length - 1}
                onClick={() => onChange(moveItem(fields, index, 1))}>
                <ArrowDown aria-hidden="true" />
              </button>
              <button type="button" className={`${buttonClass} ml-auto text-red-700 hover:text-red-800`} onClick={() => onChange(fields.filter((_, i) => i !== index))}>
                <Trash2 aria-hidden="true" />
                Remove value
              </button>
            </div>
          ) : null}
        </fieldset>
      ))}
      {fields.length < MAX_DRAFT_FIELDS ? (
        <button type="button" className={buttonClass} onClick={() => onChange([...fields, emptyField()])}>
          <Plus aria-hidden="true" />
          Add another value
        </button>
      ) : null}
    </div>
  );
}
