import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronLeft,
  KeyRound,
  Layers,
  LogIn,
  PanelRight,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api } from "../../../../../convex/_generated/api";
import {
  filterHandbook,
  formatHandbookUpdated,
  groupHandbook,
  guideSummary,
  handbookCategories,
  pageSummary,
  BLANK_SUGGESTIONS,
  type HandbookEntry,
  type HandbookEntryId,
  type HandbookFilter,
} from "../../domain/handbook";
import { useHandbookCategoryOrder, useHandbookEntries } from "../../hooks/useHandbookEntries";
import { cn } from "../../lib/utils";
import { ExtensionAccountControl, SidepanelSignInCard, useSidepanelSignIn, useSidepanelSignedIn } from "../access/ExtensionAccess";
import { entryFields, fieldDisplayValue, hasFieldRows } from "../../domain/handbook-format";
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
import { draftFor, emptyField, HandbookEditor, type HandbookDraft } from "./HandbookEditor";
import "./handbook-page.css";

type View =
  | { kind: "list" }
  | { kind: "article"; id: HandbookEntryId }
  | { kind: "edit"; id: HandbookEntryId }
  | { kind: "new"; defaults: Partial<HandbookDraft> };

export default function HandbookPage() {
  const signedIn = useSidepanelSignedIn();
  const { signInOpen, openSignIn } = useSidepanelSignIn();
  useEffect(() => { document.title = "Volt Handbook"; }, []);

  return (
    <div className="handbook-page sidepanel-shell">
      {signedIn === false ? (
        <div className="handbook-page-center">
          {signInOpen ? <SidepanelSignInCard page="/handbook.html" /> : (
            <PageNotice icon={<LogIn />} title="Sign in to open the handbook" copy="Handbook entries are saved to your Volt account.">
              <button type="button" className="handbook-button is-primary is-wide" onClick={openSignIn}>Sign in to Volt</button>
            </PageNotice>
          )}
        </div>
      ) : <HandbookWorkspace />}
    </div>
  );
}

function HandbookWorkspace() {
  const entriesState = useHandbookEntries();
  if (entriesState.status === "error") {
    return (
      <div className="handbook-page-center">
        <PageNotice icon={<BookOpen />} title="Couldn't load the handbook" copy={entriesState.error.message} />
      </div>
    );
  }
  if (entriesState.status === "pending") {
    return <div className="handbook-page-center"><div className="volt-skeleton h-40 w-full max-w-md rounded-2xl" /></div>;
  }
  return <HandbookLayout entries={entriesState.data} />;
}

