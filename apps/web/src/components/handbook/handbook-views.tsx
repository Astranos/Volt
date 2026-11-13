import { useMemo, useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useMutation } from "convex/react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, KeyRound, Pencil, Pin, PinOff, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  BLANK_SUGGESTIONS,
  emptyField,
  entryFields,
  fieldDisplayValue,
  formatHandbookUpdated,
  groupHandbook,
  guideSummary,
  hasFieldRows,
  noteSummary,
  type HandbookDraft,
  type HandbookEntry,
  type HandbookEntryId,
} from "@volt/handbook";

import { api } from "../../../../../convex/_generated/api";
import {
  buttonClass,
  CopyButton,
  EntryIcon,
  FieldActions,
  FieldText,
  GuideSteps,
  GuideWarning,
  iconButtonClass,
  MarkdownView,
  Notice,
  primaryButtonClass,
  SecretFields,
  ValueFields,
  VariantToggle,
} from "./handbook-parts";

const cardClass = "overflow-hidden rounded-[1.2rem] border border-zinc-200 bg-white";
const sectionTitleClass = "mb-2 px-1 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500";

function rowSummary(entry: HandbookEntry) {
  return entry.kind === "guide" ? guideSummary(entry)
    : entry.kind === "note" ? noteSummary(entry)
      : entry.kind === "secret" ? entry.username ?? entry.secretPreview
        : entryFields(entry).map(fieldDisplayValue).join(" · ");
}

