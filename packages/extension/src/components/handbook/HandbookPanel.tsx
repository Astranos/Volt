import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, LogIn, Search, Sparkles } from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import {
  filterHandbook,
  formatHandbookUpdated,
  groupHandbook,
  guideSummary,
  HANDBOOK_OPEN_ENTRY_KEY,
  HANDBOOK_PAGE_PATH,
  pageSummary,
  type HandbookEntry,
  type HandbookEntryId,
} from "../../domain/handbook";
import { hasFieldRows } from "../../domain/handbook-format";
import { useHandbookCategoryOrder, useHandbookEntries } from "../../hooks/useHandbookEntries";
import { cn } from "../../lib/utils";
import { SidepanelSignInCard, useSidepanelSignIn, useSidepanelSignedIn } from "../access/ExtensionAccess";
import SidepanelLayout from "../sidepanel/SidepanelLayout";
import {
  EntryFields,
  EntryIcon,
  GuideWarning,
  MarkdownView,
  StepDetails,
  StepNumber,
  ValueActions,
  ValueText,
  VariantToggle,
} from "./handbook-parts";

// A request older than this was left behind by a panel that never opened.
const OPEN_REQUEST_TTL_MS = 60_000;

function openFullHandbook() {
  void chrome.tabs.create({ url: chrome.runtime.getURL(HANDBOOK_PAGE_PATH), active: true });
}

export default function HandbookPanel(_props: { onClose?: () => void }) {
  const signedIn = useSidepanelSignedIn();
  const { signInOpen, openSignIn } = useSidepanelSignIn();
  if (signedIn === false) {
    return signInOpen ? <SidepanelSignInCard /> : (
      <div className="px-4 pb-4">
        <HandbookNotice
          icon={<LogIn />}
          title="Sign in to see the handbook"
          copy="Store info, logins, and setup guides are saved to your Volt account."
          action={{ label: "Sign in to Volt", onClick: openSignIn }}
        />
      </div>
    );
  }
  return <HandbookReader />;
}

