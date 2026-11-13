import { useEffect, useRef, useState, type ReactNode } from "react";
import { useConvexAuth, useMutation, useQuery, useQuery_experimental } from "convex/react";
import { ArrowDown, ArrowUp, BookOpen, Layers, Pin, Plus, Search, X } from "lucide-react";
import {
  draftFor,
  filterHandbook,
  handbookCategories,
  type HandbookDraft,
  type HandbookEntry,
  type HandbookFilter,
} from "@volt/handbook";

import { api } from "../../../../../convex/_generated/api";
import { HandbookEditor } from "./handbook-editor";
import { iconButtonClass, Notice, primaryButtonClass } from "./handbook-parts";
import { HandbookArticle, HandbookEmpty, HandbookList } from "./handbook-views";

/** What the page shows. Kept in the URL so links, reloads, and Back work. */
export type HandbookView =
  | { kind: "list" }
  | { kind: "article"; id: string }
  | { kind: "edit"; id: string }
  | { kind: "new" };
export type HandbookLocation = { view: HandbookView; filter: HandbookFilter };
export type HandbookNavigate = (location: HandbookLocation, options?: { replace?: boolean }) => void;

/** The signed-in account's handbook: the same entries the Chrome extension shows. */
export function HandbookPage({ location, navigate }: { location: HandbookLocation; navigate: HandbookNavigate }) {
  const { isAuthenticated } = useConvexAuth();
  const entries = useQuery_experimental({ query: api.handbook.entries, args: isAuthenticated ? {} : "skip" });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">Handbook</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">
            Store info, logins, setup guides, and procedures for your team. Changes here show up in the Chrome extension right away.
          </p>
        </div>
      </header>
      {entries.status === "error" ? (
        <Notice title="Couldn't load the handbook" copy={entries.error.message} />
      ) : !isAuthenticated || entries.status === "pending" ? (
        <div role="status" className="space-y-3" aria-label="Loading the handbook">
          <div className="h-11 animate-pulse rounded-[0.85rem] bg-zinc-200/70" />
          <div className="h-64 animate-pulse rounded-[1.2rem] bg-zinc-200/60" />
        </div>
      ) : (
        <HandbookLayout entries={entries.data} location={location} navigate={navigate} />
      )}
    </div>
  );
}

function HandbookLayout({ entries, location, navigate }: { entries: HandbookEntry[]; location: HandbookLocation; navigate: HandbookNavigate }) {
  const { view, filter } = location;
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Prefills for "Add Store phone" and similar. Not in the URL; a reload opens a blank form.
  const [newDefaults, setNewDefaults] = useState<Partial<HandbookDraft>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const categoryOrder = useQuery(api.handbook.categoryOrder, {}) ?? [];
  const categories = handbookCategories(entries, categoryOrder);
  const selected = view.kind === "article" || view.kind === "edit"
    ? entries.find((entry) => entry._id === view.id) ?? null
    : null;

  const go = (next: Partial<HandbookLocation>, options?: { replace?: boolean }) =>
    navigate({ view: next.view ?? view, filter: next.filter ?? filter }, options);
  const report = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause));

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

  // A deleted (or mistyped) entry falls back to the list instead of an empty article,
  // and a category that no longer has entries falls back to everything.
  const missingEntry = (view.kind === "article" || view.kind === "edit") && !selected;
  const missingCategory = filter.kind === "category" && !categories.includes(filter.category);
  useEffect(() => {
    if (!missingEntry && !missingCategory) return;
    go({
      view: missingEntry ? { kind: "list" } : view,
      filter: missingCategory ? { kind: "all" } : filter,
    }, { replace: true });
    // Only when something goes missing; `go` and the location are read at that moment.
  }, [missingEntry, missingCategory]);

  const openNew = (defaults: Partial<HandbookDraft> = {}) => {
    setNewDefaults({ category: filter.kind === "category" ? filter.category : "", ...defaults });
    go({ view: { kind: "new" } });
  };
  const editing = view.kind === "new" || (view.kind === "edit" && selected);

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      <CategoryNav
        entries={entries}
        categories={categories}
        filter={filter}
        onSelect={(next) => go({ filter: next, view: { kind: "list" } })}
        onError={report}
      />
      <div className="min-w-0 space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search the handbook</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (view.kind === "article") go({ view: { kind: "list" } });
              }}
              placeholder={`Search ${entries.length} ${entries.length === 1 ? "entry" : "entries"}…`}
              className="h-11 w-full rounded-[0.85rem] border border-zinc-200 bg-white pl-10 pr-14 text-sm text-zinc-950 shadow-sm placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-[3px] focus:ring-emerald-500/15"
            />
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-zinc-200 px-1.5 py-0.5 font-sans text-[11px] font-medium text-zinc-400 sm:block">
              ⌘K
            </kbd>
          </label>
          {!editing ? (
            <button type="button" className={`${primaryButtonClass} h-11`} onClick={() => openNew()}>
              <Plus aria-hidden="true" />
              New entry
            </button>
          ) : null}
        </div>

        {error ? (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-[1.2rem] border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm leading-6 text-red-800">{error}</p>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="grid size-6 shrink-0 place-items-center rounded-full text-red-500 hover:bg-red-100 hover:text-red-800">
              <X size={14} />
            </button>
          </div>
        ) : null}

        {editing ? (
          <HandbookEditor
            key={view.kind === "edit" ? view.id : "new"}
            entry={view.kind === "edit" ? selected : null}
            initial={draftFor(view.kind === "edit" ? selected : null, view.kind === "new" ? newDefaults : {})}
            categories={categories}
            onSaved={(id) => go({ view: { kind: "article", id } }, { replace: true })}
            onCancel={() => go({ view: view.kind === "edit" ? { kind: "article", id: view.id } : { kind: "list" } })}
          />
        ) : selected ? (
          <HandbookArticle
            key={selected._id}
            entry={selected}
            onBack={() => go({ view: { kind: "list" } })}
            onEdit={() => go({ view: { kind: "edit", id: selected._id } })}
            onDeleted={() => go({ view: { kind: "list" } }, { replace: true })}
            onError={report}
          />
        ) : entries.length ? (
          <HandbookList
            entries={filterHandbook(entries, query, filter)}
            categoryOrder={categoryOrder}
            query={query}
            onOpen={(id) => go({ view: { kind: "article", id } })}
            onError={report}
          />
        ) : (
          <HandbookEmpty onNew={openNew} onError={report} />
        )}
      </div>
    </div>
  );
}