export function HandbookList({
  entries,
  categoryOrder,
  query,
  onOpen,
  onError,
}: {
  entries: HandbookEntry[];
  categoryOrder: string[];
  query: string;
  onOpen: (id: HandbookEntryId) => void;
  onError: (cause: unknown) => void;
}) {
  const reorder = useMutation(api.handbook.reorder);
  const setPinned = useMutation(api.handbook.setPinned);
  const groups = useMemo(() => groupHandbook(entries, categoryOrder), [entries, categoryOrder]);
  if (!groups.length) {
    return (
      <p className="rounded-[1.2rem] border border-dashed border-zinc-300 px-6 py-10 text-center text-sm text-zinc-500">
        {query ? <>No entries match “{query}”.</> : "No entries here yet."}
      </p>
    );
  }
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.title}>
          <h2 className={sectionTitleClass}>{group.title}</h2>
          <ul className={`${cardClass} divide-y divide-zinc-100`}>
            {group.entries.map((entry, index) => {
              // `order` is shared across categories, so in the mixed Pinned group an arrow swaps
              // with the nearest pinned entry of the same category; elsewhere, the next entry.
              const neighborFor = (offset: number) => {
                const candidates = offset < 0 ? group.entries.slice(0, index).reverse() : group.entries.slice(index + 1);
                return group.key === "pinned" ? candidates.find((other) => other.category === entry.category) : candidates[0];
              };
              const moveBy = (offset: number) => {
                const neighbor = neighborFor(offset)!._id;
                reorder({ ids: offset < 0 ? [entry._id, neighbor] : [neighbor, entry._id] }).catch(onError);
              };
              // Single values can be copied straight from the list.
              const [onlyField] = entry.kind === "value" && !hasFieldRows(entry) ? entryFields(entry) : [];
              return (
                <li key={entry._id} className="group flex items-center gap-2 pr-2 transition-colors hover:bg-zinc-50/80 sm:pr-3">
                  <button
                    type="button"
                    onClick={() => onOpen(entry._id)}
                    className="flex min-w-0 flex-1 items-center gap-3.5 py-3.5 pl-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 sm:pl-5"
                  >
                    <EntryIcon entry={entry} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-sm font-semibold text-zinc-950 group-hover:text-emerald-800">
                        <span className="truncate">{entry.title}</span>
                        {entry.pinned ? <Pin className="size-3 shrink-0 text-zinc-400" aria-label="Pinned" /> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-zinc-500">{rowSummary(entry)}</span>
                      {entry.comment ? <span className="mt-0.5 block truncate text-xs text-zinc-400">{entry.comment}</span> : null}
                    </span>
                  </button>
                  {/* Pin and reorder on hover, on larger screens. Phones pin from an entry's page. */}
                  <span className="hidden shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 sm:flex">
                    <button
                      type="button"
                      className={iconButtonClass}
                      aria-label={entry.pinned ? `Unpin ${entry.title}` : `Pin ${entry.title}`}
                      aria-pressed={entry.pinned}
                      title={entry.pinned ? "Unpin" : "Pin to the top"}
                      onClick={() => setPinned({ id: entry._id, pinned: !entry.pinned }).catch(onError)}
                    >
                      {entry.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                    </button>
                    <button type="button" className={iconButtonClass} aria-label={`Move ${entry.title} up`} disabled={!neighborFor(-1)} onClick={() => moveBy(-1)}>
                      <ArrowUp aria-hidden="true" />
                    </button>
                    <button type="button" className={iconButtonClass} aria-label={`Move ${entry.title} down`} disabled={!neighborFor(1)} onClick={() => moveBy(1)}>
                      <ArrowDown aria-hidden="true" />
                    </button>
                  </span>
                  {onlyField ? (
                    <CopyButton getText={() => fieldDisplayValue(onlyField)} />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-zinc-300" aria-hidden="true" />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function HandbookArticle({
  entry,
  onBack,
  onEdit,
  onDeleted,
  onError,
}: {
  entry: HandbookEntry;
  onBack: () => void;
  onEdit: () => void;
  onDeleted: () => void;
  onError: (cause: unknown) => void;
}) {
  const setPinned = useMutation(api.handbook.setPinned);
  const [variantIndex, setVariantIndex] = useState(0);
  const variants = entry.variants ?? [];
  const variant = variants[variantIndex] ?? variants[0];
  const [onlyField] = entry.kind === "value" && !hasFieldRows(entry) ? entryFields(entry) : [];

  return (
    <article className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 text-sm font-medium text-zinc-500 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {entry.category}
      </button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3.5">
          <EntryIcon entry={entry} />
          <div className="min-w-0">
            <h2 className="break-words text-2xl font-semibold tracking-tight text-zinc-950">{entry.title}</h2>
            <p className="mt-1 text-xs text-zinc-500">{formatHandbookUpdated(entry)}</p>
            {entry.comment ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-zinc-600">{entry.comment}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" className={buttonClass} onClick={() => setPinned({ id: entry._id, pinned: !entry.pinned }).catch(onError)}>
            {entry.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
            {entry.pinned ? "Unpin" : "Pin"}
          </button>
          <button type="button" className={buttonClass} onClick={onEdit}>
            <Pencil aria-hidden="true" />
            Edit
          </button>
          <DeleteEntryButton entry={entry} onDeleted={onDeleted} onError={onError} />
        </div>
      </div>

      {entry.kind === "secret" ? (
        <div className={cardClass}><SecretFields entry={entry} /></div>
      ) : hasFieldRows(entry) ? (
        <div className={cardClass}><ValueFields entry={entry} /></div>
      ) : onlyField ? (
        <div className={`${cardClass} flex items-center gap-3 px-4 py-4 sm:px-5`}>
          <div className="min-w-0 flex-1 break-words text-lg font-semibold text-zinc-950"><FieldText field={onlyField} /></div>
          <div className="flex shrink-0 items-center gap-1.5"><FieldActions field={onlyField} /></div>
        </div>
      ) : null}

      {entry.kind === "guide" && variant ? (
        <div className="space-y-4">
          {entry.body ? <p className="text-sm leading-6 text-zinc-600">{entry.body}</p> : null}
          <VariantToggle labels={variants.map((item) => item.label)} value={variantIndex} onChange={setVariantIndex} />
          <GuideSteps steps={variant.steps} />
          {variant.warning ? <GuideWarning>{variant.warning}</GuideWarning> : null}
        </div>
      ) : null}

      {entry.kind === "note" ? (
        <div className={`${cardClass} px-5 py-5 sm:px-7 sm:py-6`}><MarkdownView source={entry.body ?? ""} /></div>
      ) : entry.kind !== "guide" && entry.body ? (
        // Notes left on a quick value or login that were too long to fold into its comment.
        <section aria-label="Older text">
          <h3 className={sectionTitleClass}>Older text</h3>
          <div className={`${cardClass} whitespace-pre-wrap px-5 py-4 text-sm leading-6 text-zinc-700`}>{entry.body}</div>
        </section>
      ) : null}
    </article>
  );
}

function DeleteEntryButton({ entry, onDeleted, onError }: { entry: HandbookEntry; onDeleted: () => void; onError: (cause: unknown) => void }) {
  const remove = useMutation(api.handbook.remove);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirm = async () => {
    setDeleting(true);
    try {
      await remove({ id: entry._id });
      setOpen(false);
      onDeleted();
    } catch (cause) {
      setOpen(false);
      onError(cause);
    } finally {
      setDeleting(false);
    }
  };
  return (
    <AlertDialog.Root open={open} onOpenChange={setOpen}>
      <AlertDialog.Trigger className={`${buttonClass} w-9 px-0 text-red-600 hover:text-red-700`} aria-label={`Delete ${entry.title}`}>
        <Trash2 aria-hidden="true" />
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-[60] bg-zinc-950/50 backdrop-blur-sm" />
        <AlertDialog.Popup className="fixed left-1/2 top-1/2 z-[61] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[1.35rem] bg-white p-6 shadow-2xl outline-none">
          <AlertDialog.Title className="text-base font-semibold text-zinc-950">Delete “{entry.title}”?</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm leading-6 text-zinc-500">
            It's removed from the handbook everywhere, including the Chrome extension. This can't be undone.
          </AlertDialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <AlertDialog.Close className={`${buttonClass} h-10 px-4 text-sm`}>Cancel</AlertDialog.Close>
            <button
              type="button"
              disabled={deleting}
              onClick={() => void confirm()}
              className="inline-flex h-10 items-center justify-center rounded-[0.85rem] bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function HandbookEmpty({ onNew, onError }: { onNew: (defaults?: Partial<HandbookDraft>) => void; onError: (cause: unknown) => void }) {
  const addStarterEntries = useMutation(api.handbook.addStarterEntries);
  const [adding, setAdding] = useState(false);
  const addStarters = async () => {
    setAdding(true);
    try {
      await addStarterEntries({});
    } catch (cause) {
      onError(cause);
    } finally {
      setAdding(false);
    }
  };
  return (
    <Notice
      title="Start your store handbook"
      copy="Add the default setup guides in one click. Then fill in your store's phone, address, police line, and the logins your team uses."
    >
      <button type="button" className={primaryButtonClass} disabled={adding} onClick={() => void addStarters()}>
        <Sparkles aria-hidden="true" />
        {adding ? "Adding…" : "Add starter entries"}
      </button>
      <div className="mx-auto mt-5 flex max-w-xl flex-wrap justify-center gap-2">
        {BLANK_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.title}
            type="button"
            className={buttonClass}
            onClick={() => onNew({
              kind: suggestion.kind,
              category: suggestion.category,
              title: suggestion.title,
              comment: suggestion.comment,
              // Preset the value's type, so "Store phone" opens with phone formatting.
              ...("valueFormat" in suggestion ? { fields: [emptyField(suggestion.valueFormat)] } : {}),
            })}
          >
            {suggestion.kind === "secret" ? <KeyRound aria-hidden="true" /> : <Plus aria-hidden="true" />}
            Add {suggestion.title}{suggestion.kind === "secret" ? " login" : ""}
          </button>
        ))}
      </div>
      <button type="button" className={`${buttonClass} mt-3`} onClick={() => onNew()}>
        <Plus aria-hidden="true" />
        Write your own entry
      </button>
    </Notice>
  );
}