function HandbookReader() {
  const entriesState = useHandbookEntries();
  const [openId, setOpenId] = useState<HandbookEntryId | null>(null);

  // The Command Menu and New Tab ask for a guide by writing its id before opening the panel.
  useEffect(() => {
    const consume = (request: unknown) => {
      if (!request || typeof request !== "object") return;
      const { id, requestedAt } = request as { id?: unknown; requestedAt?: unknown };
      if (typeof id !== "string" || typeof requestedAt !== "number") return;
      void chrome.storage.local.remove(HANDBOOK_OPEN_ENTRY_KEY);
      if (Date.now() - requestedAt < OPEN_REQUEST_TTL_MS) setOpenId(id as HandbookEntryId);
    };
    void chrome.storage.local.get(HANDBOOK_OPEN_ENTRY_KEY).then((stored) => consume(stored[HANDBOOK_OPEN_ENTRY_KEY]));
    const listener: Parameters<typeof chrome.storage.onChanged.addListener>[0] = (changes, area) => {
      if (area === "local" && changes[HANDBOOK_OPEN_ENTRY_KEY]?.newValue) consume(changes[HANDBOOK_OPEN_ENTRY_KEY].newValue);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  if (entriesState.status === "error") {
    return (
      <div className="px-4 pb-4">
        <HandbookNotice icon={<BookOpen />} title="Couldn't load the handbook" copy={entriesState.error.message} />
      </div>
    );
  }
  if (entriesState.status === "pending") {
    return (
      <div className="flex flex-col gap-3 px-4 pb-4" aria-busy="true">
        <div className="volt-skeleton h-10 rounded-xl" />
        <div className="volt-skeleton h-32 rounded-2xl" />
        <div className="volt-skeleton h-24 rounded-2xl" />
      </div>
    );
  }

  const openEntry = entriesState.data.find((entry) => entry._id === openId);
  if (openEntry?.kind === "guide") return <GuideView key={openEntry._id} entry={openEntry} onBack={() => setOpenId(null)} />;
  if (openEntry) return <EntryView key={openEntry._id} entry={openEntry} onBack={() => setOpenId(null)} />;
  return <HandbookList entries={entriesState.data} onOpen={setOpenId} />;
}

function HandbookList({ entries, onOpen }: { entries: HandbookEntry[]; onOpen: (id: HandbookEntryId) => void }) {
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const addStarterEntries = useMutation(api.handbook.addStarterEntries);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const categoryOrder = useHandbookCategoryOrder();
  // No category chips: the sections below already list every category, in the saved order.
  const groups = useMemo(() => groupHandbook(filterHandbook(entries, query, { kind: "all" }), categoryOrder), [entries, query, categoryOrder]);

  const addStarters = async () => {
    setAdding(true);
    try {
      await addStarterEntries({});
    } finally {
      setAdding(false);
    }
  };

  if (!entries.length) {
    return (
      <div className="px-4 pb-4">
        <HandbookNotice
          icon={<BookOpen />}
          title="Your handbook is empty"
          copy="Add the default setup guides in one click. Store phone, address, and logins are filled in on the full handbook page."
          action={{ label: adding ? "Adding…" : "Add starter entries", onClick: () => void addStarters(), icon: <Sparkles />, disabled: adding }}
          secondary={{ label: "Open full handbook", onClick: openFullHandbook }}
        />
      </div>
    );
  }

  return (
    <SidepanelLayout className="handbook-scroll bg-transparent">
      <div className="handbook-panel">
        <label className="handbook-search">
          <Search aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the handbook…"
            aria-label="Search the handbook"
          />
          <kbd className="handbook-kbd">/</kbd>
        </label>


        {groups.length ? groups.map((group) => (
          <section key={group.category} className="handbook-section">
            <h2 className="handbook-section-title">{group.category}</h2>
            <div className="mobile-scanner-card handbook-card">
              {group.entries.map((entry) => (
                <EntryRow key={entry._id} entry={entry} onOpen={onOpen} />
              ))}
            </div>
          </section>
        )) : (
          <p className="handbook-empty-search">No entries match “{query}”.</p>
        )}

        <button type="button" className="top-offers-secondary-action handbook-footer-action" onClick={openFullHandbook}>
          <ExternalLink aria-hidden="true" />
          Open full handbook
        </button>
      </div>
    </SidepanelLayout>
  );
}

function EntryRow({ entry, onOpen }: { entry: HandbookEntry; onOpen: (id: HandbookEntryId) => void }) {
  // A page marked "show in list" is read right here; its title still opens it on its own.
  if (entry.kind === "page" && entry.showInList) {
    return (
      <div className="handbook-inline-page">
        <button type="button" className="handbook-row is-guide" onClick={() => onOpen(entry._id)}>
          <EntryIcon entry={entry} />
          <span className="handbook-row-text"><span className="handbook-row-value">{entry.title}</span></span>
          <ChevronRight className="handbook-row-chevron" aria-hidden="true" />
        </button>
        <MarkdownView source={entry.body ?? ""} />
      </div>
    );
  }
  if (entry.kind === "guide" || entry.kind === "page") {
    return (
      <button type="button" className="handbook-row is-guide" onClick={() => onOpen(entry._id)}>
        <EntryIcon entry={entry} />
        <span className="handbook-row-text">
          <span className="handbook-row-value">{entry.title}</span>
          <span className="handbook-row-label">{entry.kind === "guide" ? guideSummary(entry) : pageSummary(entry)}</span>
        </span>
        <ChevronRight className="handbook-row-chevron" aria-hidden="true" />
      </button>
    );
  }
  // Clicking the row's text opens the entry. The title is the real (keyboard) button;
  // values and their copy buttons sit outside it, so no button is nested in another.
  const openOnClick = (event: MouseEvent) => {
    // Buttons and links do their own thing, and selecting text (to copy it by hand) doesn't open.
    if ((event.target as Element).closest("button, a") || window.getSelection()?.toString()) return;
    onOpen(entry._id);
  };
  // With labeled rows the title is the heading (bold); a single value is the headline instead.
  const title = (
    <button
      type="button"
      className={cn("handbook-row-title", hasFieldRows(entry) ? "handbook-row-value" : "handbook-row-label")}
      onClick={() => onOpen(entry._id)}
      aria-label={`Open ${entry.title}`}
    >
      <span className="handbook-row-label-text">{entry.title}</span>
    </button>
  );
  const note = entry.note ? <span className="handbook-row-note">{entry.note}</span> : null;

  // Logins and multi-value entries: the title and note, then one labeled row per value.
  if (hasFieldRows(entry)) {
    return (
      <div className="handbook-row is-fields">
        <div className="handbook-row-open" onClick={openOnClick}>
          <EntryIcon entry={entry} />
          <span className="handbook-row-text">
            {title}
            {note}
            <EntryFields entry={entry} />
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="handbook-row">
      <div className="handbook-row-open" onClick={openOnClick}>
        <EntryIcon entry={entry} />
        <span className="handbook-row-text">
          {title}
          <span className="handbook-row-value is-wrapping"><ValueText entry={entry} /></span>
          {note}
        </span>
      </div>
      <span className="handbook-row-actions"><ValueActions entry={entry} /></span>
    </div>
  );
}

/** One entry on its own: its values, short note, or a page's content. */
function EntryView({ entry, onBack }: { entry: HandbookEntry; onBack: () => void }) {
  return (
    <SidepanelLayout className="handbook-scroll bg-transparent">
      <div className="handbook-panel">
        <button type="button" className="handbook-back" onClick={onBack}>
          <ChevronLeft aria-hidden="true" />
          {entry.category}
        </button>
        <div>
          <h2 className="handbook-guide-title">{entry.title}</h2>
          <p className="handbook-meta">{formatHandbookUpdated(entry)}</p>
          {entry.note ? <p className="handbook-entry-note">{entry.note}</p> : null}
        </div>
        {hasFieldRows(entry) ? (
          <div className="mobile-scanner-card handbook-card handbook-fields-card"><EntryFields entry={entry} /></div>
        ) : entry.kind === "value" ? (
          <div className="mobile-scanner-card handbook-card">
            <div className="handbook-row">
              <span className="handbook-row-text"><ValueText entry={entry} className="handbook-row-value is-large is-wrapping" /></span>
              <span className="handbook-row-actions"><ValueActions entry={entry} /></span>
            </div>
          </div>
        ) : null}
        {entry.kind === "page" ? (
          <div className="mobile-scanner-card handbook-card handbook-page-body"><MarkdownView source={entry.body ?? ""} /></div>
        ) : entry.body ? (
          // Notes left on a quick value or login that were too long to fold into its short note.
          <section className="handbook-section">
            <h3 className="handbook-section-title">Older notes</h3>
            <div className="mobile-scanner-card handbook-card handbook-notes">{entry.body}</div>
          </section>
        ) : null}
      </div>
    </SidepanelLayout>
  );
}

function GuideView({ entry, onBack }: { entry: HandbookEntry; onBack: () => void }) {
  const variants = entry.variants ?? [];
  const [variantIndex, setVariantIndex] = useState(0);
  const [done, setDone] = useState<Set<number>>(new Set());
  const variant = variants[variantIndex] ?? variants[0];
  const steps = variant?.steps ?? [];
  const current = steps.findIndex((_, index) => !done.has(index));
  const finished = current === -1;

  const toggleStep = (index: number) => setDone((previous) => {
    const next = new Set(previous);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    return next;
  });
  const back = () => {
    if (!done.size) return onBack();
    setDone((previous) => {
      const next = new Set(previous);
      next.delete(Math.max(...next));
      return next;
    });
  };

  return (
    <SidepanelLayout className="handbook-scroll bg-transparent">
      <div className="handbook-panel">
        <button type="button" className="handbook-back" onClick={onBack}>
          <ChevronLeft aria-hidden="true" />
          {entry.category}
        </button>
        <div>
          <h2 className="handbook-guide-title">{entry.title}</h2>
          <p className="handbook-meta">{formatHandbookUpdated(entry)}</p>
          {entry.body ? <p className="handbook-guide-body">{entry.body}</p> : null}
        </div>
        <VariantToggle
          labels={variants.map((item) => item.label)}
          value={variantIndex}
          onChange={(index) => { setVariantIndex(index); setDone(new Set()); }}
        />
        <div
          className="handbook-progress"
          role="progressbar"
          aria-label="Steps done"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={done.size}
        >
          <span style={{ width: `${steps.length ? (done.size / steps.length) * 100 : 0}%` }} />
        </div>

        <ol className="mobile-scanner-card handbook-card handbook-steps">
          {steps.map((step, index) => {
            const state = done.has(index) ? "done" : index === current ? "current" : "upcoming";
            return (
              <li key={index} className={`handbook-step is-${state}`}>
                <StepNumber index={index} state={state} onClick={() => toggleStep(index)} />
                <div className="handbook-step-body">
                  <StepDetails step={step} />
                </div>
              </li>
            );
          })}
        </ol>

        {variant?.warning ? <GuideWarning>{variant.warning}</GuideWarning> : null}

        <div className="handbook-guide-actions">
          <button type="button" className="handbook-button is-wide" onClick={back}>Back</button>
          <button
            type="button"
            className="handbook-button is-primary is-wide"
            onClick={() => (finished ? onBack() : toggleStep(current))}
          >
            {finished ? "Finish" : current === steps.length - 1 ? "Done" : "Done, next step"}
          </button>
        </div>
      </div>
    </SidepanelLayout>
  );
}

function HandbookNotice({
  icon,
  title,
  copy,
  action,
  secondary,
}: {
  icon: ReactNode;
  title: string;
  copy: string;
  action?: { label: string; onClick: () => void; icon?: ReactNode; disabled?: boolean };
  secondary?: { label: string; onClick: () => void };
}) {
  return (
    <div className="space-y-3">
      <div className="mobile-scanner-card sidepanel-empty-history flex flex-col items-center border-dashed px-4 py-9 text-center">
        <div className="mobile-scanner-icon mb-3 flex h-12 w-12 items-center justify-center rounded-full text-stone-400 dark:text-stone-500 [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </div>
        <p className="text-sm font-semibold text-stone-700 dark:text-stone-200">{title}</p>
        <p className="mt-1 max-w-[260px] text-xs text-stone-500 dark:text-stone-400">{copy}</p>
      </div>
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className="handbook-button is-primary handbook-footer-action"
        >
          {action.icon ?? null}
          {action.label}
        </button>
      ) : null}
      {secondary ? (
        <button type="button" onClick={secondary.onClick} className="top-offers-secondary-action handbook-footer-action">
          <ExternalLink aria-hidden="true" />
          {secondary.label}
        </button>
      ) : null}
    </div>
  );
}