function CategoryNav({
  entries,
  categories,
  filter,
  onSelect,
  onError,
}: {
  entries: HandbookEntry[];
  categories: string[];
  filter: HandbookFilter;
  onSelect: (filter: HandbookFilter) => void;
  onError: (cause: unknown) => void;
}) {
  const setCategoryOrder = useMutation(api.handbook.setCategoryOrder);
  // One move at a time, so a quick double click can't send the same swap twice.
  const [moving, setMoving] = useState(false);
  const move = async (index: number, offset: number) => {
    const next = [...categories];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setMoving(true);
    try {
      await setCategoryOrder({ categories: next });
    } catch (cause) {
      onError(cause);
    } finally {
      setMoving(false);
    }
  };
  const items: Array<{ label: string; filter: HandbookFilter; icon: ReactNode; count: number; categoryIndex?: number }> = [
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

  return (
    <aside aria-label="Handbook categories" className="min-w-0">
      {/* Phones: a row of chips. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => onSelect(item.filter)}
            aria-pressed={isActive(item.filter)}
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${isActive(item.filter) ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300"}`}
          >
            {item.label}
            <span className="tabular-nums text-zinc-400">{item.count}</span>
          </button>
        ))}
      </div>
      {/* Desktop: a list, where categories can be reordered. The order is used everywhere the handbook appears. */}
      <nav className="sticky top-24 hidden space-y-0.5 lg:block">
        {items.map((item) => (
          <div key={item.label} className="group relative">
            <button
              type="button"
              onClick={() => onSelect(item.filter)}
              aria-current={isActive(item.filter) ? "page" : undefined}
              className={`flex w-full items-center gap-2.5 rounded-[0.7rem] px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 [&>svg]:size-4 [&>svg]:shrink-0 ${isActive(item.filter) ? "bg-white font-semibold text-zinc-950 shadow-sm ring-1 ring-zinc-200" : "font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"}`}
            >
              {item.icon}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <span className={`text-xs tabular-nums text-zinc-400 ${item.categoryIndex !== undefined && categories.length > 1 ? "group-focus-within:invisible group-hover:invisible" : ""}`}>
                {item.count}
              </span>
            </button>
            {item.categoryIndex !== undefined && categories.length > 1 ? (
              <span className="absolute right-1 top-1/2 flex -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  className={`${iconButtonClass} size-7 [&_svg]:size-3.5`}
                  aria-label={`Move ${item.label} up`}
                  disabled={moving || item.categoryIndex === 0}
                  onClick={() => void move(item.categoryIndex!, -1)}
                >
                  <ArrowUp aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`${iconButtonClass} size-7 [&_svg]:size-3.5`}
                  aria-label={`Move ${item.label} down`}
                  disabled={moving || item.categoryIndex === categories.length - 1}
                  onClick={() => void move(item.categoryIndex!, 1)}
                >
                  <ArrowDown aria-hidden="true" />
                </button>
              </span>
            ) : null}
          </div>
        ))}
      </nav>
    </aside>
  );
}