function HandbookLayout({ entries }: { entries: HandbookEntry[] }) {
  const [filter, setFilter] = useState<HandbookFilter>({ kind: "all" });
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>({ kind: "list" });
  const searchRef = useRef<HTMLInputElement>(null);
  const categoryOrder = useHandbookCategoryOrder();
  const setCategoryOrder = useMutation(api.handbook.setCategoryOrder);
  const categories = handbookCategories(entries, categoryOrder);
  const moveCategory = (index: number, offset: number) => {
    const next = [...categories];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    void setCategoryOrder({ categories: next });
  };
  const selected = view.kind === "article" || view.kind === "edit"
    ? entries.find((entry) => entry._id === view.id) ?? null
    : null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // A deleted entry falls back to the list instead of an empty article.
  useEffect(() => {
    if ((view.kind === "article" || view.kind === "edit") && !selected) setView({ kind: "list" });
  }, [view, selected]);

  const navItems: Array<{ label: string; filter: HandbookFilter; icon: ReactNode; count: number; categoryIndex?: number }> = [
    { label: "All entries", filter: { kind: "all" }, icon: <Layers />, count: entries.length },
    { label: "Pinned", filter: { kind: "pinned" }, icon: <Pin />, count: entries.filter((entry) => entry.pinned).length },
    ...categories.map((category, categoryIndex) => ({
      label: category,
      filter: { kind: "category", category } as const,
      icon: <BookOpen />,
      count: entries.filter((entry) => entry.category === category).length,
      categoryIndex,
    })),
  ];
  const isActive = (candidate: HandbookFilter) => candidate.kind === filter.kind
    && (candidate.kind !== "category" || (filter.kind === "category" && filter.category === candidate.category));

  const openNew = (defaults: Partial<HandbookDraft> = {}) => setView({
    kind: "new",
    defaults: { category: filter.kind === "category" ? filter.category : "", ...defaults },
  });

  return (
    <div className="handbook-page-grid">
      <aside className="handbook-nav">
        <div className="handbook-brand">
          <img src="/assets/icons/logo.png" alt="" />
          <span>Handbook</span>
        </div>
        <nav aria-label="Handbook categories">
          {navItems.map((item) => (
            <div key={item.label} className="handbook-nav-row">
              <button
                type="button"
                className={cn("handbook-nav-item", isActive(item.filter) && "is-active")}
                onClick={() => { setFilter(item.filter); setView({ kind: "list" }); }}
              >
                {item.icon}
                <span>{item.label}</span>
                <span className="handbook-nav-count">{item.count}</span>
              </button>
              {/* Categories can be moved; the order is used here, in the list, and in the sidepanel. */}
              {item.categoryIndex !== undefined && categories.length > 1 ? (
                <span className="handbook-nav-move">
                  <button type="button" className="handbook-button is-icon" aria-label={`Move ${item.label} up`}
                    disabled={item.categoryIndex === 0} onClick={() => moveCategory(item.categoryIndex!, -1)}>
                    <ArrowUp aria-hidden="true" />
                  </button>
                  <button type="button" className="handbook-button is-icon" aria-label={`Move ${item.label} down`}
                    disabled={item.categoryIndex === categories.length - 1} onClick={() => moveCategory(item.categoryIndex!, 1)}>
                    <ArrowDown aria-hidden="true" />
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </nav>
        <div className="flex-1" />
        <button
          type="button"
          className="handbook-nav-item is-subtle"
          onClick={() => void chrome.runtime.sendMessage({ action: "openInSidebar", tool: "handbook", mode: "open" })}
        >
          <PanelRight />
          <span>Open in sidepanel</span>
        </button>
        <button type="button" className="handbook-nav-item is-accent" onClick={() => openNew()}>
          <Plus />
          <span>New entry</span>
        </button>
      </aside>

      <main className="handbook-main">
        <div className="handbook-main-top">
          <label className="handbook-search">
            <Search aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => { setQuery(event.target.value); if (view.kind !== "new" && view.kind !== "edit") setView({ kind: "list" }); }}
              placeholder={`Search ${entries.length} ${entries.length === 1 ? "entry" : "entries"}…`}
              aria-label="Search the handbook"
            />
            <kbd className="handbook-kbd">⌘K</kbd>
          </label>
          <ExtensionAccountControl sharedClerkContext />
        </div>

        {view.kind === "new" || (view.kind === "edit" && selected) ? (
          <HandbookEditor
            key={view.kind === "edit" ? view.id : "new"}
            entry={view.kind === "edit" ? selected : null}
            initial={draftFor(view.kind === "edit" ? selected : null, view.kind === "new" ? view.defaults : {})}
            categories={categories}
            onSaved={(id) => setView({ kind: "article", id })}
            onCancel={() => setView(view.kind === "edit" ? { kind: "article", id: view.id } : { kind: "list" })}
          />
        ) : selected ? (
          <Article
            key={selected._id}
            entry={selected}
            onBack={() => setView({ kind: "list" })}
            onEdit={() => setView({ kind: "edit", id: selected._id })}
          />
        ) : entries.length ? (
          <EntryList
            entries={filterHandbook(entries, query, filter)}
            categoryOrder={categoryOrder}
            query={query}
            onOpen={(id) => setView({ kind: "article", id })}
          />
        ) : (
          <EmptyHandbook onNew={openNew} />
        )}
      </main>

      <Rail entries={entries} selected={selected} onOpen={(id) => setView({ kind: "article", id })} />
    </div>
  );
}

function rowSummary(entry: HandbookEntry) {
  return entry.kind === "guide" ? guideSummary(entry)
    : entry.kind === "page" ? pageSummary(entry)
      : entry.kind === "secret" ? entry.username ?? entry.secretPreview
        : entryFields(entry).map(fieldDisplayValue).join(" · ");
}

function EntryList({ entries, categoryOrder, query, onOpen }: {
  entries: HandbookEntry[];
  categoryOrder: string[];
  query: string;
  onOpen: (id: HandbookEntryId) => void;
}) {
  const reorder = useMutation(api.handbook.reorder);
  const setPinned = useMutation(api.handbook.setPinned);
  const groups = useMemo(() => groupHandbook(entries, categoryOrder), [entries, categoryOrder]);
  if (!groups.length) return <p className="handbook-empty-search">No entries match “{query}”.</p>;
  return (
    <div className="handbook-list">
      {groups.map((group) => (
        <section key={group.category} className="handbook-section">
          <h2 className="handbook-section-title">{group.category}</h2>
          <div className="mobile-scanner-card handbook-card">
            {group.entries.map((entry, index) => {
              // Pinned entries always lead their group, so only swap within the same pin state.
              const canMove = (offset: number) => group.entries[index + offset]?.pinned === entry.pinned;
              const moveBy = (offset: number) => {
                const neighbor = group.entries[index + offset]._id;
                void reorder({ ids: offset < 0 ? [entry._id, neighbor] : [neighbor, entry._id] });
              };
              return (
                <div key={entry._id} className="handbook-row handbook-list-row">
                  <button type="button" className="handbook-list-open" onClick={() => onOpen(entry._id)}>
                    <EntryIcon entry={entry} />
                    <span className="handbook-row-text">
                      <span className="handbook-row-value">
                        {entry.title}
                        {entry.pinned ? <Pin className="handbook-pin-mark" aria-label="Pinned" /> : null}
                      </span>
                      <span className="handbook-row-label">{rowSummary(entry)}</span>
                      {entry.note ? <span className="handbook-row-note">{entry.note}</span> : null}
                    </span>
                  </button>
                  <span className="handbook-row-actions handbook-reveal-on-hover">
                    <button
                      type="button"
                      className={cn("handbook-button is-icon", entry.pinned && "is-active")}
                      aria-label={entry.pinned ? `Unpin ${entry.title}` : `Pin ${entry.title}`}
                      aria-pressed={entry.pinned}
                      title={entry.pinned ? "Unpin" : "Pin to the top"}
                      onClick={() => void setPinned({ id: entry._id, pinned: !entry.pinned })}
                    >
                      {entry.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
                    </button>
                    <button type="button" className="handbook-button is-icon" aria-label={`Move ${entry.title} up`} disabled={!canMove(-1)} onClick={() => moveBy(-1)}>
                      <ArrowUp aria-hidden="true" />
                    </button>
                    <button type="button" className="handbook-button is-icon" aria-label={`Move ${entry.title} down`} disabled={!canMove(1)} onClick={() => moveBy(1)}>
                      <ArrowDown aria-hidden="true" />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function Article({ entry, onBack, onEdit }: { entry: HandbookEntry; onBack: () => void; onEdit: () => void }) {
  const setPinned = useMutation(api.handbook.setPinned);
  const remove = useMutation(api.handbook.remove);
  const [variantIndex, setVariantIndex] = useState(0);
  const variants = entry.variants ?? [];
  const variant = variants[variantIndex] ?? variants[0];

  const confirmRemove = () => {
    if (window.confirm(`Delete “${entry.title}”? This can't be undone.`)) void remove({ id: entry._id });
  };

  return (
    <article className="handbook-article">
      <button type="button" className="handbook-back" onClick={onBack}>
        <ChevronLeft aria-hidden="true" />
        {entry.category}
      </button>
      <div className="handbook-article-head">
        <div className="min-w-0">
          <h1 className="handbook-article-title">{entry.title}</h1>
          <p className="handbook-meta">
            {formatHandbookUpdated(entry)}
            {entry.note ? ` · ${entry.note}` : ""}
          </p>
        </div>
        <div className="handbook-row-actions">
          <button type="button" className="handbook-button" onClick={() => void setPinned({ id: entry._id, pinned: !entry.pinned })}>
            {entry.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
            {entry.pinned ? "Unpin" : "Pin"}
          </button>
          <button type="button" className="handbook-button" onClick={onEdit}>
            <Pencil aria-hidden="true" />
            Edit
          </button>
          <button type="button" className="handbook-button is-icon is-danger" onClick={confirmRemove} aria-label={`Delete ${entry.title}`}>
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      </div>

      {hasFieldRows(entry) ? (
        <div className="mobile-scanner-card handbook-card handbook-fields-card"><EntryFields entry={entry} /></div>
      ) : entry.kind === "value" ? (
        <div className="mobile-scanner-card handbook-card">
          <div className="handbook-row">
            <EntryIcon entry={entry} />
            <span className="handbook-row-text"><ValueText entry={entry} className="handbook-row-value is-large is-wrapping" /></span>
            <span className="handbook-row-actions"><ValueActions entry={entry} /></span>
          </div>
        </div>
      ) : null}

      {entry.kind === "guide" && variant ? (
        <>
          <VariantToggle labels={variants.map((item) => item.label)} value={variantIndex} onChange={setVariantIndex} />
          <ol className="mobile-scanner-card handbook-card handbook-steps">
            {variant.steps.map((step, index) => (
              <li key={index} className="handbook-step is-current">
                <StepNumber index={index} state="upcoming" />
                <div className="handbook-step-body"><StepDetails step={step} /></div>
              </li>
            ))}
          </ol>
          {variant.warning ? <GuideWarning>{variant.warning}</GuideWarning> : null}
        </>
      ) : null}

      {entry.kind === "page" ? (
        <div className="mobile-scanner-card handbook-card handbook-page-body"><MarkdownView source={entry.body ?? ""} /></div>
      ) : entry.kind === "guide" && entry.body ? (
        <p className="handbook-guide-body">{entry.body}</p>
      ) : null}
    </article>
  );
}

function Rail({ entries, selected, onOpen }: { entries: HandbookEntry[]; selected: HandbookEntry | null; onOpen: (id: HandbookEntryId) => void }) {
  const quick = entries.filter((entry) => entry.pinned && (entry.kind === "value" || entry.kind === "secret")).slice(0, 6);
  const related = selected
    ? entries.filter((entry) => entry.category === selected.category && entry._id !== selected._id).slice(0, 5)
    : [...entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  return (
    <aside className="handbook-rail">
      {quick.length ? (
        <>
          <h2 className="handbook-section-title">Quick copy</h2>
          {quick.map((entry) => hasFieldRows(entry) ? (
            <div key={entry._id} className="handbook-mini">
              <span className="handbook-row-label">{entry.title}</span>
              <EntryFields entry={entry} />
            </div>
          ) : (
            <div key={entry._id} className="handbook-mini">
              <span className="handbook-row-label">{entry.title}</span>
              <ValueText entry={entry} className="handbook-mini-value" />
              <span className="handbook-row-actions"><ValueActions entry={entry} /></span>
            </div>
          ))}
        </>
      ) : null}
      {related.length ? (
        <>
          <h2 className="handbook-section-title">{selected ? "Related" : "Recently updated"}</h2>
          {related.map((entry) => (
            <button key={entry._id} type="button" className="handbook-mini is-link" onClick={() => onOpen(entry._id)}>
              {entry.title}
            </button>
          ))}
        </>
      ) : null}
    </aside>
  );
}

function EmptyHandbook({ onNew }: { onNew: (defaults?: Partial<HandbookDraft>) => void }) {
  const addStarterEntries = useMutation(api.handbook.addStarterEntries);
  const [adding, setAdding] = useState(false);
  const addStarters = async () => {
    setAdding(true);
    try {
      await addStarterEntries({});
    } finally {
      setAdding(false);
    }
  };
  return (
    <PageNotice
      icon={<BookOpen />}
      title="Start your store handbook"
      copy="Add the default setup guides in one click. Then fill in your store's phone, address, police line, and the logins your team uses."
    >
      <button type="button" className="handbook-button is-primary is-wide" disabled={adding} onClick={() => void addStarters()}>
        <Sparkles aria-hidden="true" />
        {adding ? "Adding…" : "Add starter entries"}
      </button>
      <div className="handbook-suggestions">
        {BLANK_SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.title}
            type="button"
            className="handbook-button"
            onClick={() => onNew({
              kind: suggestion.kind,
              category: suggestion.category,
              title: suggestion.title,
              note: suggestion.note,
              // Preset the value's type, so "Store phone" opens with phone formatting.
              ...("valueFormat" in suggestion ? { fields: [emptyField(suggestion.valueFormat)] } : {}),
            })}
          >
            {suggestion.kind === "secret" ? <KeyRound aria-hidden="true" /> : <Plus aria-hidden="true" />}
            Add {suggestion.title}{suggestion.kind === "secret" ? " login" : ""}
          </button>
        ))}
      </div>
      <button type="button" className="handbook-button" onClick={() => onNew()}>
        <Plus aria-hidden="true" />
        Write your own entry
      </button>
    </PageNotice>
  );
}

function PageNotice({ icon, title, copy, children }: { icon: ReactNode; title: string; copy: string; children?: ReactNode }) {
  return (
    <div className="mobile-scanner-card handbook-page-notice">
      <div className="mobile-scanner-icon handbook-page-notice-icon">{icon}</div>
      <h1 className="handbook-article-title">{title}</h1>
      <p className="handbook-meta">{copy}</p>
      {children ? <div className="handbook-page-notice-actions">{children}</div> : null}
    </div>
  );
}
