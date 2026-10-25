import { useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import {
  DEFAULT_HANDBOOK_CATEGORIES,
  parseKeyCombo,
  type HandbookEntry,
  type HandbookEntryId,
} from "../../domain/handbook";
import { cn } from "../../lib/utils";

type Kind = HandbookEntry["kind"];
type DraftStep = { text: string; keys: string; command: string; tip: string };
type DraftVariant = { label: string; warning: string; steps: DraftStep[] };
export type HandbookDraft = {
  kind: Kind;
  title: string;
  category: string;
  note: string;
  value: string;
  body: string;
  pinned: boolean;
  variants: DraftVariant[];
  username: string;
  secret: string;
};

const KIND_OPTIONS: Array<{ kind: Kind; label: string }> = [
  { kind: "value", label: "Quick value" },
  { kind: "secret", label: "Login" },
  { kind: "guide", label: "Guide" },
];
const PLACEHOLDERS: Record<Kind, { title: string; category: string }> = {
  value: { title: "Store phone", category: "Store info" },
  secret: { title: "PSN", category: "Logins" },
  guide: { title: "Skip Windows sign-in", category: "Setup guides" },
};
const emptyStep = (): DraftStep => ({ text: "", keys: "", command: "", tip: "" });
const emptyVariant = (): DraftVariant => ({ label: "", warning: "", steps: [emptyStep()] });

export function draftFor(entry: HandbookEntry | null, defaults: Partial<HandbookDraft> = {}): HandbookDraft {
  return {
    kind: entry?.kind ?? "value",
    title: entry?.title ?? "",
    category: entry?.category ?? "",
    note: entry?.note ?? "",
    value: entry?.value ?? "",
    body: entry?.body ?? "",
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
      value: draft.kind === "value" ? draft.value : undefined,
      body: draft.body || undefined,
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
              onClick={() => set("kind", option.kind)}
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
        <Field label="Value to copy">
          <input value={draft.value} onChange={(event) => set("value", event.target.value)} placeholder="555-0100" required />
        </Field>
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

      <Field label="Notes">
        <textarea value={draft.body} onChange={(event) => set("body", event.target.value)} rows={4} />
      </Field>
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
